const DAY_MS = 86400000

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isScheduled(place) {
  return place.planningStatus !== 'unscheduled' && place.planningStatus !== 'candidate' && place.planningStatus !== 'rejected'
}

function distanceKm(a, b) {
  const toRad = (value) => (Number(value) * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function routeDistance(places) {
  return places.slice(1).reduce((total, place, index) => total + distanceKm(places[index].coordinates, place.coordinates), 0)
}

function nearestRoute(places, startIndex) {
  const remaining = places.filter((_, index) => index !== startIndex)
  const ordered = [places[startIndex]]
  while (remaining.length) {
    const last = ordered[ordered.length - 1]
    let nearestIndex = 0
    for (let index = 1; index < remaining.length; index += 1) {
      if (distanceKm(last.coordinates, remaining[index].coordinates) < distanceKm(last.coordinates, remaining[nearestIndex].coordinates)) nearestIndex = index
    }
    ordered.push(remaining.splice(nearestIndex, 1)[0])
  }
  return ordered
}

function optimizeOrder(places) {
  if (places.length < 3) return places
  return places
    .map((_, index) => nearestRoute(places, index))
    .reduce((best, route) => routeDistance(route) < routeDistance(best) ? route : best)
}

function startDateFor(day, places) {
  const firstDate = places.find((place) => place.date)?.date
  const date = firstDate ? new Date(firstDate) : new Date()
  date.setHours(0, 0, 0, 0)
  return new Date(date.getTime() + (day - 1) * DAY_MS).toISOString()
}

function buildSchedule(route, city) {
  const grouped = new Map()
  route.destinations.filter(isScheduled).forEach((place) => {
    const day = Number(place.day) || 1
    const items = grouped.get(day) || []
    items.push(place)
    grouped.set(day, items)
  })
  return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]).map(([day, items]) => ({
    day,
    date: startDateFor(day, route.destinations),
    city,
    activities: items.sort((a, b) => a.withinDayOrder - b.withinDayOrder).map((place) => `${place.withinDayOrder}. ${place.name}`),
    accommodation: `${city}住宿待定`,
    notes: '行程由 CROSS 调整，可继续通过对话修改。'
  }))
}

function normalizePlan(plan, city) {
  const scheduled = plan.route.destinations
    .filter(isScheduled)
    .sort((a, b) => (Number(a.day) || 1) - (Number(b.day) || 1) || (Number(a.withinDayOrder) || a.order) - (Number(b.withinDayOrder) || b.order))
  const unscheduled = plan.route.destinations.filter((place) => !isScheduled(place))
  const dayCounts = new Map()
  scheduled.forEach((place, index) => {
    const day = Math.max(1, Math.min(plan.route.estimatedDays || 1, Number(place.day) || 1))
    const withinDayOrder = (dayCounts.get(day) || 0) + 1
    dayCounts.set(day, withinDayOrder)
    Object.assign(place, {
      day,
      withinDayOrder,
      order: index + 1,
      date: startDateFor(day, scheduled),
      planningStatus: 'scheduled'
    })
  })
  unscheduled.forEach((place, index) => {
    Object.assign(place, { order: scheduled.length + index + 1, day: undefined, withinDayOrder: undefined })
  })
  plan.route.destinations = [...scheduled, ...unscheduled]
  plan.route.totalDistance = scheduled.reduce((total, place, index) => {
    const previous = scheduled[index - 1]
    return !previous || previous.day !== place.day ? total : total + distanceKm(previous.coordinates, place.coordinates)
  }, 0)
  plan.schedule = buildSchedule(plan.route, city)
  plan.warnings = Array.isArray(plan.warnings) ? plan.warnings : []
  return plan
}

export function validatePlan(plan) {
  const errors = []
  const ids = new Set()
  for (const place of plan.route.destinations || []) {
    if (!place?.id || ids.has(place.id)) errors.push(`地点 ID 重复或缺失：${place?.name || '未知地点'}`)
    ids.add(place?.id)
    if (!Array.isArray(place?.coordinates) || place.coordinates.length !== 2 || place.coordinates.some((value) => !Number.isFinite(Number(value)))) {
      errors.push(`地点坐标无效：${place?.name || place?.id}`)
    }
    if (place.poiStatus === 'avoid' && isScheduled(place)) errors.push(`不想去的地点不能进入正式行程：${place.name}`)
    if (isScheduled(place) && (Number(place.day) < 1 || Number(place.day) > plan.route.estimatedDays)) {
      errors.push(`地点天数超出范围：${place.name}`)
    }
  }
  return errors
}

export function applyPlanOperations(currentPlan, operations, { city, pace }) {
  const plan = clone(currentPlan)
  const changes = []
  const warnings = []

  for (const operation of operations) {
    const places = plan.route.destinations
    const index = places.findIndex((place) => place.id === operation.poiId)
    const place = index >= 0 ? places[index] : null

    if (operation.type === 'optimize_route_order') {
      let changed = false
      const days = [...new Set(places.filter(isScheduled).map((item) => Number(item.day) || 1))]
      for (const day of days) {
        const dayPlaces = places
          .filter((item) => isScheduled(item) && Number(item.day) === day)
          .sort((a, b) => (Number(a.withinDayOrder) || a.order) - (Number(b.withinDayOrder) || b.order))
        const optimized = optimizeOrder(dayPlaces)
        if (optimized.some((item, position) => item.id !== dayPlaces[position]?.id)) changed = true
        optimized.forEach((item, position) => { item.withinDayOrder = position + 1 })
      }
      if (changed) changes.push({ type: operation.type, message: '已按地点距离优化每天的游览顺序' })
      else warnings.push('当前每天的地点顺序已经较为紧凑。')
    } else if (operation.type === 'lock_poi' && place) {
      place.locked = true
      changes.push({ type: operation.type, message: `已保留并锁定：${place.name}` })
    } else if (operation.type === 'unlock_poi' && place) {
      place.locked = false
      changes.push({ type: operation.type, message: `已解除锁定：${place.name}` })
    } else if (operation.type === 'remove_poi' && place) {
      if (place.locked || place.poiStatus === 'must_go') throw new Error(`“${place.name}”已锁定或属于必去地点，不能直接删除。`)
      places.splice(index, 1)
      changes.push({ type: operation.type, message: `已移除：${place.name}` })
    } else if (operation.type === 'move_poi' && place) {
      const targetDay = Number(operation.targetDay)
      if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > plan.route.estimatedDays) throw new Error('目标日期超出当前行程范围。')
      place.day = targetDay
      place.withinDayOrder = Number(operation.targetIndex) || 99
      place.planningStatus = 'scheduled'
      changes.push({ type: operation.type, message: `已将 ${place.name} 移至第 ${targetDay} 天` })
    } else if (operation.type === 'reorder_poi' && place) {
      const peers = places
        .filter((item) => item.id !== place.id && isScheduled(item) && Number(item.day) === Number(place.day))
        .sort((a, b) => (Number(a.withinDayOrder) || a.order) - (Number(b.withinDayOrder) || b.order))
      const targetIndex = Math.max(0, Math.min(peers.length, (Number(operation.targetIndex) || 1) - 1))
      peers.splice(targetIndex, 0, place)
      peers.forEach((item, position) => { item.withinDayOrder = position + 1 })
      changes.push({ type: operation.type, message: `已调整 ${place.name} 的日内顺序` })
    } else if (operation.type === 'replace_poi' && place && operation.replacement) {
      if (place.locked || place.poiStatus === 'must_go') throw new Error(`“${place.name}”已锁定或属于必去地点，不能直接替换。`)
      const replacement = { ...operation.replacement, day: place.day, withinDayOrder: place.withinDayOrder, planningStatus: 'scheduled' }
      places.splice(index, 1, replacement)
      changes.push({ type: operation.type, message: `已将 ${place.name} 替换为 ${replacement.name}` })
    } else if (operation.type === 'add_poi' && operation.poi) {
      const targetDay = Math.max(1, Math.min(plan.route.estimatedDays, Number(operation.targetDay) || 1))
      places.push({ ...operation.poi, day: targetDay, withinDayOrder: 99, planningStatus: 'scheduled' })
      changes.push({ type: operation.type, message: `已在第 ${targetDay} 天加入 ${operation.poi.name}` })
    } else if (operation.type === 'change_day_pace' || operation.type === 'replan_day') {
      const targetDay = Number(operation.targetDay)
      if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > plan.route.estimatedDays) throw new Error('需要明确要调整的行程日期。')
      const limit = (operation.pace || pace) === '轻松' ? 3 : (operation.pace || pace) === '紧凑' ? 5 : 4
      const dayPlaces = places.filter((item) => isScheduled(item) && Number(item.day) === targetDay)
      const removable = dayPlaces.filter((item) => !item.locked && item.poiStatus !== 'must_go')
      while (dayPlaces.length > limit && removable.length) {
        const removed = removable.pop()
        removed.planningStatus = 'unscheduled'
        removed.day = undefined
        removed.withinDayOrder = undefined
        dayPlaces.pop()
        changes.push({ type: operation.type, message: `已将 ${removed.name} 移到待规划，使第 ${targetDay} 天更轻松` })
      }
      if (dayPlaces.length > limit) warnings.push(`第 ${targetDay} 天仍包含锁定或必去地点，无法继续自动精简。`)
      if (!changes.some((change) => change.type === operation.type)) warnings.push(`第 ${targetDay} 天已经符合${operation.pace || pace || '当前'}节奏。`)
    } else if (!['replan_all', 'create_plan'].includes(operation.type)) {
      warnings.push(`未执行无法定位目标的操作：${operation.type}`)
    }
  }

  normalizePlan(plan, city)
  const errors = validatePlan(plan)
  if (errors.length) throw new Error(errors[0])
  return { plan, changes, warnings }
}
