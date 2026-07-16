<template>
  <div class="map-view">
    <div class="workspace" :class="{ 'left-collapsed': leftCollapsed, 'right-collapsed': rightCollapsed }">
      <aside class="legacy-sidebar">
        <div class="legacy-sidebar-content">
          <div class="legacy-header">
            <div class="legacy-header-row">
              <strong>路线规划</strong>
              <button class="legacy-sample" @click="loadPresetRoute">加载示例</button>
              <label><input v-model="showRouteLine" type="checkbox" /> 显示连线</label>
            </div>
          </div>
          <div class="legacy-actions">
            <button @click="clearRoute" :disabled="destinations.length === 0">清空路线</button>
            <button @click="saveRoute" :disabled="destinations.length === 0">保存路线</button>
          </div>
          <div v-if="dayOptions.length || unscheduledDestinations.length" class="legacy-days">
            <button class="overview-tab" :class="{ active: activeDay === 'overview' }" @click="selectDay('overview')">总览</button>
            <button
              v-for="day in dayOptions"
              :key="day"
              :class="{ active: activeDay === day }"
              :style="{ background: dayTint(day) }"
              @click="selectDay(day)"
            >Day {{ day }}</button>
            <button class="unscheduled-tab" :class="{ active: activeDay === 'unscheduled' }" @click="selectDay('unscheduled')">待规划</button>
          </div>
          <div class="legacy-list">
            <div v-if="visibleDestinations.length === 0" class="legacy-empty">暂无目的地</div>
            <article v-for="(place, index) in visibleDestinations" :key="place.id" class="legacy-place" @click="focusDestination(place)">
              <span class="legacy-order" :style="{ background: dayColor(place.day), borderColor: dayColor(place.day), color: '#F3EFE7' }">{{ displayOrder(place, index) }}</span>
              <div>
                <strong>{{ place.name }}</strong>
                <small>Day {{ place.day || '待定' }}<template v-if="place.description"> · {{ place.description }}</template></small>
              </div>
              <div class="legacy-place-actions" @click.stop>
                <button :disabled="!canMoveDestination(place.id, 'up')" @click="moveDestination(place.id, 'up')">↑</button>
                <button :disabled="!canMoveDestination(place.id, 'down')" @click="moveDestination(place.id, 'down')">↓</button>
                <button @click="editDestination(place)">编辑</button>
                <button @click="removeDestination(place.id)">删除</button>
              </div>
            </article>
          </div>
          <div v-if="currentRoute" class="legacy-route-info">
            <strong>{{ currentRoute.name }}</strong>
            <span>目的地数量：{{ destinations.length }} 个</span>
          </div>
        </div>
      </aside>

      <main class="map-stage">
        <div class="map-toolbar paper-panel">
          <AmapPOISearch :resolve-map-center="resolveMapCenterForPOI" @select="handlePOISelect" />
          <div class="toolbar-divider" />
          <button class="toolbar-button" :class="{ active: isAddingPoint }" @click="toggleAddPointMode">添加点</button>
          <button class="toolbar-button" @click="panMode">平移</button>
          <button class="toolbar-button" @click="zoomIn">放大</button>
          <button class="toolbar-button" @click="zoomOut">缩小</button>
          <button class="toolbar-button" :disabled="!hasMapContent" @click="fitBounds">适应范围</button>
        </div>
        <AmapMapComponent ref="mapRef" class="map-canvas" />
      </main>

      <aside class="agent-panel paper-panel">
        <header class="panel-title agent-title">
          <div>
            <p class="eyebrow">CROSS</p>
            <h2>规划助手</h2>
          </div>
          <button class="icon-button" title="收起 AI 助手" @click="rightCollapsed = true">›</button>
        </header>

        <div v-if="rightCollapsed" class="collapsed-rail right-rail">
          <button class="rail-button" title="展开 AI 助手" @click="rightCollapsed = false">AI</button>
        </div>

        <template v-else>
          <section class="constraint-strip">
            <span class="constraint-label">本次依据</span>
            <button class="constraint-chip" @click="showConstraintEditor = !showConstraintEditor">地点 {{ tripConstraints.city || '待补充' }}</button>
            <button class="constraint-chip" @click="showConstraintEditor = !showConstraintEditor">时间 {{ tripConstraints.days ? `${tripConstraints.days} 天` : '待补充' }}</button>
            <button class="constraint-chip" @click="showConstraintEditor = !showConstraintEditor">
              节奏 {{ tripConstraints.pace || 'AI 暂定' }}
            </button>
          </section>

          <section v-if="showConstraintEditor" class="constraint-editor">
            <label>地点<input v-model.trim="tripConstraints.city" placeholder="例如：杭州" /></label>
            <label>天数
              <select v-model.number="tripConstraints.days">
                <option :value="0">请选择</option>
                <option :value="1">1 天</option>
                <option :value="2">2 天</option>
                <option :value="3">3 天</option>
              </select>
            </label>
            <label>节奏
              <select v-model="tripConstraints.pace">
                <option value="">由 AI 暂定</option>
                <option value="轻松">轻松</option>
                <option value="适中">适中</option>
                <option value="紧凑">紧凑</option>
              </select>
            </label>
          </section>

          <div ref="agentScrollRef" class="agent-scroll">
            <section v-if="agentMessages.length === 0" class="agent-state empty-agent">
              <p class="state-title">从一句话开始规划</p>
              <p>生成后可以继续说“第二天轻松一点”或“保留西湖，换掉博物馆”。</p>
              <div class="quick-prompts">
                <button @click="agentRequest = '杭州两天，西湖必去，轻松一点'">杭州两天</button>
                <button @click="agentRequest = '帮我安排待规划地点'">安排已有地点</button>
              </div>
            </section>
            <article v-for="message in agentMessages" :key="message.id" class="chat-message" :class="[message.role, message.status]">
              <div class="message-meta">
                <strong>{{ message.role === 'user' ? '你' : message.role === 'assistant' ? 'CROSS' : '系统' }}</strong>
                <span>{{ formatMessageTime(message.createdAt) }}</span>
              </div>
              <p>{{ message.content }}</p>
              <ul v-if="message.changes?.length" class="change-list">
                <li v-for="change in message.changes" :key="`${message.id}-${change.type}-${change.message}`">{{ change.message }}</li>
              </ul>
              <small v-if="message.status === 'sending'">正在处理…</small>
              <small v-else-if="message.status === 'failed'">发送失败，行程未修改</small>
            </article>
            <div v-if="undoSnapshot" class="undo-bar">
              <span>最近一次 AI 调整可以撤销</span>
              <button class="text-action" @click="undoLastAgentChange">撤销</button>
            </div>
          </div>

          <footer class="agent-input">
            <textarea
              v-model="agentRequest"
              rows="2"
              :disabled="isAgentLoading"
              placeholder="告诉 CROSS 怎么规划或调整…"
              @keydown.enter.exact.prevent="sendAgentMessage"
            />
            <button class="send-button" :disabled="isAgentLoading || !agentRequest.trim()" @click="sendAgentMessage">
              {{ isAgentLoading ? '调整中' : '发送' }}
            </button>
          </footer>
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTripStore } from '@/store/trip'
import AmapMapComponent from '@/components/AmapMapComponent.vue'
import AmapPOISearch from '@/components/AmapPOISearch.vue'
import type { AgentChatResponse, AgentMessage, AgentSession, Destination, TransportMode, TripSnapshot } from '@/types'

const tripStore = useTripStore()
const mapRef = ref<InstanceType<typeof AmapMapComponent>>()
const mapCenter = ref<[number, number] | null>(null)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
const showConstraintEditor = ref(false)
const isAddingPoint = ref(false)
const isAgentLoading = ref(false)
const showRouteLine = ref(true)
const activeDay = ref<number | 'overview' | 'unscheduled'>('overview')
const selectedPlaceId = ref<string | null>(null)
const agentRequest = ref('')
const agentScrollRef = ref<HTMLElement>()
const undoSnapshot = ref<TripSnapshot | null>(null)

const DAY_ROUTE_COLORS = ['#5F5B70', '#5B6B73', '#7A555C', '#5F7267', '#4F6656', '#30383D']
const tripConstraints = reactive({ city: '', days: 0, pace: '' })
const destinations = computed(() => tripStore.destinations)
const currentRoute = computed(() => tripStore.currentRoute)
const sessionTripId = currentRoute.value?.id || localStorage.getItem('cross:active-trip-id') || `local-trip-${Date.now()}`
localStorage.setItem('cross:active-trip-id', sessionTripId)
const sessionStorageKey = `cross:agent-session:${sessionTripId}`
const agentSession = ref<AgentSession>(loadAgentSession())
const agentMessages = computed(() => agentSession.value.messages)
const scheduledDestinations = computed(() => destinations.value.filter((place) => place.planningStatus === 'scheduled' || !place.planningStatus))
const unscheduledDestinations = computed(() => destinations.value.filter((place) => place.planningStatus === 'unscheduled' || place.planningStatus === 'candidate'))
const formalDays = computed(() => groupByDay(scheduledDestinations.value))
const dayOptions = computed(() => {
  const highestDay = Math.max(0, ...formalDays.value.map((item) => item.day))
  const total = tripConstraints.days || highestDay
  return Array.from({ length: total }, (_, index) => index + 1)
})
const visibleDestinations = computed(() => {
  if (activeDay.value === 'overview') return destinations.value
  if (activeDay.value === 'unscheduled') return unscheduledDestinations.value
  return destinations.value.filter((place) => Number(place.day) === activeDay.value)
})
const tripTitle = computed(() => tripConstraints.city ? `${tripConstraints.city} 漫游` : '新的旅行')
const tripMeta = computed(() => {
  const pointCount = scheduledDestinations.value.length
  const days = tripConstraints.days
  return `${days ? `${days} 天` : '等待规划'} · ${pointCount} 个地点`
})
const hasMapContent = computed(() => destinations.value.length > 0)

function loadAgentSession(): AgentSession {
  try {
    const saved = localStorage.getItem(sessionStorageKey)
    if (saved) {
      const parsed = JSON.parse(saved) as AgentSession
      Object.assign(tripConstraints, parsed.constraints || {})
      return { ...parsed, messages: Array.isArray(parsed.messages) ? parsed.messages : [] }
    }
  } catch (error) {
    console.warn('Failed to restore agent session:', error)
  }
  return {
    id: `agent-session-${Date.now()}`,
    tripId: sessionTripId,
    messages: [],
    constraints: { city: '', days: 0, pace: '' },
    updatedAt: new Date().toISOString()
  }
}

function persistAgentSession() {
  agentSession.value.constraints = { ...tripConstraints }
  agentSession.value.updatedAt = new Date().toISOString()
  localStorage.setItem(sessionStorageKey, JSON.stringify(agentSession.value))
}

function addAgentMessage(message: AgentMessage) {
  agentSession.value.messages.push(message)
  persistAgentSession()
  void nextTick(scrollAgentToBottom)
}

function scrollAgentToBottom() {
  if (agentScrollRef.value) agentScrollRef.value.scrollTop = agentScrollRef.value.scrollHeight
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function groupByDay(places: Destination[]) {
  const grouped = new Map<number, Destination[]>()
  for (const place of [...places].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const day = place.day || 1
    const items = grouped.get(day) || []
    items.push(place)
    grouped.set(day, items)
  }
  return Array.from(grouped.entries()).map(([day, destinations]) => ({ day, destinations })).sort((a, b) => a.day - b.day)
}

function dayColor(day: unknown) {
  const value = Number(day)
  if (!Number.isFinite(value) || value < 1) return '#30383D'
  return DAY_ROUTE_COLORS[(value - 1) % DAY_ROUTE_COLORS.length]
}

function dayTint(day: unknown) {
  const value = Number(day)
  const tints = [
    'rgba(95, 91, 112, .16)',
    'rgba(91, 107, 115, .16)',
    'rgba(122, 85, 92, .16)',
    'rgba(95, 114, 103, .16)',
    'rgba(79, 102, 86, .16)',
    'rgba(48, 56, 61, .12)'
  ]
  if (!Number.isFinite(value) || value < 1) return tints[5]
  return tints[(value - 1) % tints.length]
}

function displayOrder(place: Destination, index: number) {
  return activeDay.value === 'overview' ? (place.order ?? index + 1) : (place.withinDayOrder ?? index + 1)
}

function transportLabel(mode: TransportMode | undefined) {
  return ({ walk: '步行', metro: '地铁', taxi: '打车', drive: '驾车' } as Record<string, string>)[mode || ''] || '交通'
}

function formatDuration(minutes?: number) {
  if (!minutes) return '待定'
  return minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}h` : `${minutes} 分钟`
}

function selectDay(day: number | 'overview' | 'unscheduled') {
  activeDay.value = day
  selectedPlaceId.value = null
  mapRef.value?.setHighlightedDay(typeof day === 'number' ? day : null)
  mapRef.value?.fitBounds({
    padding: { top: 84, right: 44, bottom: 44, left: 44 },
    destinations: visibleDestinations.value
  })
}

function resolveMapCenterForPOI(): [number, number] {
  return mapCenter.value || mapRef.value?.getMapCenter?.() || [116.397428, 39.90923]
}

function focusDestination(place: Destination) {
  selectedPlaceId.value = place.id
  if (place.day) activeDay.value = place.day
  mapRef.value?.flyToLocation(place.coordinates[0], place.coordinates[1], { zoom: 14 })
}

function moveToUnscheduled(place: Destination) {
  if (place.locked) return ElMessage.warning('该地点已锁定，暂不能移入待规划')
  tripStore.updateDestination(place.id, { planningStatus: 'unscheduled', day: undefined, withinDayOrder: undefined })
  tripStore.refreshCurrentRoute()
  activeDay.value = 'unscheduled'
}

function canMoveDestination(id: string, direction: 'up' | 'down') {
  const index = destinations.value.findIndex((place) => place.id === id)
  return direction === 'up' ? index > 0 : index >= 0 && index < destinations.value.length - 1
}

function moveDestination(id: string, direction: 'up' | 'down') {
  const updated = [...destinations.value]
  const index = updated.findIndex((place) => place.id === id)
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= updated.length) return
  ;[updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]]
  updated.forEach((place, position) => { place.order = position + 1 })
  tripStore.updateDestinationOrder(updated)
  tripStore.refreshCurrentRoute()
}

function removeDestination(id: string) {
  tripStore.removeDestination(id)
  tripStore.destinations.forEach((place, index) => { place.order = index + 1 })
  tripStore.refreshCurrentRoute()
  mapRef.value?.updateMap()
}

function editDestination(place: Destination) {
  mapRef.value?.openPointForm(place.coordinates, place, (data: Partial<Destination>) => {
    tripStore.updateDestination(place.id, {
      name: data.name,
      description: data.description,
      date: data.date,
      image: data.image
    })
    mapRef.value?.updateMap(true)
  })
}

function loadPresetRoute() {
  tripStore.loadPresetRoute('jiangzhehu')
  activeDay.value = 'overview'
  mapRef.value?.setHighlightedDay(null)
  mapRef.value?.updateMap(false)
}

function clearRoute() {
  ElMessageBox.confirm('确定要清空所有目的地吗？', '提示', { type: 'warning' })
    .then(() => {
      tripStore.clearPlanningState()
      mapRef.value?.updateMap()
    })
    .catch(() => undefined)
}

function saveRoute() {
  if (!destinations.value.length) return
  const route = tripStore.buildCurrentRoute({ name: currentRoute.value?.name || '我的旅行路线' })
  tripStore.setRoute(route)
  void tripStore.saveRouteToList(route)
  ElMessage.success('路线已保存')
}

function scheduleDestination(place: Destination, day: number) {
  tripStore.updateDestination(place.id, { planningStatus: 'scheduled', day, withinDayOrder: scheduledDestinations.value.filter((item) => item.day === day).length + 1 })
  tripStore.refreshCurrentRoute()
  activeDay.value = day
}

function toggleAddPointMode() {
  isAddingPoint.value = !isAddingPoint.value
  mapRef.value?.setMapSelecting(isAddingPoint.value)
  if (!isAddingPoint.value) return
  mapRef.value?.onMapClick((coordinates: [number, number]) => {
    mapRef.value?.openPointForm(coordinates, {}, (data: Partial<Destination>) => {
      tripStore.addDestination({
        id: `user-${Date.now()}`,
        name: data.name || '未命名地点',
        description: data.description || '',
        coordinates,
        order: destinations.value.length + 1,
        planningStatus: 'unscheduled',
        source: 'user'
      })
      isAddingPoint.value = false
      mapRef.value?.setMapSelecting(false)
    })
  })
}

function panMode() {
  isAddingPoint.value = false
  mapRef.value?.setMapSelecting(false)
  mapRef.value?.setPanMode(true)
}

function zoomIn() { mapRef.value?.zoomIn() }
function zoomOut() { mapRef.value?.zoomOut() }
function fitBounds() { mapRef.value?.fitBounds({ padding: { top: 84, right: 44, bottom: 44, left: 44 } }) }

async function sendAgentMessage() {
  const content = agentRequest.value.trim()
  if (!content || isAgentLoading.value) return
  const userMessage: AgentMessage = {
    id: `message-${Date.now()}-user`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    status: 'sending'
  }
  addAgentMessage(userMessage)
  agentRequest.value = ''
  isAgentLoading.value = true
  try {
    const currentPlan = destinations.value.length
      ? { route: tripStore.buildCurrentRoute(), schedule: tripStore.schedule, warnings: [] }
      : null
    const recentMessages = agentMessages.value
      .filter((message) => message.id !== userMessage.id && message.status === 'complete')
      .slice(-12)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }))
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: agentSession.value.id,
        message: content,
        recentMessages,
        constraints: tripConstraints,
        currentPlan,
        destinations: destinations.value
      })
    })
    const payload = await response.json() as AgentChatResponse
    if (!response.ok) throw new Error(payload.error || '暂时无法处理这次调整')
    userMessage.status = 'complete'
    if (payload.constraints) Object.assign(tripConstraints, payload.constraints)
    if (payload.plan) {
      undoSnapshot.value = tripStore.createTripSnapshot()
      tripStore.applyAgentPlan(payload.plan)
      mapRef.value?.updateMap()
      activeDay.value = payload.plan.route.destinations[0]?.day || 'overview'
    }
    addAgentMessage({
      id: `message-${Date.now()}-assistant`,
      role: 'assistant',
      content: payload.reply,
      createdAt: new Date().toISOString(),
      status: 'complete',
      changes: payload.changes
    })
    payload.warnings?.forEach((warning, index) => addAgentMessage({
      id: `message-${Date.now()}-warning-${index}`,
      role: 'system',
      content: warning,
      createdAt: new Date().toISOString(),
      status: 'complete'
    }))
    persistAgentSession()
  } catch (error) {
    userMessage.status = 'failed'
    const message = error instanceof Error ? error.message : '暂时无法处理这次调整'
    addAgentMessage({
      id: `message-${Date.now()}-error`,
      role: 'system',
      content: message,
      createdAt: new Date().toISOString(),
      status: 'failed'
    })
    ElMessage.error(message)
  } finally {
    isAgentLoading.value = false
    persistAgentSession()
  }
}

function undoLastAgentChange() {
  if (!undoSnapshot.value) return
  tripStore.restoreTripSnapshot(undoSnapshot.value)
  undoSnapshot.value = null
  mapRef.value?.updateMap()
  addAgentMessage({
    id: `message-${Date.now()}-undo`,
    role: 'system',
    content: '已撤销最近一次 AI 行程调整。',
    createdAt: new Date().toISOString(),
    status: 'complete'
  })
  ElMessage.success('已撤销最近一次调整')
}

function handlePOISelect(place: Destination) {
  activeDay.value = 'unscheduled'
  focusDestination(place)
  ElMessage.success(`已加入待规划：${place.name}`)
}

watch(showRouteLine, (visible) => {
  mapRef.value?.setRouteLineVisible(visible)
}, { immediate: true })

watch(dayOptions, (days) => {
  if (typeof activeDay.value === 'number' && !days.includes(activeDay.value)) activeDay.value = 'overview'
})

onMounted(() => {
  Object.assign(tripConstraints, agentSession.value.constraints)
  void nextTick(scrollAgentToBottom)
  nextTick(() => {
    mapRef.value?.onViewChange((center: [number, number]) => { mapCenter.value = center })
    mapRef.value?.onFeatureClick((feature: Destination) => {
      const place = destinations.value.find((item) => item.id === feature.id)
      if (place) focusDestination(place)
    })
  })
})

watch(tripConstraints, persistAgentSession, { deep: true })
</script>

<style scoped>
.map-view { position: relative; height: 100%; min-height: 0; background: #d8dcdd; overflow: hidden; }
.workspace { position: relative; height: 100%; min-height: 0; }
.paper-panel { background: rgba(216, 220, 221, .94); border: 1px solid rgba(29, 34, 38, .18); border-radius: 8px; box-shadow: 0 6px 20px rgba(29, 34, 38, .1); }
.trip-panel, .agent-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.panel-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 18px 16px 14px; border-bottom: 1px solid rgba(29, 34, 38, .14); }
.panel-title h1, .panel-title h2 { margin: 2px 0 4px; color: #1d2226; font-size: 20px; line-height: 1.2; font-weight: 650; }
.panel-title span, .eyebrow { color: rgba(29, 34, 38, .62); font-size: 12px; }
.eyebrow { margin: 0; letter-spacing: 0; text-transform: uppercase; }
.icon-button { width: 26px; height: 26px; border: 0; color: #6b6c7b; background: transparent; font-size: 23px; cursor: pointer; }
.icon-button:hover { color: #a14b3c; }
.collapsed-rail { display: flex; flex: 1; align-items: flex-start; justify-content: center; padding-top: 16px; }
.rail-button { writing-mode: vertical-rl; border: 0; background: transparent; color: #5b6f60; font: inherit; font-size: 12px; cursor: pointer; }
.day-tabs { display: flex; gap: 4px; padding: 10px 12px; overflow-x: auto; border-bottom: 1px solid #eee4d7; }
.day-tabs button { flex: 0 0 auto; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #776e63; padding: 7px 5px; font: inherit; font-size: 12px; cursor: pointer; }
.day-tabs button.active { color: #8b4e1f; border-bottom-color: #bc6c25; font-weight: 650; }
.trip-scroll, .agent-scroll { min-height: 0; overflow-y: auto; }
.trip-scroll { flex: 1; padding: 12px; }
.draft-notice { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding: 8px 10px; border: 1px dashed #b6a18a; background: #eee7dc; color: #6b6c7b; font-size: 12px; }
.draft-notice small { color: #6b6c7b; }
.day-heading { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 2px 9px; color: #455a49; font-weight: 650; font-size: 14px; }
.day-heading small { color: #9b8a76; font-size: 11px; font-weight: 400; }
.place-list { display: flex; flex-direction: column; gap: 2px; }
.place-row { display: flex; align-items: flex-start; gap: 9px; padding: 10px 4px; border-bottom: 1px solid #f0e9df; cursor: pointer; }
.place-row:hover, .place-row.selected { background: #f7f0e4; }
.place-row.draft { background: #eee7dc; }
.place-marker { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 50%; background: #5b6b73; color: #dcdfde; font-size: 11px; font-weight: 700; }
.place-marker.muted { background: #d4dfd0; color: #5f7267; }
.place-copy { min-width: 0; flex: 1; }
.place-copy strong, .place-copy small { display: block; }
.place-copy strong { overflow: hidden; color: #293b30; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.place-copy small { margin-top: 3px; color: #8a8074; font-size: 11px; }
.empty-copy { padding: 28px 8px; color: #9a9084; font-size: 13px; text-align: center; }
.text-action { border: 0; background: transparent; color: #8b4e1f; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.map-stage { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.map-canvas { width: 100%; height: 100%; }
.map-toolbar { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 10; display: flex; align-items: center; gap: 7px; padding: 7px; }
.map-toolbar :deep(.poi-search) { width: min(360px, 42%); }
.toolbar-divider { width: 1px; height: 22px; background: rgba(29, 34, 38, .16); }
.toolbar-button { border: 0; background: transparent; color: #5b6b73; padding: 7px 8px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.toolbar-button:hover, .toolbar-button.active { background: #e4ebef; color: #1d2226; }
.toolbar-button:disabled { color: rgba(29, 34, 38, .32); cursor: not-allowed; }
.map-key { position: absolute; left: 12px; bottom: 12px; z-index: 10; display: flex; align-items: center; gap: 7px; padding: 7px 10px; color: #5b6b73; font-size: 11px; }
.key-line { width: 20px; height: 0; border-top: 3px solid #5b6b73; }
.draft-line { border-top-style: dashed; }
.agent-panel { position: absolute; top: 20px; right: 20px; bottom: 20px; z-index: 2; width: 360px; }
.workspace.right-collapsed .agent-panel { width: 46px; }
.agent-title { padding-bottom: 12px; }
.constraint-strip { display: flex; flex-wrap: wrap; gap: 5px; padding: 10px 12px; border-bottom: 1px solid rgba(29, 34, 38, .14); }
.constraint-label { width: 100%; color: rgba(29, 34, 38, .62); font-size: 11px; }
.constraint-chip { max-width: 100%; overflow: hidden; border: 1px solid rgba(95, 91, 112, .34); border-radius: 999px; background: rgba(95, 91, 112, .16); color: #30383d; padding: 4px 7px; font: inherit; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.constraint-chip:nth-child(3) { border-color: rgba(91, 107, 115, .34); background: rgba(91, 107, 115, .16); color: #30383d; }
.constraint-chip:nth-child(4) { border-color: rgba(79, 102, 86, .34); background: rgba(79, 102, 86, .16); color: #30383d; }
.constraint-chip:hover { border-color: rgba(48, 56, 61, .48); color: #30383d; }
.constraint-editor { display: grid; grid-template-columns: 1fr; gap: 8px; padding: 10px 12px; background: rgba(91, 107, 115, .12); border-bottom: 1px solid rgba(48, 56, 61, .14); }
.constraint-editor label { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 8px; color: #30383d; font-size: 12px; }
.constraint-editor input, .constraint-editor select { min-width: 0; border: 1px solid rgba(48, 56, 61, .22); border-radius: 4px; background: #f0eee8; color: #30383d; padding: 6px 7px; font: inherit; font-size: 12px; }
.agent-scroll { flex: 1; padding: 14px 14px 8px; }
.agent-state, .agent-result { color: #5b6b73; font-size: 13px; line-height: 1.55; }
.chat-message { max-width: 88%; margin: 0 0 12px; border: 1px solid rgba(48, 56, 61, .14); border-radius: 8px; background: rgba(244, 246, 245, .74); padding: 9px 10px; color: #30383d; font-size: 13px; line-height: 1.55; }
.chat-message.user { margin-left: auto; border-color: rgba(79, 102, 86, .28); background: rgba(79, 102, 86, .14); }
.chat-message.system { max-width: 100%; border-style: dashed; background: rgba(91, 107, 115, .1); color: #5b6b73; }
.chat-message.failed { border-color: rgba(161, 75, 60, .36); background: rgba(161, 75, 60, .09); }
.chat-message p { margin: 5px 0 0; white-space: pre-wrap; }
.chat-message small { display: block; margin-top: 5px; color: rgba(48, 56, 61, .58); }
.message-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
.message-meta strong { color: #30383d; }
.message-meta span { color: rgba(48, 56, 61, .5); }
.change-list { margin: 8px 0 0; border-top: 1px solid rgba(48, 56, 61, .12); padding: 7px 0 0 18px; color: #4f6656; font-size: 12px; }
.change-list li { margin: 3px 0; }
.undo-bar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid rgba(95, 91, 112, .24); border-radius: 6px; background: rgba(229, 226, 234, .96); padding: 8px 10px; color: #5f5b70; font-size: 11px; }
.state-title { margin: 0 0 8px; color: #1d2226; font-size: 15px; font-weight: 650; }
.agent-state p { margin: 0; }
.empty-agent { padding-top: 8px; }
.quick-prompts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.quick-prompts button { border: 1px solid rgba(91, 107, 115, .28); border-radius: 999px; background: transparent; color: #5b6b73; padding: 5px 8px; font: inherit; font-size: 11px; cursor: pointer; }
.trace-list { margin: 0; padding-left: 20px; color: rgba(29, 34, 38, .62); }
.trace-list li { padding: 5px 0; }
.draft-day { padding: 9px 0; border-bottom: 1px solid rgba(29, 34, 38, .1); }
.draft-day strong, .draft-day span { display: block; }
.draft-day strong { color: #6b6c7b; font-size: 12px; }
.draft-day span { margin-top: 3px; color: #5b6b73; font-size: 13px; }
.result-summary { margin: 0 0 6px; color: rgba(29, 34, 38, .62); font-size: 12px; }
.reason-block, .warning-block { margin-top: 12px; padding: 10px; border-left: 3px solid #5f7267; background: #e5ece5; font-size: 12px; }
.warning-block { border-left-color: #a14b3c; background: #f1e6e2; }
.reason-block strong, .warning-block strong { color: #5f7267; }
.warning-block strong { color: #a14b3c; }
.reason-block p, .warning-block p { margin: 4px 0 0; }
.draft-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
.primary-action, .secondary-action, .send-button { border: 1px solid transparent; border-radius: 5px; padding: 8px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.primary-action, .send-button { background: rgba(79, 102, 86, .18); color: #30383d; border-color: rgba(79, 102, 86, .38); font-weight: 650; }
.primary-action:hover, .send-button:hover { background: rgba(79, 102, 86, .28); }
.secondary-action { border-color: rgba(91, 107, 115, .34); background: rgba(91, 107, 115, .16); color: #30383d; }
.agent-input { display: flex; gap: 8px; align-items: flex-end; padding: 12px; border-top: 1px solid rgba(29, 34, 38, .14); background: rgba(216, 220, 221, .52); }
.agent-input textarea { min-width: 0; flex: 1; border: 1px solid rgba(29, 34, 38, .18); border-radius: 5px; background: #dcdfde; color: #1d2226; padding: 8px; resize: none; font: inherit; font-size: 12px; line-height: 1.45; }
.send-button:disabled { background: #c7cdcf; border-color: #c7cdcf; color: rgba(29, 34, 38, .46); cursor: not-allowed; }
.legacy-sidebar { position: absolute; top: 20px; bottom: 20px; left: 20px; z-index: 2; width: 410px; min-width: 0; overflow: hidden; border: 1px solid rgba(29, 34, 38, .18); border-radius: 8px; background: rgba(216, 220, 221, .94); box-shadow: var(--cross-shadow); }
.legacy-sidebar-content { display: flex; height: 100%; flex-direction: column; gap: 14px; overflow-y: auto; padding: 14px; box-sizing: border-box; }
.legacy-header { padding-bottom: 13px; border-bottom: 1px dashed #e1ded6; }
.legacy-header-row { display: flex; align-items: center; justify-content: space-between; color: var(--cross-ink); font-size: 16px; }
.legacy-header-row strong { letter-spacing: .04em; }
.legacy-header-row label { color: var(--cross-muted); font-size: 12px; font-weight: 400; }
.legacy-sample, .legacy-actions button { margin-top: 10px; border: 1px solid rgba(95, 91, 112, .34); border-radius: 5px; background: rgba(95, 91, 112, .16); color: #30383d; padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.legacy-header .legacy-sample { margin-top: 0; }
.legacy-actions { display: flex; gap: 8px; }
.legacy-actions button { margin-top: 0; border-color: rgba(79, 102, 86, .34); background: rgba(79, 102, 86, .16); color: #30383d; }
.legacy-actions button:first-child { border-color: rgba(122, 85, 92, .34); background: rgba(122, 85, 92, .16); color: #30383d; }
.legacy-actions button:disabled { opacity: .55; cursor: not-allowed; }
.legacy-days { display: flex; flex-wrap: wrap; gap: 7px; padding-bottom: 12px; border-bottom: 1px dashed #e1ded6; }
.legacy-days button { border: 1px solid transparent; border-radius: 5px 7px 5px 6px; background: rgba(48, 56, 61, .08); color: #30383d; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; transition: transform .18s ease, box-shadow .18s ease; }
.legacy-days button:nth-child(4n + 1) { background: rgba(95, 91, 112, .16); color: #30383d; }
.legacy-days button:nth-child(4n + 2) { background: rgba(91, 107, 115, .16); color: #30383d; }
.legacy-days button:nth-child(4n + 3) { background: rgba(122, 85, 92, .16); color: #30383d; }
.legacy-days button:nth-child(4n) { background: rgba(95, 114, 103, .16); color: #30383d; }
.legacy-days .overview-tab { background: rgba(48, 56, 61, .1); }
.legacy-days .unscheduled-tab { background: rgba(79, 102, 86, .16); }
.legacy-days button:hover { transform: translateY(-1px); }
.legacy-days button.active { border-color: rgba(145, 143, 132, .24); box-shadow: inset 0 -2px 0 rgba(112, 110, 101, .18); color: var(--cross-ink); }
.legacy-list { flex: 1; min-height: 260px; overflow-y: auto; }
.legacy-empty { padding-top: 80px; color: var(--cross-muted); font-size: 13px; text-align: center; }
.legacy-place { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; border: 1px solid rgba(29, 34, 38, .12); border-radius: 7px 7px 6px 7px; background: rgba(220, 223, 222, .78); padding: 10px; cursor: pointer; transition: background-color .18s ease, box-shadow .18s ease; }
.legacy-place:hover { background: #e2e5e4; box-shadow: 0 4px 12px rgba(29, 34, 38, .05); }
.legacy-order { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; flex: 0 0 auto; border: 1px solid transparent; border-radius: 11px 13px 11px 12px; background: #30383D; color: #F3EFE7; font-size: 12px; font-weight: 700; }
.legacy-place > div:nth-child(2) { min-width: 0; flex: 1; }
.legacy-place strong, .legacy-place small { display: block; }
.legacy-place strong { overflow: hidden; color: var(--cross-ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.legacy-place small { overflow: hidden; margin-top: 4px; color: var(--cross-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.legacy-place-actions { display: flex; gap: 3px; }
.legacy-place-actions button { border: 1px solid rgba(29, 34, 38, .12); border-radius: 4px; background: #dfe2e1; color: #1d2226; padding: 3px 5px; font: inherit; font-size: 11px; cursor: pointer; }
.legacy-place-actions button:last-child { color: #1d2226; }
.legacy-place-actions button:disabled { opacity: .45; cursor: not-allowed; }
.legacy-route-info { display: flex; flex-direction: column; gap: 4px; border: 1px dashed rgba(29, 34, 38, .22); border-radius: 7px; background: rgba(220, 223, 222, .72); padding: 12px; color: var(--cross-muted); font-size: 12px; }
.legacy-route-info strong { color: var(--cross-ink); font-size: 14px; }
.map-toolbar { top: 20px; left: 450px; right: 400px; gap: 16px; padding: 8px 20px; border-radius: 8px; background: rgba(216,220,221,.88); box-shadow: 0 2px 12px rgba(29,34,38,.1); }
.map-toolbar :deep(.poi-search) { width: min(400px, 45%); }
.toolbar-divider { background: transparent; }
.toolbar-button { border: 1px solid rgba(48, 56, 61, .22); border-radius: 4px; background: rgba(48, 56, 61, .08); color: #30383d; padding: 6px 12px; font-size: 14px; }
.toolbar-button:nth-of-type(1) { background: rgba(79, 102, 86, .16); }
.toolbar-button:nth-of-type(2) { background: rgba(91, 107, 115, .16); }
.toolbar-button:nth-of-type(3) { background: rgba(95, 91, 112, .16); }
.toolbar-button:nth-of-type(4) { background: rgba(122, 85, 92, .16); }
.toolbar-button:nth-of-type(5) { background: rgba(95, 114, 103, .16); }
.toolbar-button:hover, .toolbar-button.active { border-color: rgba(48, 56, 61, .42); background: rgba(48, 56, 61, .16); color: #30383d; }
@media (max-width: 1180px) { .legacy-sidebar { width: 360px; } .agent-panel { width: 320px; } .map-toolbar { left: 400px; right: 360px; } }
@media (max-width: 900px) { .map-view { overflow-y: auto; } .workspace { min-height: 1100px; } .legacy-sidebar, .agent-panel { top: 12px; bottom: auto; width: calc(100% - 24px); } .legacy-sidebar { left: 12px; height: 360px; } .agent-panel { top: 390px; right: 12px; height: 360px; } .map-stage { top: 760px; height: 520px; } .map-toolbar { left: 12px; right: 12px; } }
</style>
