function isoDate(value) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function applyTripOperations(currentTrip, operations) {
  const trip = clone(normalizeTrip(currentTrip))
  const changes = []
  const warnings = []

  for (const operation of operations || []) {
    if (operation.type !== 'change_segment_days') {
      warnings.push(`暂不支持的多城市操作：${operation.type}`)
      continue
    }
    const segment = trip.segments.find((item) => item.id === operation.segmentId || item.city === operation.city)
    const days = Number(operation.days)
    if (!segment || !Number.isInteger(days) || days < 1 || days > 60) {
      warnings.push('无法确认要调整的城市或停留天数。')
      continue
    }
    const previousDays = Number(segment.days) || 0
    if (previousDays === days) {
      warnings.push(`${segment.city} 已经是 ${days} 天，无需调整。`)
      continue
    }
    segment.days = days
    changes.push({
      type: 'change_segment_days',
      message: `${segment.city} 从 ${previousDays} 天调整为 ${days} 天`,
      affectedSegmentIds: trip.segments.slice(segment.order).map((item) => item.id)
    })
  }

  if (changes.length) {
    trip.totalDays = trip.segments.reduce((sum, segment) => sum + Number(segment.days || 0), 0)
    if (trip.startDate) {
      let cursor = new Date(`${trip.startDate}T00:00:00.000Z`)
      for (const segment of trip.segments) {
        segment.startDate = cursor.toISOString().slice(0, 10)
        cursor = addDays(cursor, Number(segment.days) || 0)
        segment.endDate = addDays(cursor, -1).toISOString().slice(0, 10)
      }
      trip.endDate = addDays(cursor, -1).toISOString().slice(0, 10)
    }
  }
  return { trip, changes, warnings }
}

export function routeToTrip(route, constraints = {}, schedule = []) {
  const destinations = Array.isArray(route?.destinations) ? route.destinations : []
  const city = constraints.city || schedule[0]?.city || destinations[0]?.city || ''
  const days = Math.max(Number(route?.estimatedDays) || 0, ...destinations.map((item) => Number(item.day) || 0), 1)
  return {
    id: route?.id || `trip-${Date.now()}`,
    title: route?.name || `${city || '未命名'}旅行`,
    startDate: isoDate(constraints.startDate || destinations[0]?.date),
    endDate: isoDate(constraints.endDate),
    totalDays: days,
    status: 'planning',
    revision: Number(route?.revision) || 0,
    constraints: { ...constraints, city, days },
    segments: [{
      id: `segment-${route?.id || Date.now()}-1`, city, order: 1,
      startDate: isoDate(constraints.startDate || destinations[0]?.date),
      endDate: isoDate(constraints.endDate), days, status: destinations.length ? 'detailed' : 'outline',
      destinations, schedule
    }]
  }
}

export function normalizeTrip(value, constraints = {}) {
  if (Array.isArray(value?.segments)) {
    return { ...value, revision: Number(value.revision) || 0, segments: value.segments.map((segment, index) => ({ ...segment, order: index + 1 })) }
  }
  if (value?.route) return routeToTrip(value.route, constraints, value.schedule || [])
  return routeToTrip(value, constraints)
}

export function validateTripOutline(trip) {
  const errors = []
  if (!Array.isArray(trip?.segments) || !trip.segments.length) errors.push('行程至少需要一个城市段。')
  const total = (trip?.segments || []).reduce((sum, segment) => sum + Number(segment.days || 0), 0)
  if ((trip?.segments || []).some((segment) => !segment.city || !Number.isInteger(Number(segment.days)) || Number(segment.days) < 1)) errors.push('每个城市段都需要城市和有效停留天数。')
  if (Number(trip?.totalDays) !== total) errors.push('城市段停留天数总和与旅行总天数不一致。')
  return errors
}

export function buildOutline({ title, totalDays, cities, startDate }) {
  const days = Number(totalDays)
  const cleanCities = (cities || []).map((item) => typeof item === 'string' ? { city: item } : item).filter((item) => item?.city)
  if (!Number.isInteger(days) || days < 1 || days > 60 || !cleanCities.length) throw new Error('需要1-60天总时长和至少一个中国境内城市。')
  const specified = cleanCities.reduce((sum, item) => sum + (Number(item.days) || 0), 0)
  const remaining = Math.max(0, days - specified)
  const unspecified = cleanCities.filter((item) => !Number(item.days)).length
  let unspecifiedIndex = 0
  let cursor = startDate ? new Date(startDate) : null
  const segments = cleanCities.map((item, index) => {
    const specifiedDays = Number(item.days)
    const allocation = specifiedDays || Math.floor(remaining / Math.max(unspecified, 1)) + (unspecifiedIndex < remaining % Math.max(unspecified, 1) ? 1 : 0)
    if (!specifiedDays) unspecifiedIndex += 1
    const segmentStart = cursor && Number.isFinite(cursor.getTime()) ? cursor.toISOString().slice(0, 10) : undefined
    if (cursor) cursor = new Date(cursor.getTime() + allocation * 86400000)
    return {
      id: `segment-${Date.now()}-${index}`, city: item.city, order: index + 1,
      startDate: segmentStart,
      endDate: cursor ? new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10) : undefined,
      days: allocation, status: 'outline', reason: item.reason || '', destinations: [], schedule: []
    }
  })
  const trip = { id: `trip-${Date.now()}`, title: title || `${days}天多城市旅行`, startDate: startDate || undefined, totalDays: days, status: 'draft', revision: 0, constraints: {}, segments }
  const errors = validateTripOutline(trip)
  if (errors.length) throw new Error(errors[0])
  return trip
}
