const DAY_MS = 86400000

function distanceKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function estimateTransport(distance) {
  if (distance <= 1.2) return { mode: 'walk', minutes: Math.max(10, Math.round(distance * 15)) }
  if (distance <= 8) return { mode: 'taxi', minutes: Math.round(12 + distance * 4) }
  return { mode: 'metro', minutes: Math.round(20 + distance * 3) }
}

function startDateFor(day) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return new Date(date.getTime() + (day - 1) * DAY_MS).toISOString()
}

function priority(place) {
  if (place.locked) return 0
  if (place.poiStatus === 'must_go') return 1
  if (place.source === 'user') return 2
  return 3
}

function validPlace(place) {
  return Array.isArray(place?.coordinates) && place.coordinates.length === 2 &&
    Number.isFinite(Number(place.coordinates[0])) && Number.isFinite(Number(place.coordinates[1]))
}

function normalizedPlaceName(name) {
  return String(name || '')
    .replace(/南京|景区|风景名胜区|风光带|旅游区|公园|江苏省|南京市/g, '')
    .replace(/[\s·・()（）-]/g, '')
}

function dedupePlaces(places) {
  const unique = []
  for (const place of places) {
    const name = normalizedPlaceName(place.name)
    const duplicate = unique.some((existing) => {
      const existingName = normalizedPlaceName(existing.name)
      if (name && existingName && name === existingName) return true
      if (!name || !existingName || (!name.includes(existingName) && !existingName.includes(name))) return false
      return distanceKm(existing.coordinates, place.coordinates) <= 0.6
    })
    if (!duplicate) unique.push(place)
  }
  return unique
}

function orderPlaces(places) {
  const remaining = [...places].sort((a, b) => priority(a) - priority(b))
  const ordered = []

  while (remaining.length) {
    if (!ordered.length) {
      ordered.push(remaining.shift())
      continue
    }

    const last = ordered[ordered.length - 1]
    let nearestIndex = 0
    let nearestDistance = Infinity
    remaining.forEach((place, index) => {
      const distance = distanceKm(last.coordinates, place.coordinates)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    ordered.push(remaining.splice(nearestIndex, 1)[0])
  }

  return ordered
}

function buildSchedule(route, city, days) {
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1
    const items = route.destinations.filter((place) => place.day === day)
    return {
      day,
      date: startDateFor(day),
      city,
      activities: items.map((place) => `${place.withinDayOrder}. ${place.name}`),
      accommodation: `${city}住宿待定`,
      notes: items.length ? '行程由 AI 自动生成，可继续手动调整。' : '当天暂未安排地点。'
    }
  })
}

export function buildTripPlan({ city, days, pace, destinations, candidates, selectedPoiIds = [] }) {
  const warnings = []
  const limitByPace = { '轻松': 3, '适中': 4, '紧凑': 5 }
  const perDayLimit = limitByPace[pace] || 4
  const selectedIds = new Set(selectedPoiIds)
  const allPlaces = dedupePlaces([...destinations, ...candidates]
    .filter((place) => place?.poiStatus !== 'avoid' && validPlace(place))
    .map((place) => ({
      ...place,
      coordinates: [Number(place.coordinates[0]), Number(place.coordinates[1])],
      source: place.source || 'ai'
    })))

  const mustKeep = allPlaces.filter((place) => place.poiStatus === 'must_go' || place.locked)
  const requested = selectedIds.size
    ? allPlaces.filter((place) => selectedIds.has(place.id))
    : allPlaces
  const requestedWithDays = requested.filter((place) => Number.isInteger(Number(place.requestedDay)))
  const uniqueChosen = [...mustKeep, ...requested]
    .filter((place, index, list) => list.findIndex((item) => item.id === place.id) === index)
  const chosen = requestedWithDays.length ? uniqueChosen : uniqueChosen.slice(0, days * perDayLimit)

  if (mustKeep.length > days * perDayLimit) {
    warnings.push('必去或锁定地点超过当前天数和节奏可承载的数量，已优先保留。')
  }
  if (!chosen.length) {
    warnings.push('没有找到可用于规划的有效 POI。请补充地点或检查高德 Key。')
  }
  if (allPlaces.length > chosen.length) {
    warnings.push(`已按${pace || '适中'}节奏安排部分地点，其余地点保留在待规划中。`)
  }

  const preserveRequestedDays = chosen.some((place) => Number.isInteger(Number(place.requestedDay)))
  const ordered = preserveRequestedDays
    ? [...chosen].sort((a, b) => (Number(a.requestedDay) - Number(b.requestedDay)) || (Number(a.requestedWithinDayOrder) - Number(b.requestedWithinDayOrder)))
    : orderPlaces(chosen)
  const dayCounts = new Map()
  const planned = ordered.map((place, index) => {
    const day = preserveRequestedDays
      ? Math.max(1, Math.min(days, Number(place.requestedDay) || 1))
      : Math.min(days, Math.floor(index * days / Math.max(ordered.length, 1)) + 1)
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1)
    const withinDayOrder = dayCounts.get(day)
    const previous = index > 0 && ordered[index - 1].requestedDay === place.requestedDay ? ordered[index - 1] : null
    const transport = previous ? estimateTransport(distanceKm(previous.coordinates, place.coordinates)) : { mode: 'walk', minutes: 0 }

    return {
      ...place,
      order: index + 1,
      day,
      withinDayOrder,
      date: startDateFor(day),
      poiStatus: place.poiStatus || 'optional',
      planningStatus: 'scheduled',
      visitDurationMinutes: place.visitDurationMinutes || 90,
      transportMode: transport.mode,
      travelTimeMinutes: transport.minutes,
      agentNote: place.agentNote || '由 AI 根据地点优先级、节奏与直线距离自动安排。'
    }
  })

  if (preserveRequestedDays) {
    const crowdedDays = []
    for (const [day, count] of dayCounts) {
      if (count > perDayLimit) crowdedDays.push(`第 ${day} 天有 ${count} 个地点`)
    }
    if (crowdedDays.length) warnings.push(`这份行程有几天安排得比较满（${crowdedDays.join('、')}）。我先完整保留了你的原安排；如果你愿意，我可以再帮你挑出最赶的一天慢慢调整。`)
  }

  const totalDistance = planned.reduce((total, place, index) => {
    if (!index || planned[index - 1].day !== place.day) return total
    return total + distanceKm(planned[index - 1].coordinates, place.coordinates)
  }, 0)

  const route = {
    id: `agent-route-${Date.now()}`,
    name: `${city} ${days}日自动行程`,
    destinations: planned,
    totalDistance,
    estimatedDays: days
  }

  return { route, schedule: buildSchedule(route, city, days), warnings }
}
