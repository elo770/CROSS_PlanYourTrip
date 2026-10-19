import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentPlanResult, Destination, Route, DaySchedule, BudgetItem, TripSnapshot, Trip, TransportMode, TransportSegment } from '@/types'
import { defaultTransportMode } from '@/lib/transportRules'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API ${response.status}: ${text}`)
  }

  return response.json() as Promise<T>
}

function segmentId(fromDestinationId: string, toDestinationId: string) {
  return `${fromDestinationId}--${toDestinationId}`
}

function readyTransportDistance(segments: TransportSegment[]) {
  return segments.reduce((sum, segment) => sum + (segment.status === 'ready' ? segment.distanceMeters || 0 : 0), 0) / 1000
}

function sameCoordinates(a: [number, number] | undefined, b: [number, number]) {
  return Boolean(a && a[0] === b[0] && a[1] === b[1])
}

function isScheduledDestination(destination: Destination) {
  return destination.planningStatus !== 'unscheduled' &&
    destination.planningStatus !== 'candidate' &&
    destination.planningStatus !== 'rejected'
}

function normalizeDestinations(rawDestinations: Destination[]) {
  return (rawDestinations || [])
    .map((d, idx) => {
      const anyD = d as any
      const c0 = anyD?.coordinates?.[0]
      const c1 = anyD?.coordinates?.[1]
      const rawLng = c0 ?? anyD?.lng ?? anyD?.longitude
      const rawLat = c1 ?? anyD?.lat ?? anyD?.latitude
      let lng = Number(rawLng)
      let lat = Number(rawLat)

      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        const looksLikeLatLng =
          Math.abs(lng) <= 90 && Math.abs(lat) > 90 && Math.abs(lat) <= 180
        if (looksLikeLatLng) {
          const tmp = lng
          lng = lat
          lat = tmp
        }
      }

      return {
        ...d,
        coordinates: [lng, lat] as [number, number],
        order: typeof d.order === 'number' ? d.order : idx + 1
      }
    })
    .filter((d) => Number.isFinite(d.coordinates[0]) && Number.isFinite(d.coordinates[1]))
}

export const useTripStore = defineStore('trip', () => {
  // 鐩殑鍦板垪琛?
  const destinations = ref<Destination[]>([])
  const currentTrip = ref<Trip | null>(null)
  
  // 褰撳墠璺嚎
  const currentRoute = ref<Route | null>(null)
  const tripStartDate = ref('')
  const transportSegments = ref<TransportSegment[]>([])
  const directionRequestVersions = new Map<string, number>()
  
  // 鏃ョ▼瀹夋帓
  const schedule = ref<DaySchedule[]>([])

  function dateForTripDay(day: number) {
    if (!tripStartDate.value) return undefined
    const date = new Date(`${tripStartDate.value}T12:00:00`)
    date.setDate(date.getDate() + day - 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  
  // 棰勭畻椤圭洰
  const budgetItems = ref<BudgetItem[]>([])
  
  // 淇濆瓨鐨勮矾绾垮垪琛?
  const savedRoutes = ref<Route[]>([])
  const isRouteDirty = ref(false)

  function markRouteDirty() {
    isRouteDirty.value = true
  }

  function markRouteSaved() {
    isRouteDirty.value = false
  }

  function orderedTransportEdges() {
    const grouped = new Map<number, Destination[]>()
    destinations.value.filter(isScheduledDestination).forEach((destination) => {
      const day = Math.max(1, Number(destination.day) || 1)
      const items = grouped.get(day) || []
      items.push(destination)
      grouped.set(day, items)
    })

    return Array.from(grouped.entries()).flatMap(([day, items]) => {
      const ordered = items.sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
      return ordered.slice(1).map((destination, index) => ({
        id: segmentId(ordered[index].id, destination.id),
        day,
        from: ordered[index],
        to: destination
      }))
    })
  }

  function syncCurrentRouteTransport() {
    if (!currentRoute.value) return
    currentRoute.value = {
      ...currentRoute.value,
      destinations: destinations.value,
      transportSegments: transportSegments.value,
      totalDistance: readyTransportDistance(transportSegments.value)
    }
  }

  function replaceTransportSegment(segment: TransportSegment) {
    const index = transportSegments.value.findIndex((item) => item.id === segment.id)
    if (index >= 0) transportSegments.value[index] = segment
    else transportSegments.value.push(segment)
    syncCurrentRouteTransport()
  }

  async function requestDirection(origin: [number, number], destination: [number, number], mode: TransportMode) {
    return apiRequest<{
      mode: TransportMode
      distanceMeters: number
      durationSeconds: number
      path: [number, number][]
      provider: 'amap'
      fetchedAt: string
    }>('/directions/segment', {
      method: 'POST',
      body: JSON.stringify({ origin, destination, mode })
    })
  }

  async function resolveTransportSegment(id: string) {
    const edge = orderedTransportEdges().find((item) => item.id === id)
    const current = transportSegments.value.find((item) => item.id === id)
    if (!edge || !current) return

    const requestVersion = (directionRequestVersions.get(id) || 0) + 1
    directionRequestVersions.set(id, requestVersion)
    replaceTransportSegment({ ...current, day: edge.day, status: 'loading', error: undefined, path: undefined })

    try {
      let mode = current.mode
      let result
      if (current.modeSource === 'default') {
        result = await requestDirection(edge.from.coordinates, edge.to.coordinates, 'walk')
        mode = defaultTransportMode(result.distanceMeters)
        if (mode === 'drive') result = await requestDirection(edge.from.coordinates, edge.to.coordinates, 'drive')
      } else {
        result = await requestDirection(edge.from.coordinates, edge.to.coordinates, mode)
      }
      if (directionRequestVersions.get(id) !== requestVersion || !orderedTransportEdges().some((item) => item.id === id)) return
      replaceTransportSegment({
        ...current,
        day: edge.day,
        mode,
        status: 'ready',
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
        path: result.path,
        provider: result.provider,
        fetchedAt: result.fetchedAt,
        error: undefined
      })
    } catch (error) {
      if (directionRequestVersions.get(id) !== requestVersion || !orderedTransportEdges().some((item) => item.id === id)) return
      replaceTransportSegment({
        ...current,
        day: edge.day,
        status: 'failed',
        distanceMeters: undefined,
        durationSeconds: undefined,
        path: undefined,
        error: error instanceof Error ? error.message : '未获取到路线'
      })
    }
  }

  function refreshTransportSegments(options: { forceIds?: string[] } = {}) {
    const forceIds = new Set(options.forceIds || [])
    const existing = new Map(transportSegments.value.map((segment) => [segment.id, segment]))
    const now = Date.now()
    const edges = orderedTransportEdges()
    transportSegments.value = edges.map((edge) => {
      const saved = existing.get(edge.id)
      const coordinatesChanged = saved && (
        !sameCoordinates(saved.origin, edge.from.coordinates) ||
        !sameCoordinates(saved.destination, edge.to.coordinates)
      )
      return saved
        ? {
            ...saved,
            origin: edge.from.coordinates,
            destination: edge.to.coordinates,
            day: edge.day,
            ...(coordinatesChanged ? {
              status: 'loading' as const,
              distanceMeters: undefined,
              durationSeconds: undefined,
              path: undefined,
              fetchedAt: undefined,
              error: undefined
            } : {})
          }
        : {
            id: edge.id,
            fromDestinationId: edge.from.id,
            toDestinationId: edge.to.id,
            origin: edge.from.coordinates,
            destination: edge.to.coordinates,
            day: edge.day,
            mode: 'walk' as const,
            modeSource: 'default' as const,
            status: 'loading' as const
          }
    })
    syncCurrentRouteTransport()

    for (const segment of transportSegments.value) {
      const isFresh = segment.status === 'ready' && segment.fetchedAt && now - new Date(segment.fetchedAt).getTime() < 24 * 60 * 60 * 1000
      if (!forceIds.has(segment.id) && (isFresh || segment.status === 'failed')) continue
      void resolveTransportSegment(segment.id)
    }
  }

  function setTransportMode(id: string, mode: TransportMode) {
    const segment = transportSegments.value.find((item) => item.id === id)
    if (!segment) return
    replaceTransportSegment({ ...segment, mode, modeSource: 'manual', status: 'loading', fetchedAt: undefined })
    markRouteDirty()
    void resolveTransportSegment(id)
  }

  function retryTransportSegment(id: string) {
    if (!transportSegments.value.some((segment) => segment.id === id)) return
    void resolveTransportSegment(id)
  }
  
  // 璁＄畻灞炴€?
  const totalBudget = computed(() => {
    return budgetItems.value.reduce((sum, item) => sum + item.amount, 0)
  })
  
  const budgetByType = computed(() => {
    const map = new Map<string, number>()
    budgetItems.value.forEach(item => {
      const current = map.get(item.type) || 0
      map.set(item.type, current + item.amount)
    })
    return Object.fromEntries(map)
  })
  
  const budgetByDay = computed(() => {
    const map = new Map<number, number>()
    budgetItems.value.forEach(item => {
      const current = map.get(item.day) || 0
      map.set(item.day, current + item.amount)
    })
    return Object.fromEntries(map)
  })
  
  /** 根据地点的 day/withinDayOrder 重建日程，保证地图和日程共享同一分天结果。 */
  function regenerateScheduleFromDestinations(dests: Destination[]) {
    const scheduled = dests.filter(isScheduledDestination)
    if (!scheduled.length) {
      schedule.value = []
      return
    }
    const grouped = new Map<number, Destination[]>()
    scheduled.forEach((dest) => {
      const day = Math.max(1, Number(dest.day) || 1)
      const items = grouped.get(day) || []
      items.push(dest)
      grouped.set(day, items)
    })
    schedule.value = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, items]) => {
        const ordered = items.slice().sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
        ordered.forEach((dest, index) => { dest.withinDayOrder = index + 1 })
        const date = dateForTripDay(day)
        return {
          day,
          date: date ? new Date(`${date}T00:00:00`) : undefined,
          city: currentRoute.value?.name || ordered[0]?.name || '',
          activities: ordered.map((dest) => `${dest.withinDayOrder}. ${dest.name}`),
          accommodation: '',
          notes: ordered.map((dest) => dest.agentNote || dest.description).filter(Boolean).join('；')
        } satisfies DaySchedule
      })
  }

  function commitDestinationEdits(nextDestinations: Destination[]) {
    const scheduled = nextDestinations.filter(isScheduledDestination)
    const unscheduled = nextDestinations.filter((destination) => !isScheduledDestination(destination))
    const grouped = new Map<number, Destination[]>()

    scheduled.forEach((destination) => {
      const day = Math.max(1, Number(destination.day) || 1)
      const items = grouped.get(day) || []
      items.push({ ...destination, day })
      grouped.set(day, items)
    })

    const ordered: Destination[] = [...Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .flatMap(([, items]) => items
        .sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
        .map((destination, index) => ({ ...destination, withinDayOrder: index + 1, date: dateForTripDay(destination.day || 1) }))),
      ...unscheduled.map((destination) => ({ ...destination, date: undefined }))]
      .map((destination, index) => ({ ...destination, order: index + 1 }))

    destinations.value = normalizeDestinations(ordered)
    if (currentRoute.value) {
      const routeDestinations = destinations.value.filter(isScheduledDestination)
      currentRoute.value = {
        ...currentRoute.value,
        destinations: destinations.value,
        totalDistance: readyTransportDistance(transportSegments.value),
        estimatedDays: Math.max(new Set(routeDestinations.map((destination) => destination.day || 1)).size, 1)
      }
    }
    regenerateScheduleFromDestinations(destinations.value)
    refreshTransportSegments()
    markRouteDirty()
  }

  function updateDestinationDetails(id: string, partial: Partial<Destination>) {
    const current = destinations.value.find((destination) => destination.id === id)
    if (!current) return

    const targetDay = partial.day == null ? current.day : Math.max(1, Number(partial.day) || 1)
    const dayChanged = Number(targetDay || 1) !== Number(current.day || 1)
    const targetDaySize = destinations.value.filter((destination) =>
      destination.id !== id && isScheduledDestination(destination) && Number(destination.day || 1) === Number(targetDay || 1)
    ).length
    const updated = {
      ...current,
      ...partial,
      day: targetDay,
      withinDayOrder: dayChanged ? targetDaySize + 1 : current.withinDayOrder
    }

    commitDestinationEdits(destinations.value.map((destination) => destination.id === id ? updated : destination))
  }

  function moveDestinationToDay(id: string, targetDay: number, targetIndex?: number) {
    const current = destinations.value.find((destination) => destination.id === id)
    if (!current) return

    const safeDay = Math.max(1, Number(targetDay) || 1)
    const targetItems = destinations.value
      .filter((destination) => destination.id !== id && isScheduledDestination(destination) && Number(destination.day || 1) === safeDay)
      .sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
    const insertAt = Math.max(0, Math.min(targetIndex ?? targetItems.length, targetItems.length))
    targetItems.splice(insertAt, 0, { ...current, day: safeDay, planningStatus: 'scheduled' })
    const targetOrder = new Map(targetItems.map((destination, index) => [destination.id, index + 1]))

    commitDestinationEdits(destinations.value.map((destination) => {
      if (destination.id === id) return {
        ...destination,
        day: safeDay,
        withinDayOrder: targetOrder.get(id),
        planningStatus: 'scheduled' as const
      }
      const order = targetOrder.get(destination.id)
      return order ? { ...destination, withinDayOrder: order } : destination
    }))
  }

  function moveDestinationToUnscheduled(id: string) {
    commitDestinationEdits(destinations.value.map((destination) => destination.id === id
      ? { ...destination, day: undefined, withinDayOrder: undefined, planningStatus: 'unscheduled' as const }
      : destination))
  }

  function setTripStartDate(startDate: string) {
    if (startDate && Number.isNaN(new Date(`${startDate}T12:00:00`).getTime())) return
    tripStartDate.value = startDate
    if (currentRoute.value) currentRoute.value = { ...currentRoute.value, startDate: startDate || undefined }
    commitDestinationEdits(destinations.value)
  }

  function reorderDestinationWithinDay(id: string, direction: 'up' | 'down') {
    const current = destinations.value.find((destination) => destination.id === id)
    if (!current || !isScheduledDestination(current)) return

    const day = Number(current.day || 1)
    const dayItems = destinations.value
      .filter((destination) => isScheduledDestination(destination) && Number(destination.day || 1) === day)
      .sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
    const currentIndex = dayItems.findIndex((destination) => destination.id === id)
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= dayItems.length) return

    ;[dayItems[currentIndex], dayItems[targetIndex]] = [dayItems[targetIndex], dayItems[currentIndex]]
    const dayOrder = new Map(dayItems.map((destination, index) => [destination.id, index + 1]))
    commitDestinationEdits(destinations.value.map((destination) => {
      const order = dayOrder.get(destination.id)
      return order ? { ...destination, withinDayOrder: order } : destination
    }))
  }

  function updateDayDate(day: number, date: string) {
    commitDestinationEdits(destinations.value.map((destination) =>
      isScheduledDestination(destination) && Number(destination.day || 1) === day
        ? { ...destination, date }
        : destination
    ))
  }

  function createTripSnapshot(): TripSnapshot {
    return JSON.parse(JSON.stringify({
      route: currentRoute.value,
      destinations: destinations.value,
      schedule: schedule.value
    })) as TripSnapshot
  }

  function restoreTripSnapshot(snapshot: TripSnapshot) {
    destinations.value = normalizeDestinations(snapshot.destinations || [])
    currentRoute.value = snapshot.route ? { ...snapshot.route, destinations: destinations.value } : null
    tripStartDate.value = snapshot.route?.startDate || ''
    transportSegments.value = snapshot.route?.transportSegments || []
    schedule.value = (snapshot.schedule || []).map((day) => ({ ...day, date: day.date ? new Date(day.date) : undefined }))
    refreshTransportSegments()
    markRouteDirty()
  }

  function applyAgentPlan(plan: AgentPlanResult, options: { markDirty?: boolean } = {}) {
    const normalized = normalizeDestinations(plan.route.destinations || [])
    destinations.value = normalized
    transportSegments.value = plan.route.transportSegments || []
    currentRoute.value = {
      ...plan.route,
      destinations: normalized,
      transportSegments: transportSegments.value,
      totalDistance: readyTransportDistance(transportSegments.value)
    }
    tripStartDate.value = plan.route.startDate || ''
    schedule.value = (plan.schedule || []).map((day) => ({ ...day, date: day.date ? new Date(day.date) : undefined }))
    if (!schedule.value.length) regenerateScheduleFromDestinations(normalized)
    refreshTransportSegments()
    if (options.markDirty !== false) markRouteDirty()
  }

  function applyTripOutline(trip: Trip) {
    currentTrip.value = trip
    const detailed = trip.segments.find((segment) => segment.status === 'detailed')
    if (detailed) {
      applyAgentPlan({
        route: { id: trip.id, name: trip.title, destinations: detailed.destinations, estimatedDays: detailed.days, totalDistance: 0 },
        schedule: detailed.schedule,
        warnings: []
      })
    }
    markRouteDirty()
  }

  // 娣诲姞鐩殑鍦?
  function addDestination(destination: Destination) {
    destinations.value.push(destination)
    regenerateScheduleFromDestinations(destinations.value)
    refreshTransportSegments()
    markRouteDirty()
  }

  // 鍒犻櫎鐩殑鍦?
  function removeDestination(id: string) {
    const index = destinations.value.findIndex(d => d.id === id)
    if (index > -1) {
      destinations.value.splice(index, 1)
    }
    regenerateScheduleFromDestinations(destinations.value)
    refreshTransportSegments()
    markRouteDirty()
  }

  // 鏇存柊鐩殑鍦伴『搴?
  function updateDestinationOrder(newOrder: Destination[]) {
    destinations.value = newOrder
    regenerateScheduleFromDestinations(destinations.value)
    refreshTransportSegments()
    markRouteDirty()
  }

  // 鏇存柊鐩殑鍦颁俊鎭?
  function updateDestination(destinationOrId: Destination | string, partial?: Partial<Destination>) {
    if (typeof destinationOrId === 'string') {
      const idx = destinations.value.findIndex(d => d.id === destinationOrId)
      if (idx > -1 && partial) {
        destinations.value[idx] = { ...destinations.value[idx], ...partial }
      }
    } else {
      const index = destinations.value.findIndex(d => d.id === destinationOrId.id)
      if (index !== -1) {
        destinations.value[index] = destinationOrId
      }
    }
    regenerateScheduleFromDestinations(destinations.value)
    refreshTransportSegments()
    markRouteDirty()
  }

  // 璁剧疆褰撳墠璺嚎锛涢粯璁ゆ牴鎹洰鐨勫湴閲嶇畻鏃ョ▼锛岄璁捐矾绾垮彲 skip
  function setRoute(route: Route | null, opts?: { skipScheduleRegeneration?: boolean }) {
    currentRoute.value = route
    tripStartDate.value = route?.startDate || ''
    transportSegments.value = route?.transportSegments || []
    if (!opts?.skipScheduleRegeneration && route?.destinations?.length) {
      regenerateScheduleFromDestinations(route.destinations)
    } else if (!opts?.skipScheduleRegeneration) {
      schedule.value = []
    }
    if (route) refreshTransportSegments()
  }

  function clearPlanningState(options: { markDirty?: boolean } = {}) {
    destinations.value = []
    currentTrip.value = null
    currentRoute.value = null
    tripStartDate.value = ''
    transportSegments.value = []
    directionRequestVersions.clear()
    schedule.value = []
    if (options.markDirty !== false) markRouteDirty()
  }

  function buildCurrentRoute(opts?: { id?: string; name?: string }): Route {
    const scheduled = destinations.value.filter(isScheduledDestination)
    return {
      id: opts?.id || currentRoute.value?.id || `trip-${Date.now()}`,
      name: opts?.name || currentRoute.value?.name || '鎴戠殑鏃呰璺嚎',
      destinations: destinations.value,
      transportSegments: transportSegments.value,
      totalDistance: readyTransportDistance(transportSegments.value),
      estimatedDays: Math.max(1, ...scheduled.map((dest) => Number(dest.day) || 1)),
      startDate: tripStartDate.value || undefined
    }
  }

  function refreshCurrentRoute(opts?: { id?: string; name?: string }) {
    if (destinations.value.length === 0) {
      setRoute(null)
      return null
    }
    const route = buildCurrentRoute(opts)
    setRoute(route)
    return route
  }
  
  // 娣诲姞鏃ョ▼
  function addSchedule(daySchedule: DaySchedule) {
    schedule.value.push(daySchedule)
    schedule.value.sort((a, b) => a.day - b.day)
  }
  
  // 鏇存柊鏃ョ▼
  function updateSchedule(day: number, daySchedule: Partial<DaySchedule>) {
    const index = schedule.value.findIndex(s => s.day === day)
    if (index > -1) {
      schedule.value[index] = { ...schedule.value[index], ...daySchedule }
    } else {
      schedule.value.push({ day, ...daySchedule } as DaySchedule)
      schedule.value.sort((a, b) => a.day - b.day)
    }
  }
  
  // 娣诲姞棰勭畻椤?
  async function addBudgetItem(item: BudgetItem) {
    const nextItems = [...budgetItems.value, item]
    localStorage.setItem('budgetItems', JSON.stringify(nextItems))
    budgetItems.value = nextItems
  }
  
  // 鍒犻櫎棰勭畻椤?
  async function removeBudgetItem(id: string) {
    const nextItems = budgetItems.value.filter(item => item.id !== id)
    localStorage.setItem('budgetItems', JSON.stringify(nextItems))
    budgetItems.value = nextItems
  }
  
  // 鍔犺浇棰勮璺嚎
  function loadPresetRoute(routeName: string) {
    if (routeName === 'europe-free') loadEuropeFreeRoute()
    if (routeName === 'jiangzhehu') loadJiangZheHuRoute()
    if (routeName === 'beijing-two-day') loadBeijingTwoDayRoute()
    markRouteDirty()
  }
  
  // 保存路线到列表
  async function saveRouteToList(route: Route) {
    const cleanedDestinations = normalizeDestinations(route.destinations || [])
    const routeToSave = {
      ...route,
      destinations: cleanedDestinations,
      transportSegments: route.transportSegments || transportSegments.value,
      totalDistance: readyTransportDistance(route.transportSegments || transportSegments.value),
      estimatedDays: Math.max(route.estimatedDays || cleanedDestinations.length || 1, 1)
    }
    const nextRoutes = [...savedRoutes.value]
    const existingIndex = nextRoutes.findIndex(r => r.id === routeToSave.id)
    if (existingIndex > -1) {
      nextRoutes[existingIndex] = routeToSave
    } else {
      nextRoutes.push(routeToSave)
    }
    localStorage.setItem('savedRoutes', JSON.stringify(nextRoutes))
    savedRoutes.value = nextRoutes
    markRouteSaved()
  }

  async function renameSavedRoute(routeId: string, name: string) {
    const index = savedRoutes.value.findIndex((route) => route.id === routeId)
    if (index < 0) return
    const renamed = { ...savedRoutes.value[index], name }
    const nextRoutes = [...savedRoutes.value]
    nextRoutes[index] = renamed
    localStorage.setItem('savedRoutes', JSON.stringify(nextRoutes))
    savedRoutes.value = nextRoutes
    if (currentRoute.value?.id === routeId) currentRoute.value = { ...currentRoute.value, name }
  }
  
  // 浠庡垪琛ㄥ姞杞借矾绾?
  function loadRouteFromList(routeId: string) {
    const route = savedRoutes.value.find(r => r.id === routeId)
    if (route) {
      // localStorage / 鍚庣鍥炴潵鐨勬暟鎹彲鑳藉瓨鍦ㄥ潗鏍囦负 string 鐨勬儏鍐碉紝杩欎細瀵艰嚧鍦板浘瑕佺礌涓嶆覆鏌?
      const cleanedDestinations = normalizeDestinations(route.destinations || [])
      destinations.value = cleanedDestinations
      transportSegments.value = route.transportSegments || []
      currentRoute.value = {
        ...route,
        destinations: cleanedDestinations,
        transportSegments: transportSegments.value,
        totalDistance: readyTransportDistance(transportSegments.value),
        estimatedDays: Math.max(route.estimatedDays || cleanedDestinations.length || 1, 1)
      }
      tripStartDate.value = route.startDate || ''
      regenerateScheduleFromDestinations(cleanedDestinations)
      refreshTransportSegments()
      currentTrip.value = null
      markRouteSaved()
    }
  }
  
  // 鍒犻櫎璺嚎
  async function deleteRoute(routeId: string) {
    const nextRoutes = savedRoutes.value.filter(r => r.id !== routeId)
    localStorage.setItem('savedRoutes', JSON.stringify(nextRoutes))
    savedRoutes.value = nextRoutes
  }
  
  // 鍒濆鍖栨椂鍔犺浇淇濆瓨鐨勮矾绾?
  function initSavedRoutes() {
    const saved = localStorage.getItem('savedRoutes')
    if (saved) {
      try {
        savedRoutes.value = JSON.parse(saved)
      } catch (e) {
        console.error('Failed to load saved routes', e)
      }
    }
    const savedBudget = localStorage.getItem('budgetItems')
    if (!savedBudget) return
    try {
      const items = JSON.parse(savedBudget)
      if (Array.isArray(items)) budgetItems.value = items
    } catch (error) {
      console.warn('Failed to load saved budget items:', error)
    }
  }
  
  // 鍒濆鍖?
  initSavedRoutes()

  function loadBeijingTwoDayRoute() {
    type SampleStop = { name: string; description: string; coordinates: [number, number]; placeCategory?: Destination['placeCategory'] }
    const dayOne: SampleStop[] = [
      { name: '地铁雍和宫A口', description: '逛完挺快的，动线很明确基本就是走一个长方形', coordinates: [116.417044, 39.949626] },
      { name: '地坛公园', description: '公园属性，大部分是绿植，适合散心', coordinates: [116.414443, 39.953777] },
      { name: '五道营胡同', description: '全是小店', coordinates: [116.412109, 39.948467] },
      { name: '观夏(国子监旗舰店)', description: '太高端了一个人不敢进，两个人还行', coordinates: [116.411781, 39.945597] },
      { name: '南门', description: '从这里进国子监', coordinates: [116.413257, 39.945613] },
      { name: '国子监', description: '我去的时候没什么人，不过也不是很有意思，就是看看建筑，看看墙上的介绍', coordinates: [116.413285, 39.946777] },
      { name: '雍和宫', description: '虔诚', coordinates: [116.417296, 39.947239] },
      { name: '紫光园酸奶站', description: '奶皮子酸奶，不过感觉奶皮子酸奶都一样', coordinates: [116.416857, 39.944792] },
      { name: '雍和炸鸡烧饼', description: '一般', coordinates: [116.41691, 39.942623] },
      { name: '鸦儿李记·清真烤鸭(北新桥店)', description: '烧饼第一口很普通，越吃越香，不过我记得只要一两块钱，建议买几个在路上当干粮，而且买烧饼的北京大爷大妈也挺多的，重在地道！', coordinates: [116.416966, 39.942051] },
      { name: '烘焙町面包店', description: '听说挺好吃的，但是之前都吃饱了没买过', coordinates: [116.416937, 39.941783] },
      { name: '余婆炸鸡', description: '一般吧，不难吃，但是也没多惊人的美味', coordinates: [116.416937, 39.941692] },
      { name: '梅潭村·糕饼铺', description: '惊人的美味！非常醇厚的奶酪芝士香，有一点点酸~上海or苏州有没有类似的啊，离开北京最心痛的事情之一就是没法吃到梅潭村的芝士酥', coordinates: [116.416985, 39.940544] },
      { name: '晨阳·北新桥烤鱿鱼', description: '炸串挺好吃的，听说西红柿炒刀削更好吃，下次尝尝', coordinates: [116.417059, 39.939628] },
      { name: '龍囍粤', description: '生滚粥好喝，甜品虽小但便宜，总体无功无过吧', coordinates: [116.417028, 39.939562], placeCategory: 'food' },
      { name: '北新桥C口，回家了孩子', description: '昏黄的灯光，古朴的胡同，满足你对北京胡同的一切美好幻想，最重要的是——没什么小商店，随便出片', coordinates: [116.417656, 39.940259] }
    ]
    const dayTwo: SampleStop[] = [
      { name: '北京站', description: '东城区 · 毛家湾胡同甲13号', coordinates: [116.427354, 39.90283] },
      { name: '中国国家博物馆', description: '据说逛一次巨累，主播现在仍未鼓起勇气前往', coordinates: [116.401304, 39.905374] },
      { name: '天安门', description: '东城区 · 长安街北侧', coordinates: [116.397463, 39.909187] },
      { name: '故宫博物院', description: '北京市东城区 · 景山前街4号', coordinates: [116.397029, 39.917839] },
      { name: '景山公园', description: '北京市西城区 · 景山西街44号', coordinates: [116.396551, 39.925875] },
      { name: '什刹海地铁站A2西北口', description: '故宫、国博逛完巨累，景山公园和天安门还好，大家依据体力选择吧', coordinates: [116.395822, 39.938272] },
      { name: '喜乐铺炸货(方砖厂店)', description: '土豆泥炸鸡，说是老北京的jollibee，感觉就是好吃的炸鸡，没那么惊艳，不排队可以去', coordinates: [116.399884, 39.938074] },
      { name: '梅潭村·糕饼铺(鼓楼店)', description: '挚爱（芝士酥）', coordinates: [116.396174, 39.939407] },
      { name: '紫光园·酸奶站(鼓楼福京熹店)', description: '没吃过的建议买一个', coordinates: [116.395913, 39.93955] },
      { name: '烤肉刘·清真(鼓楼什刹海店)', description: '挺好吃的', coordinates: [116.395867, 39.939812] },
      { name: '鼓楼', description: '在外面看看可以了', coordinates: [116.395937, 39.940781] },
      { name: '烟袋斜街', description: '警官，借个胆爱你 的朝圣之地，一直在做梦能在路上听见空哥的声音', coordinates: [116.394748, 39.939329] },
      { name: '后海酒吧街', description: '什刹海最好玩的地方（bushi）', coordinates: [116.392678, 39.939541] },
      { name: '清真•鸦儿李记•小馆(后海店)', description: '我爱的麻将烧饼又来了', coordinates: [116.393101, 39.939526] }
    ]
    const places: Destination[] = [dayOne, dayTwo].flatMap((stops, dayIndex) => stops.map((stop, index) => ({
      id: `beijing-day-${dayIndex + 1}-stop-${index + 1}`,
      ...stop,
      order: dayIndex === 0 ? index + 1 : dayOne.length + index + 1,
      day: dayIndex + 1,
      withinDayOrder: index + 1,
      planningStatus: 'scheduled'
    })))
    destinations.value = places
    setRoute({
      id: `beijing-sample-${crypto.randomUUID()}`,
      name: '北京漫游1',
      destinations: places,
      totalDistance: 0,
      estimatedDays: 2
    })
  }
  
  function loadEuropeFreeRoute() {
    const startDate = new Date('2026-06-01')
    const plan = [
      { id: 'e1', day: 1, within: 1, title: '抵达巴黎，入住酒店', location: '巴黎市区', lat: 48.8566, lng: 2.3522, description: '机场抵达后入住酒店，轻松适应时差' },
      { id: 'e2', day: 1, within: 2, title: '埃菲尔铁塔与战神广场', location: '埃菲尔铁塔', lat: 48.8584, lng: 2.2945, description: '经典地标拍照与城市漫步' },
      { id: 'e3', day: 2, within: 1, title: '卢浮宫参观', location: '卢浮宫', lat: 48.8606, lng: 2.3376, description: '安排半日参观，避免行程过满' },
      { id: 'e4', day: 2, within: 2, title: '杜乐丽花园散步', location: '杜乐丽花园', lat: 48.8639, lng: 2.3268, description: '博物馆后安排轻量休息点' },
      { id: 'e5', day: 3, within: 1, title: '日内瓦湖区漫步', location: '日内瓦湖', lat: 46.2044, lng: 6.1432, description: '城市湖畔散步与拍照' },
      { id: 'e6', day: 4, within: 1, title: '因特拉肯小镇', location: '因特拉肯', lat: 46.6863, lng: 7.8631, description: '山景小镇慢节奏游览' },
      { id: 'e7', day: 5, within: 1, title: '佛罗伦萨老城', location: '佛罗伦萨', lat: 43.7696, lng: 11.2558, description: '文艺复兴城市漫步' },
      { id: 'e8', day: 6, within: 1, title: '罗马斗兽场', location: '罗马斗兽场', lat: 41.8902, lng: 12.4922, description: '罗马经典历史地标' }
    ]

    const europe: Destination[] = plan
      .slice()
      .sort((a, b) => (a.day - b.day) || (a.within - b.within))
      .map((p, idx) => ({
        id: p.id,
        name: p.location,
        description: `${p.title}：${p.description}`,
        coordinates: [p.lng, p.lat],
        highlight: p.title,
        order: idx + 1,
        day: p.day,
        withinDayOrder: p.within,
        date: new Date(startDate.getTime() + (p.day - 1) * 86400000).toISOString()
      }))

    destinations.value = europe

    const route: Route = {
      id: 'euro_2026_03',
      name: '欧洲轻松自由行（6天示例）',
      destinations: europe,
      totalDistance: 0,
      estimatedDays: 6
    }

    const exampleBudget: BudgetItem[] = [
      { id: 'b1', tripId: route.id, day: 1, type: '交通', amount: 6200, currency: 'CNY', description: '往返欧洲机票' },
      { id: 'b2', tripId: route.id, day: 1, type: '住宿', amount: 5600, currency: 'CNY', description: '5晚酒店/民宿' },
      { id: 'b3', tripId: route.id, day: 1, type: '餐饮', amount: 1800, currency: 'CNY', description: '日常餐饮预算' },
      { id: 'b4', tripId: route.id, day: 1, type: '门票', amount: 900, currency: 'CNY', description: '博物馆与景点门票' }
    ]
    if (!budgetItems.value.some(item => item.tripId === route.id)) {
      const nextItems = [...budgetItems.value, ...exampleBudget]
      localStorage.setItem('budgetItems', JSON.stringify(nextItems))
      budgetItems.value = nextItems
    }

    setRoute(route, { skipScheduleRegeneration: true })
    const byDay = new Map<number, typeof plan>()
    for (const p of plan) {
      const arr = byDay.get(p.day) || []
      arr.push(p)
      byDay.set(p.day, arr)
    }
    schedule.value = Array.from(byDay.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, items]) => ({
        day,
        date: new Date(startDate.getTime() + (day - 1) * 86400000),
        city: items[0]?.location || '',
        activities: items.slice().sort((a, b) => a.within - b.within).map((x) => x.title),
        accommodation: '',
        notes: items.slice().sort((a, b) => a.within - b.within).map((x) => `${x.within}. ${x.title}：${x.description}`).join('；')
      }))
  }

  function loadJiangZheHuRoute() {
    const startDate = new Date('2026-04-25')
    const plan = [
      { id: 'hs1', day: 1, within: 1, city: '上海', title: '人民广场与城市中心', location: '人民广场', lat: 31.2304, lng: 121.4737, description: '从城市中心开始，适合作为抵达后的第一站' },
      { id: 'hs2', day: 1, within: 2, city: '上海', title: '豫园与老城漫步', location: '豫园', lat: 31.2270, lng: 121.4921, description: '下午游览古典园林和周边街巷' },
      { id: 'hs3', day: 1, within: 3, city: '上海', title: '外滩傍晚散步', location: '外滩', lat: 31.2381, lng: 121.4905, description: '傍晚抵达江岸，顺路看城市夜景' },
      { id: 'hs4', day: 2, within: 1, city: '上海', title: '武康路 Citywalk', location: '武康路', lat: 31.2115, lng: 121.4387, description: '上午沿街区慢走，观察历史建筑' },
      { id: 'hs5', day: 2, within: 2, city: '上海', title: '安福路街区漫步', location: '安福路', lat: 31.2165, lng: 121.4412, description: '与武康路相邻，适合咖啡和临时停留' },
      { id: 'hs6', day: 2, within: 3, city: '上海', title: '思南公馆散步', location: '思南公馆', lat: 31.2137, lng: 121.4691, description: '下午继续街区漫步，保持轻松节奏' },
      { id: 'hs7', day: 3, within: 1, city: '苏州', title: '苏州博物馆参观', location: '苏州博物馆', lat: 31.3245, lng: 120.6278, description: '上午从上海乘高铁抵达苏州；博物馆建议提前预约' },
      { id: 'hs8', day: 3, within: 2, city: '苏州', title: '拙政园游览', location: '拙政园', lat: 31.3264, lng: 120.6252, description: '与博物馆相邻，步行衔接' },
      { id: 'hs9', day: 3, within: 3, city: '苏州', title: '平江路傍晚漫步', location: '平江路', lat: 31.3151, lng: 120.6292, description: '沿历史街区慢走，结束当天行程' },
      { id: 'hs10', day: 4, within: 1, city: '苏州', title: '西园寺晨间游览', location: '西园寺', lat: 31.3156, lng: 120.5908, description: '上午先安排安静、节奏舒缓的寺院游览' },
      { id: 'hs11', day: 4, within: 2, city: '苏州', title: '留园参观', location: '留园', lat: 31.3143, lng: 120.5953, description: '与西园寺距离较近，减少往返' },
      { id: 'hs12', day: 4, within: 3, city: '苏州', title: '山塘街收尾', location: '山塘街', lat: 31.3110, lng: 120.6040, description: '下午沿河散步，根据返程时间灵活结束' }
    ]

    const jzh: Destination[] = plan
      .slice()
      .sort((a, b) => (a.day - b.day) || (a.within - b.within))
      .map((p, idx) => ({
        id: p.id,
        name: p.location,
        description: `${p.title}：${p.description}`,
        coordinates: [p.lng, p.lat],
        highlight: p.title,
        order: idx + 1,
        day: p.day,
        withinDayOrder: p.within,
        date: new Date(startDate.getTime() + (p.day - 1) * 86400000).toISOString(),
        planningStatus: 'scheduled',
        source: 'ai'
      }))

    jzh.push({
      id: 'hs13',
      name: '周庄古镇',
      description: '江苏省苏州市昆山市周庄镇全福路43号，暂未安排具体日期',
      coordinates: [120.85091, 31.114744],
      highlight: '周庄古镇',
      order: jzh.length + 1,
      planningStatus: 'unscheduled',
      source: 'user'
    })

    destinations.value = jzh

    const route: Route = {
      id: 'shanghai_suzhou_4d_2026_01',
      name: '上海—苏州 4 日',
      destinations: jzh,
      totalDistance: 0,
      estimatedDays: 4
    }

    const exampleBudget: BudgetItem[] = [
      { id: 'hsb1', tripId: route.id, day: 3, type: '交通', amount: 160, currency: 'CNY', description: '上海—苏州往返高铁及市内交通' },
      { id: 'hsb2', tripId: route.id, day: 1, type: '住宿', amount: 1800, currency: 'CNY', description: '上海 2 晚、苏州 1 晚住宿' },
      { id: 'hsb3', tripId: route.id, day: 1, type: '餐饮', amount: 800, currency: 'CNY', description: '四日餐饮与街区休息预算' },
      { id: 'hsb4', tripId: route.id, day: 3, type: '门票', amount: 260, currency: 'CNY', description: '豫园、拙政园、留园等门票' }
    ]
    if (!budgetItems.value.some(item => item.tripId === route.id)) {
      const nextItems = [...budgetItems.value, ...exampleBudget]
      localStorage.setItem('budgetItems', JSON.stringify(nextItems))
      budgetItems.value = nextItems
    }

    setRoute(route, { skipScheduleRegeneration: true })
    const byDay = new Map<number, typeof plan>()
    for (const p of plan) {
      const arr = byDay.get(p.day) || []
      arr.push(p)
      byDay.set(p.day, arr)
    }
    schedule.value = Array.from(byDay.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, items]) => ({
        day,
        date: new Date(startDate.getTime() + (day - 1) * 86400000),
        city: items[0]?.city || '',
        activities: items.slice().sort((a, b) => a.within - b.within).map((x) => x.title),
        accommodation: day <= 2 ? '上海市区' : day === 3 ? '苏州古城区' : '',
        notes: items.slice().sort((a, b) => a.within - b.within).map((x) => `${x.within}. ${x.title}：${x.description}`).join('；')
      }))
  }
  return {
    destinations,
    currentTrip,
    currentRoute,
    tripStartDate,
    transportSegments,
    isRouteDirty,
    schedule,
    budgetItems,
    savedRoutes,
    totalBudget,
    budgetByType,
    budgetByDay,
    addDestination,
    removeDestination,
    updateDestination,
    updateDestinationOrder,
    updateDestinationDetails,
    moveDestinationToDay,
    moveDestinationToUnscheduled,
    setTripStartDate,
    reorderDestinationWithinDay,
    updateDayDate,
    setRoute,
    buildCurrentRoute,
    refreshCurrentRoute,
    clearPlanningState,
    markRouteDirty,
    markRouteSaved,
    regenerateScheduleFromDestinations,
    createTripSnapshot,
    restoreTripSnapshot,
    applyAgentPlan,
    applyTripOutline,
    addSchedule,
    updateSchedule,
    addBudgetItem,
    removeBudgetItem,
    loadPresetRoute,
    saveRouteToList,
    renameSavedRoute,
    loadRouteFromList,
    deleteRoute,
    refreshTransportSegments,
    setTransportMode,
    retryTransportSegment
  }
})

