import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentPlanResult, Destination, Route, DaySchedule, BudgetItem, TripSnapshot, Trip } from '@/types'
import { isFirebaseConfigured } from '@/lib/firebase'
import {
  fsDeleteBudgetItem,
  fsDeleteTrip,
  fsListBudgetItems,
  fsListTrips,
  fsSaveBudgetItem,
  fsSaveTrip
} from '@/lib/firestoreSync'

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

function calculateStraightDistanceKm(a: [number, number], b: [number, number]) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h))
}

function calculateRouteDistance(destinations: Destination[]) {
  return destinations.reduce((sum, dest, index) => {
    if (index === 0) return sum
    return sum + calculateStraightDistanceKm(destinations[index - 1].coordinates, dest.coordinates)
  }, 0)
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
  
  // 鏃ョ▼瀹夋帓
  const schedule = ref<DaySchedule[]>([])
  
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
    const base = scheduled[0]?.date ? new Date(scheduled[0].date as string) : new Date()
    if (!scheduled[0]?.date) {
      base.setHours(0, 0, 0, 0)
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
        const dayDate = ordered[0]?.date
          ? new Date(ordered[0].date as string)
          : new Date(base.getTime() + (day - 1) * 86400000)
        return {
          day,
          date: dayDate,
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

    const ordered = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .flatMap(([, items]) => items
        .sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
        .map((destination, index) => ({ ...destination, withinDayOrder: index + 1 })))
      .concat(unscheduled.map((destination) => ({ ...destination })))
      .map((destination, index) => ({ ...destination, order: index + 1 }))

    destinations.value = normalizeDestinations(ordered)
    if (currentRoute.value) {
      const routeDestinations = destinations.value.filter(isScheduledDestination)
      currentRoute.value = {
        ...currentRoute.value,
        destinations: destinations.value,
        totalDistance: calculateRouteDistance(routeDestinations),
        estimatedDays: Math.max(new Set(routeDestinations.map((destination) => destination.day || 1)).size, 1)
      }
    }
    regenerateScheduleFromDestinations(destinations.value)
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
    targetItems.splice(insertAt, 0, { ...current, day: safeDay })
    const targetOrder = new Map(targetItems.map((destination, index) => [destination.id, index + 1]))

    commitDestinationEdits(destinations.value.map((destination) => {
      if (destination.id === id) return { ...destination, day: safeDay, withinDayOrder: targetOrder.get(id) }
      const order = targetOrder.get(destination.id)
      return order ? { ...destination, withinDayOrder: order } : destination
    }))
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
    schedule.value = (snapshot.schedule || []).map((day) => ({ ...day, date: new Date(day.date) }))
    markRouteDirty()
  }

  function applyAgentPlan(plan: AgentPlanResult, options: { markDirty?: boolean } = {}) {
    const normalized = normalizeDestinations(plan.route.destinations || [])
    destinations.value = normalized
    currentRoute.value = {
      ...plan.route,
      destinations: normalized,
      totalDistance: calculateRouteDistance(normalized.filter(isScheduledDestination))
    }
    schedule.value = (plan.schedule || []).map((day) => ({ ...day, date: new Date(day.date) }))
    if (!schedule.value.length) regenerateScheduleFromDestinations(normalized)
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

  async function loadTrip(tripId: string) {
    const trip = await apiRequest<Trip>(`/trips/${tripId}`, { credentials: 'include' })
    currentTrip.value = trip
    const detailed = trip.segments.find((segment) => segment.status === 'detailed')
    if (detailed) applyAgentPlan({ route: { id: trip.id, name: trip.title, destinations: detailed.destinations, estimatedDays: detailed.days, totalDistance: 0 }, schedule: detailed.schedule, warnings: [] }, { markDirty: false })
    markRouteSaved()
    return trip
  }

  // 娣诲姞鐩殑鍦?
  function addDestination(destination: Destination) {
    destinations.value.push(destination)
    regenerateScheduleFromDestinations(destinations.value)
    markRouteDirty()
  }

  // 鍒犻櫎鐩殑鍦?
  function removeDestination(id: string) {
    const index = destinations.value.findIndex(d => d.id === id)
    if (index > -1) {
      destinations.value.splice(index, 1)
    }
    regenerateScheduleFromDestinations(destinations.value)
    markRouteDirty()
  }

  // 鏇存柊鐩殑鍦伴『搴?
  function updateDestinationOrder(newOrder: Destination[]) {
    destinations.value = newOrder
    regenerateScheduleFromDestinations(destinations.value)
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
    markRouteDirty()
  }

  // 璁剧疆褰撳墠璺嚎锛涢粯璁ゆ牴鎹洰鐨勫湴閲嶇畻鏃ョ▼锛岄璁捐矾绾垮彲 skip
  function setRoute(route: Route | null, opts?: { skipScheduleRegeneration?: boolean }) {
    currentRoute.value = route
    if (opts?.skipScheduleRegeneration) return
    if (route?.destinations?.length) {
      regenerateScheduleFromDestinations(route.destinations)
    } else {
      schedule.value = []
    }
  }

  function clearPlanningState(options: { markDirty?: boolean } = {}) {
    destinations.value = []
    currentTrip.value = null
    currentRoute.value = null
    schedule.value = []
    if (options.markDirty !== false) markRouteDirty()
  }

  function buildCurrentRoute(opts?: { id?: string; name?: string }): Route {
    const scheduled = destinations.value.filter(isScheduledDestination)
    return {
      id: opts?.id || currentRoute.value?.id || `trip-${Date.now()}`,
      name: opts?.name || currentRoute.value?.name || '鎴戠殑鏃呰璺嚎',
      destinations: destinations.value,
      totalDistance: calculateRouteDistance(scheduled),
      estimatedDays: Math.max(new Set(scheduled.map((dest) => dest.day || 1)).size, 1)
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
    budgetItems.value.push(item)
    try {
      if (isFirebaseConfigured()) {
        await fsSaveBudgetItem(item)
      } else {
        await apiRequest('/budget', {
          method: 'POST',
          body: JSON.stringify(item)
        })
      }
    } catch (error) {
      console.warn('Failed to sync budget item:', error)
    }
  }
  
  // 鍒犻櫎棰勭畻椤?
  async function removeBudgetItem(id: string) {
    const index = budgetItems.value.findIndex(item => item.id === id)
    if (index > -1) {
      budgetItems.value.splice(index, 1)
    }
    try {
      if (isFirebaseConfigured()) {
        await fsDeleteBudgetItem(id)
      } else {
        await apiRequest(`/budget/${id}`, { method: 'DELETE' })
      }
    } catch (error) {
      console.warn('Failed to delete budget item:', error)
    }
  }
  
  // 鍔犺浇棰勮璺嚎
  function loadPresetRoute(routeName: string) {
    if (routeName === 'europe-free') loadEuropeFreeRoute()
    if (routeName === 'jiangzhehu') loadJiangZheHuRoute()
    markRouteDirty()
  }
  
  // 保存路线到列表
  async function saveRouteToList(route: Route) {
    const cleanedDestinations = normalizeDestinations(route.destinations || [])
    const routeToSave = {
      ...route,
      destinations: cleanedDestinations,
      totalDistance: calculateRouteDistance(cleanedDestinations),
      estimatedDays: Math.max(route.estimatedDays || cleanedDestinations.length || 1, 1)
    }
    const existingIndex = savedRoutes.value.findIndex(r => r.id === routeToSave.id)
    if (existingIndex > -1) {
      savedRoutes.value[existingIndex] = routeToSave
    } else {
      savedRoutes.value.push(routeToSave)
    }
    // 淇濆瓨鍒?localStorage
    localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes.value))

    try {
      if (isFirebaseConfigured()) {
        await fsSaveTrip(routeToSave)
      } else if (existingIndex > -1) {
        await apiRequest(`/trips/${routeToSave.id}`, {
          method: 'PUT',
          body: JSON.stringify(routeToSave)
        })
      } else {
        await apiRequest('/trips', {
          method: 'POST',
          body: JSON.stringify(routeToSave)
        })
      }
    } catch (error) {
      console.warn('Failed to sync route:', error)
    }
    markRouteSaved()
  }
  
  // 浠庡垪琛ㄥ姞杞借矾绾?
  function loadRouteFromList(routeId: string) {
    const route = savedRoutes.value.find(r => r.id === routeId)
    if (route) {
      // localStorage / 鍚庣鍥炴潵鐨勬暟鎹彲鑳藉瓨鍦ㄥ潗鏍囦负 string 鐨勬儏鍐碉紝杩欎細瀵艰嚧鍦板浘瑕佺礌涓嶆覆鏌?
      const cleanedDestinations = normalizeDestinations(route.destinations || [])
      destinations.value = cleanedDestinations
      currentRoute.value = {
        ...route,
        destinations: cleanedDestinations,
        totalDistance: calculateRouteDistance(cleanedDestinations),
        estimatedDays: Math.max(route.estimatedDays || cleanedDestinations.length || 1, 1)
      }
      regenerateScheduleFromDestinations(cleanedDestinations)
      currentTrip.value = null
      markRouteSaved()
    }
  }
  
  // 鍒犻櫎璺嚎
  async function deleteRoute(routeId: string) {
    const index = savedRoutes.value.findIndex(r => r.id === routeId)
    if (index > -1) {
      savedRoutes.value.splice(index, 1)
      localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes.value))
    }
    try {
      if (isFirebaseConfigured()) {
        await fsDeleteTrip(routeId)
      } else {
        await apiRequest(`/trips/${routeId}`, { method: 'DELETE' })
      }
    } catch (error) {
      console.warn('Failed to delete route:', error)
    }
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

    // 鍐嶅皾璇曚粠鍚庣鍚屾锛岃鐩栨湰鍦版棫鏁版嵁
    void syncFromServer()
  }

  async function syncFromServer() {
    try {
      if (isFirebaseConfigured()) {
        const [trips, items] = await Promise.all([fsListTrips(), fsListBudgetItems()])
        if (Array.isArray(trips)) {
          savedRoutes.value = trips
          localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes.value))
        }
        if (Array.isArray(items)) {
          budgetItems.value = items
        }
        return
      }

      const [tripData, budgetData] = await Promise.all([
        apiRequest<{ trips?: Route[] }>('/trips'),
        apiRequest<{ items?: BudgetItem[] }>('/budget')
      ])

      if (Array.isArray(tripData.trips)) {
        savedRoutes.value = tripData.trips
        localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes.value))
      }

      if (Array.isArray(budgetData.items)) {
        budgetItems.value = budgetData.items
      }
    } catch (error) {
      console.warn('Failed to fetch initial data:', error)
    }
  }
  
  // 鍒濆鍖?
  initSavedRoutes()
  
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
      totalDistance: calculateRouteDistance(europe),
      estimatedDays: 6
    }

    budgetItems.value = [
      { id: 'b1', day: 1, type: '交通', amount: 6200, currency: 'CNY', description: '往返欧洲机票' },
      { id: 'b2', day: 1, type: '住宿', amount: 5600, currency: 'CNY', description: '5晚酒店/民宿' },
      { id: 'b3', day: 1, type: '餐饮', amount: 1800, currency: 'CNY', description: '日常餐饮预算' },
      { id: 'b4', day: 1, type: '门票', amount: 900, currency: 'CNY', description: '博物馆与景点门票' }
    ]

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
      totalDistance: calculateRouteDistance(jzh.filter(isScheduledDestination)),
      estimatedDays: 4
    }

    budgetItems.value = [
      { id: 'hsb1', day: 3, type: '交通', amount: 160, currency: 'CNY', description: '上海—苏州往返高铁及市内交通' },
      { id: 'hsb2', day: 1, type: '住宿', amount: 1800, currency: 'CNY', description: '上海 2 晚、苏州 1 晚住宿' },
      { id: 'hsb3', day: 1, type: '餐饮', amount: 800, currency: 'CNY', description: '四日餐饮与街区休息预算' },
      { id: 'hsb4', day: 3, type: '门票', amount: 260, currency: 'CNY', description: '豫园、拙政园、留园等门票' }
    ]

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
    loadTrip,
    addSchedule,
    updateSchedule,
    addBudgetItem,
    removeBudgetItem,
    loadPresetRoute,
    saveRouteToList,
    loadRouteFromList,
    deleteRoute
  }
})

