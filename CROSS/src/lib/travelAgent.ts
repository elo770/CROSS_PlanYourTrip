import type { AgentPlanInput, AgentPlanResult, DaySchedule, Destination, Route, TransportMode } from '@/types'

const DAY_MS = 86400000

function clampDays(days: number) {
  if (!Number.isFinite(days)) return 1
  return Math.max(1, Math.min(3, Math.round(days)))
}

function toDate(startDate: string | undefined, dayIndex: number) {
  const base = startDate ? new Date(startDate) : new Date()
  if (!Number.isFinite(base.getTime())) {
    return new Date(Date.now() + dayIndex * DAY_MS)
  }
  base.setHours(0, 0, 0, 0)
  return new Date(base.getTime() + dayIndex * DAY_MS)
}

function distanceKm(a: [number, number], b: [number, number]) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const radius = 6371
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

function routeDistance(destinations: Destination[]) {
  return destinations.reduce((sum, dest, index) => {
    if (index === 0) return sum
    return sum + distanceKm(destinations[index - 1].coordinates, dest.coordinates)
  }, 0)
}

function estimateTransport(distance: number): { mode: TransportMode; minutes: number } {
  if (distance <= 1.2) return { mode: 'walk', minutes: Math.max(10, Math.round(distance * 15)) }
  if (distance <= 8) return { mode: 'taxi', minutes: Math.round(12 + distance * 4) }
  return { mode: 'metro', minutes: Math.round(20 + distance * 3) }
}

function scoreDestination(dest: Destination) {
  if (dest.poiStatus === 'must_go') return 0
  if (dest.poiStatus === 'optional' || !dest.poiStatus) return 1
  return 2
}

function buildFallbackCandidates(input: AgentPlanInput, existingCount: number): Destination[] {
  if (existingCount >= 2) return []
  const names = input.interests?.trim()
    ? [`${input.city}${input.interests.trim()}体验点`]
    : [`${input.city}城市漫步点`]

  return names.map((name, index) => ({
    id: `agent-candidate-${Date.now()}-${index}`,
    name,
    description: 'Agent 补充候选地点，需后续用高德 POI 确认具体位置',
    coordinates: [116.397428, 39.90923],
    order: existingCount + index + 1,
    poiStatus: 'optional',
    visitDurationMinutes: 90,
    openingHours: '待确认',
    agentNote: '候选点需要 POI 确认'
  }))
}

export function buildAgentPlanDraft(input: AgentPlanInput, sourceDestinations: Destination[]): AgentPlanResult {
  const days = clampDays(input.days)
  const warnings: string[] = []

  if (input.days !== days) {
    warnings.push('第一版只支持 1-3 日游，已自动限制在范围内。')
  }

  const usable = sourceDestinations
    .filter((dest) => dest.poiStatus !== 'avoid')
    .slice()
    .sort((a, b) => scoreDestination(a) - scoreDestination(b) || (a.order ?? 0) - (b.order ?? 0))

  if (sourceDestinations.some((dest) => dest.poiStatus === 'avoid')) {
    warnings.push('已排除“不想去”的 POI。')
  }

  const withCandidates = [...usable, ...buildFallbackCandidates(input, usable.length)]
  if (withCandidates.length === 0) {
    warnings.push('当前没有可规划 POI，请先收藏或搜索地点。')
  }

  const perDayLimit = 4
  const maxPoints = days * perDayLimit
  const selected = withCandidates.slice(0, maxPoints)
  if (withCandidates.length > maxPoints) {
    warnings.push(`每天最多先安排 ${perDayLimit} 个 POI，其余地点暂不放入草案。`)
  }

  let lastPoint: Destination | null = null
  const planned = selected.map((dest, index) => {
    const day = Math.floor(index / perDayLimit) + 1
    const withinDayOrder = (index % perDayLimit) + 1
    const travel = lastPoint ? estimateTransport(distanceKm(lastPoint.coordinates, dest.coordinates)) : { mode: 'walk' as TransportMode, minutes: 0 }
    lastPoint = dest

    return {
      ...dest,
      order: index + 1,
      day,
      withinDayOrder,
      date: toDate(input.startDate, day - 1).toISOString(),
      poiStatus: dest.poiStatus || 'optional',
      openingHours: dest.openingHours || '待确认',
      visitDurationMinutes: dest.visitDurationMinutes || 90,
      transportMode: travel.mode,
      travelTimeMinutes: travel.minutes,
      agentNote: dest.agentNote || '规则版 Agent 草案，交通与营业时间需要接 API 后精确校验'
    } satisfies Destination
  })

  const route: Route = {
    id: `agent-route-${Date.now()}`,
    name: `${input.city || '单城市'} ${days}日 Agent 草案`,
    destinations: planned,
    totalDistance: routeDistance(planned),
    estimatedDays: days
  }

  const schedule: DaySchedule[] = Array.from({ length: days }, (_, index) => {
    const day = index + 1
    const items = planned.filter((dest) => dest.day === day)
    return {
      day,
      date: toDate(input.startDate, index),
      city: input.city || '目的地城市',
      activities: items.map((dest) => {
        const statusText = dest.poiStatus === 'must_go' ? '必去' : '可选'
        return `${dest.withinDayOrder}. ${dest.name}（${statusText}，游览约 ${dest.visitDurationMinutes} 分钟，交通：${dest.transportMode} ${dest.travelTimeMinutes} 分钟）`
      }),
      accommodation: `${input.city || '当地'}住宿待定`,
      notes: input.constraints || '请确认营业时间、预约要求和实际交通时间。'
    }
  })

  if (planned.some((dest) => dest.openingHours === '待确认')) {
    warnings.push('部分 POI 营业时间仍为待确认，后续需要接高德/人工确认。')
  }

  return { route, schedule, warnings }
}
