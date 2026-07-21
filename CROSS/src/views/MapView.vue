<template>
  <div class="map-view">
    <div class="workspace" :class="{ 'left-collapsed': leftCollapsed, 'right-collapsed': rightCollapsed }">
      <aside ref="leftPanelRef" class="legacy-sidebar">
        <div class="legacy-sidebar-content">
          <div class="legacy-header">
            <div class="legacy-header-row">
              <strong>路线规划</strong>
              <button class="legacy-sample" @click="loadPresetRoute">加载示例</button>
              <label><input v-model="showRouteLine" type="checkbox" /> 显示连线</label>
            </div>
          </div>
          <div class="legacy-actions">
            <button class="new-route-action" @click="requestNewRoute">新建路线</button>
            <button class="clear-route-action" @click="clearRoute" :disabled="destinations.length === 0">清空路线</button>
            <button @click="saveRoute" :disabled="destinations.length === 0">保存路线</button>
          </div>
          <div v-if="dayOptions.length || unscheduledDestinations.length" class="legacy-days">
            <button class="overview-tab" :class="{ active: activeDay === 'overview' }" @click="selectDay('overview')">总览</button>
            <button
              v-for="day in dayOptions"
              :key="day"
              :class="{ active: activeDay === day }"
              :style="{ '--day-color': dayColor(day), background: dayTint(day) }"
              @click="selectDay(day)"
            >Day {{ day }}</button>
            <button class="unscheduled-tab" :class="{ active: activeDay === 'unscheduled' }" @click="selectDay('unscheduled')">待规划</button>
          </div>
          <div v-if="agentSession.draftPlan" class="route-source-tabs">
            <button :class="{ active: !previewingDraft }" @click="showFormalRoute">正式行程</button>
            <button :class="{ active: previewingDraft }" @click="focusDraftPreview">草案预览</button>
          </div>
          <div class="legacy-list">
            <div v-if="visibleDestinations.length === 0" class="legacy-empty">{{ previewingDraft ? '草案中暂无可展示地点' : '暂无目的地' }}</div>
            <article v-for="(place, index) in visibleDestinations" :key="place.id" class="legacy-place" :class="{ selected: selectedPlaceId === place.id }" @click="focusDestination(place)">
              <span class="legacy-order" :style="{ background: dayColor(place.day) }">{{ displayOrder(place, index) }}</span>
              <div>
                <strong>{{ place.name }}</strong>
                <small>Day {{ place.day || '待定' }}<template v-if="place.description"> · {{ place.description }}</template></small>
              </div>
              <div v-if="!previewingDraft" class="legacy-place-actions" @click.stop>
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
        <section v-if="agentSession.draftPlan && previewingDraft" class="draft-map-banner">
          <div>
            <strong>正在预览草案</strong>
            <span>尚未保存，正式行程不会改变</span>
          </div>
          <button @click="showFormalRoute">查看正式行程</button>
        </section>
        <div class="map-toolbar paper-panel">
          <AmapPOISearch :resolve-map-center="resolveMapCenterForPOI" @select="handlePOISelect" />
          <div class="toolbar-divider" />
          <button class="toolbar-button" :class="{ active: isAddingPoint }" @click="toggleAddPointMode">添加点</button>
          <button class="toolbar-button" @click="panMode">平移</button>
          <button class="toolbar-button" @click="zoomIn">放大</button>
          <button class="toolbar-button" @click="zoomOut">缩小</button>
          <button class="toolbar-button" :disabled="!hasMapContent" @click="fitBounds">适应范围</button>
          <button v-if="mapRenderError" class="toolbar-button map-retry" @click="retryMapRender">重试地图</button>
        </div>
        <AmapMapComponent ref="mapRef" class="map-canvas" />
      </main>

      <aside ref="rightPanelRef" class="agent-panel paper-panel">
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
          <section v-if="hasTripContext || activeConstraint" class="trip-brief" :class="{ editing: activeConstraint }">
            <span class="brief-label">旅行摘要</span>

            <div class="brief-item" :class="{ active: activeConstraint === 'destination' }">
              <button class="brief-row" @click="toggleConstraint('destination')">
                <span>目的地</span><strong>{{ tripConstraints.city || '待补充' }}</strong><i>›</i>
              </button>
              <div v-if="activeConstraint === 'destination'" class="brief-editor destination-editor">
                <label for="destination-search">想去哪里？</label>
                <input
                  id="destination-search"
                  v-model.trim="destinationQuery"
                  placeholder="搜索城市或地区"
                  autocomplete="off"
                  @keydown.enter.prevent="useDestinationQuery"
                />
                <div v-if="tripConstraints.city" class="destination-group">
                  <small>当前行程</small>
                  <button @click="selectDestination(tripConstraints.city)">
                    <span>⌖</span><strong>{{ tripConstraints.city }}</strong><em>{{ destinations.length }} 个地点</em>
                  </button>
                </div>
                <div v-if="destinationSuggestions.length" class="destination-group">
                  <small>{{ destinationQuery ? '搜索建议' : '最近与常用' }}</small>
                  <button v-for="city in destinationSuggestions" :key="city" @click="selectDestination(city)">
                    <span>↗</span><strong>{{ city }}</strong><em>城市</em>
                  </button>
                </div>
                <button v-if="destinationQuery && !destinationSuggestions.includes(destinationQuery)" class="use-query" @click="useDestinationQuery">
                  使用“{{ destinationQuery }}”作为目的地
                </button>
                <button class="defer-action" @click="activeConstraint = null">还没确定，先和 CROSS 聊聊</button>
              </div>
            </div>

            <div class="brief-item" :class="{ active: activeConstraint === 'dates' }">
              <button class="brief-row" @click="toggleConstraint('dates')">
                <span>日期</span><strong>{{ dateSummary }}</strong><i>›</i>
              </button>
              <div v-if="activeConstraint === 'dates'" class="brief-editor date-editor">
                <label>什么时候出发？</label>
                <el-date-picker
                  v-model="dateRange"
                  type="daterange"
                  value-format="YYYY-MM-DD"
                  range-separator="至"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  @change="applyDateRange"
                />
                <small>当前支持规划 1–14 天的单城市行程</small>
                <button class="defer-action" @click="markDatesFlexible">日期还没确定</button>
              </div>
            </div>

            <div class="brief-item" :class="{ active: activeConstraint === 'pace' }">
              <button class="brief-row" @click="toggleConstraint('pace')">
                <span>节奏</span><strong>{{ paceSummary }}</strong><i>›</i>
              </button>
              <div v-if="activeConstraint === 'pace'" class="brief-editor pace-editor">
                <label>一天想怎么安排？</label>
                <button v-for="option in paceOptions" :key="option.value" :class="{ selected: tripConstraints.pacePreference === option.value }" @click="selectPace(option.value)">
                  <strong>{{ option.value }}</strong><span>{{ option.detail }}</span>
                </button>
              </div>
            </div>
          </section>

          <div ref="agentScrollRef" class="agent-scroll">
            <section v-if="agentMessages.length === 0" class="agent-state empty-agent">
              <p class="state-title">想规划一次旅行，还是想看看现有行程？</p>
              <p>我可以帮你整理地点、安排每天路线，或分析已有计划。</p>
              <div class="quick-prompts">
                <button @click="fillAgentRequest('帮我创建出行计划')">帮我创建出行计划</button>
                <button @click="fillAgentRequest('帮我分析行程或地点')">帮我分析行程 / 地点</button>
                <button v-if="destinations.length" @click="fillAgentRequest('请帮我安排地图里已有的地点')">安排地图地点</button>
              </div>
              <button class="setup-link" @click="openConstraint('destination')">也可以先设置旅行摘要</button>
            </section>
            <article v-for="message in agentMessages" :key="message.id" class="chat-message" :class="[message.role, message.status]">
              <div class="message-meta">
                <span v-if="message.status === 'sending'" class="thinking-mark" aria-label="正在处理">
                  <i></i><i></i><i></i><i></i>
                </span>
                <time>{{ formatMessageTime(message.createdAt) }}</time>
              </div>
              <div class="message-content" v-html="renderMessageContent(message.content)"></div>
              <section v-if="message.activities?.length" class="activity-panel">
                <button class="activity-heading" @click="toggleActivities(message.id)">
                  <span>{{ message.status === 'sending' ? '正在梳理这次行程' : message.status === 'failed' ? '这次没有完成' : message.status === 'superseded' ? '已按新要求重新处理' : '这次做了什么' }}</span>
                  <i>{{ shouldShowActivities(message) ? '−' : '+' }}</i>
                </button>
                <ol v-if="shouldShowActivities(message)" class="activity-list">
                  <li v-for="activity in message.activities" :key="`${message.id}-${activity.id}`" :class="activity.status">
                    <span class="activity-mark">{{ activity.status === 'complete' ? '✓' : activity.status === 'failed' ? '!' : activity.status === 'superseded' ? '—' : '●' }}</span>
                    <div><strong>{{ activity.label }}</strong><small v-if="activity.detail">{{ activity.detail }}</small></div>
                  </li>
                </ol>
              </section>
              <ul v-if="message.changes?.length" class="change-list">
                <li v-for="change in message.changes" :key="`${message.id}-${change.type}-${change.message}`">{{ change.message }}</li>
              </ul>
              <section v-if="message.draftPlan" class="draft-result-card">
                <header>
                  <div>
                    <strong>草案预览 · {{ message.draftPlan.route.name }}</strong>
                    <small>尚未保存，不会覆盖正式行程</small>
                  </div>
                  <button class="text-action" @click="focusDraftPreview">查看地图</button>
                </header>
                <section v-if="message.draftExplanation" class="draft-basis">
                  <strong>这样安排的依据</strong>
                  <ul>
                    <li v-for="basis in message.draftExplanation.basis" :key="basis">{{ basis }}</li>
                  </ul>
                </section>
                <ol class="draft-days">
                  <li v-for="day in message.draftExplanation?.days || draftDays(message.draftPlan)" :key="`${message.id}-draft-day-${day.day}`">
                    <strong>Day {{ day.day }}</strong>
                    <span>{{ day.places.join(' → ') }}</span>
                    <small>{{ day.reason }}</small>
                  </li>
                </ol>
                <section v-if="message.draftExplanation?.evidence?.length" class="draft-evidence">
                  <strong>信息边界</strong>
                  <span v-for="item in message.draftExplanation.evidence" :key="`${item.type}-${item.label}`">{{ item.label }}</span>
                </section>
                <div v-if="message.proposal?.status === 'pending'" class="draft-result-actions">
                  <button class="confirm-action" @click="confirmAgentProposal(message)">保存到我的行程</button>
                  <button class="text-action" @click="fillAgentRequest('把这份草案安排得轻松一点')">继续调整</button>
                </div>
              </section>
              <section v-if="message.proposal && !message.draftPlan" class="proposal-card">
                <strong>{{ message.proposal.kind === 'create' ? '待保存的旅行草案' : '待确认的行程修改' }}</strong>
                <p>{{ message.proposal.summary }}</p>
                <ol v-if="message.proposal.segments?.length" class="proposal-segments">
                  <li v-for="segment in message.proposal.segments" :key="`${message.proposal.id}-${segment.city}`">
                    <strong>{{ segment.city }}</strong><span>{{ segment.days }} 天</span><small v-if="segment.reason">{{ segment.reason }}</small>
                  </li>
                </ol>
                <div v-if="message.proposal.status === 'pending'" class="proposal-actions">
                  <button class="confirm-action" @click="confirmAgentProposal(message)">{{ message.proposal.kind === 'create' ? '保存到我的行程' : '确认应用' }}</button>
                  <button class="text-action" @click="rejectAgentProposal(message)">{{ message.proposal.kind === 'create' ? '暂不保存' : '暂不修改' }}</button>
                </div>
                <small v-else>{{ message.proposal.status === 'applied' ? '已应用到地图与日程' : message.proposal.status === 'rejected' ? '已拒绝，本次没有修改行程' : '提案已失效' }}</small>
              </section>
              <div v-if="message.status === 'complete' && message.suggestions?.length" class="follow-up-suggestions">
                <button v-for="suggestion in message.suggestions" :key="`${message.id}-${suggestionKey(suggestion)}`" @click="handleSuggestion(message, suggestion)">
                  {{ suggestionLabel(suggestion) }}
                </button>
              </div>
              <small v-if="message.status === 'superseded'">已收到新要求，本次结果不会应用</small>
              <small v-else-if="message.status === 'failed'">发送失败，行程未修改</small>
            </article>
            <div v-if="undoSnapshot" class="undo-bar">
              <span>最近一次 AI 调整可以撤销</span>
              <button class="text-action" @click="undoLastAgentChange">撤销</button>
            </div>
          </div>

          <footer class="agent-input">
            <textarea
              ref="agentInputRef"
              v-model="agentRequest"
              rows="2"
              :placeholder="agentPlaceholder"
              @keydown.enter.exact.prevent="sendAgentMessage"
            />
            <button class="send-button" :disabled="!agentRequest.trim()" @click="sendAgentMessage">
              {{ isAgentLoading ? '追加' : '发送' }}
            </button>
          </footer>
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTripStore } from '@/store/trip'
import AmapMapComponent from '@/components/AmapMapComponent.vue'
import AmapPOISearch from '@/components/AmapPOISearch.vue'
import {
  agentSessionKey,
  agentUndoKey,
  clearLegacyAgentStorageOnce,
  createDraftTripId,
  createSavedTripId,
  getActiveTripId,
  migrateAgentStorage,
  setActiveTripId
} from '@/lib/agentSessionStorage'
import { dayColor, dayTint } from '@/lib/dayPalette'
import type { AgentActivity, AgentChatResponse, AgentMessage, AgentPlanResult, AgentSession, AgentSuggestion, Destination, Trip, TripSnapshot } from '@/types'

const tripStore = useTripStore()
const route = useRoute()
const mapRef = ref<InstanceType<typeof AmapMapComponent>>()
const leftPanelRef = ref<HTMLElement>()
const rightPanelRef = ref<HTMLElement>()
const mapCenter = ref<[number, number] | null>(null)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
const activeConstraint = ref<'destination' | 'dates' | 'pace' | null>(null)
const isAddingPoint = ref(false)
const mapRenderError = ref(false)
const activeRequestId = ref<string | null>(null)
const isAgentLoading = computed(() => Boolean(activeRequestId.value))
let activeRequestController: AbortController | null = null
let activeInstructions: string[] = []
let activeInstructionMessageIds: string[] = []
let activeAssistantMessage: AgentMessage | null = null
const showRouteLine = ref(true)
const activeDay = ref<number | 'overview' | 'unscheduled'>('overview')
const previewingDraft = ref(false)
const selectedPlaceId = ref<string | null>(null)
const agentRequest = ref('')
const agentScrollRef = ref<HTMLElement>()
const agentInputRef = ref<HTMLTextAreaElement>()
const destinationQuery = ref('')
const dateRange = ref<string[]>([])
const expandedActivityIds = ref<string[]>([])
const recentCities = ref<string[]>(loadRecentCities())

const COMMON_CITIES = ['北京', '上海', '南京', '杭州', '苏州', '成都', '重庆', '西安', '广州', '深圳', '厦门', '青岛']
const paceOptions = [
  { value: '轻松', detail: '每天约 2–3 个地点，留出休息和临时调整时间' },
  { value: '适中', detail: '每天约 3–4 个地点，游览与移动相对平衡' },
  { value: '紧凑', detail: '每天约 4–5 个地点，适合希望多看一些的旅行' }
]
const tripConstraints = reactive({ city: '', days: 0, pacePreference: '', startDate: '', endDate: '', datesFlexible: false })
const destinations = computed(() => tripStore.destinations)
const currentRoute = computed(() => tripStore.currentRoute)
clearLegacyAgentStorageOnce()
const initialTripId = currentRoute.value?.id || getActiveTripId() || createDraftTripId()
const activeTripId = ref(initialTripId)
setActiveTripId(initialTripId)
const agentSession = ref<AgentSession>(loadAgentSession(initialTripId))
const agentMessages = computed(() => agentSession.value.messages)
const undoSnapshot = ref<TripSnapshot | null>(loadUndoSnapshot(initialTripId))
const hasTripContext = computed(() => agentMessages.value.length > 0 || destinations.value.length > 0 || Boolean(tripConstraints.city || tripConstraints.days))
const destinationSuggestions = computed(() => {
  const query = destinationQuery.value.toLowerCase()
  return [...new Set([...recentCities.value, ...COMMON_CITIES])]
    .filter((city) => city !== tripConstraints.city && (!query || city.toLowerCase().includes(query)))
    .slice(0, 6)
})
const dateSummary = computed(() => {
  if (tripConstraints.startDate && tripConstraints.endDate) {
    return `${formatShortDate(tripConstraints.startDate)}—${formatShortDate(tripConstraints.endDate)} · ${tripConstraints.days} 天`
  }
  if (tripConstraints.datesFlexible) return tripConstraints.days ? `日期待定 · ${tripConstraints.days} 天` : '日期待定'
  return tripConstraints.days ? `${tripConstraints.days} 天` : '待补充'
})
const detectedPace = computed(() => {
  const score = { '轻松': 1, '适中': 2, '紧凑': 3 } as const
  return tripStore.schedule.reduce<'轻松' | '适中' | '紧凑' | ''>((result, day) => {
    if (!day.detectedPace) return result
    return !result || score[day.detectedPace] > score[result] ? day.detectedPace : result
  }, '')
})
const paceSummary = computed(() => tripConstraints.pacePreference
  ? `偏好：${tripConstraints.pacePreference}`
  : detectedPace.value ? `检测：${detectedPace.value}` : '未设置偏好')
const agentPlaceholder = computed(() => agentMessages.value.length
  ? '继续告诉 CROSS 怎么调整，例如：第二天轻松一点…'
  : '例如：南京玩 2 天，想看历史建筑，节奏轻松一点')
const displayedDestinations = computed(() => previewingDraft.value
  ? agentSession.value.draftPlan?.route.destinations || []
  : destinations.value)
const scheduledDestinations = computed(() => displayedDestinations.value.filter((place) => place.planningStatus === 'scheduled' || !place.planningStatus))
const unscheduledDestinations = computed(() => displayedDestinations.value.filter((place) => place.planningStatus === 'unscheduled' || place.planningStatus === 'candidate'))
const formalDays = computed(() => groupByDay(scheduledDestinations.value))
const dayOptions = computed(() => {
  const actualDays = [...new Set(formalDays.value.map((item) => item.day))].sort((a, b) => a - b)
  if (actualDays.length) return actualDays
  return Array.from({ length: tripConstraints.days || 0 }, (_, index) => index + 1)
})
const visibleDestinations = computed(() => {
  if (activeDay.value === 'overview') return displayedDestinations.value
  if (activeDay.value === 'unscheduled') return unscheduledDestinations.value
  return displayedDestinations.value.filter((place) => Number(place.day) === activeDay.value)
})
const hasMapContent = computed(() => destinations.value.length > 0 || Boolean(agentSession.value.draftPlan?.route.destinations.length))

function loadRecentCities(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem('cross:recent-cities') || '[]')
    return Array.isArray(saved) ? saved.filter((city) => typeof city === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

function toggleConstraint(section: 'destination' | 'dates' | 'pace') {
  activeConstraint.value = activeConstraint.value === section ? null : section
  if (activeConstraint.value === 'destination') destinationQuery.value = ''
}

function openConstraint(section: 'destination' | 'dates' | 'pace') {
  activeConstraint.value = section
  if (section === 'destination') destinationQuery.value = ''
}

function selectDestination(city: string) {
  const value = city.trim()
  if (!value) return
  tripConstraints.city = value
  recentCities.value = [value, ...recentCities.value.filter((item) => item !== value)].slice(0, 6)
  localStorage.setItem('cross:recent-cities', JSON.stringify(recentCities.value))
  destinationQuery.value = ''
  activeConstraint.value = null
}

function useDestinationQuery() {
  selectDestination(destinationQuery.value)
}

function formatShortDate(value: string) {
  const [, month, day] = value.split('-').map(Number)
  return month && day ? `${month}月${day}日` : value
}

function applyDateRange(value: string[] | null) {
  if (!value?.[0] || !value[1]) return
  const start = Date.parse(`${value[0]}T00:00:00`)
  const end = Date.parse(`${value[1]}T00:00:00`)
  const days = Math.round((end - start) / 86400000) + 1
  if (days < 1 || days > 14) {
    ElMessage.warning('当前支持选择 1–14 天，请缩短日期范围。')
    dateRange.value = tripConstraints.startDate && tripConstraints.endDate ? [tripConstraints.startDate, tripConstraints.endDate] : []
    return
  }
  tripConstraints.startDate = value[0]
  tripConstraints.endDate = value[1]
  tripConstraints.days = days
  tripConstraints.datesFlexible = false
  activeConstraint.value = null
}

function markDatesFlexible() {
  tripConstraints.startDate = ''
  tripConstraints.endDate = ''
  tripConstraints.datesFlexible = true
  dateRange.value = []
  activeConstraint.value = null
}

function selectPace(pace: string) {
  tripConstraints.pacePreference = pace
  activeConstraint.value = null
}

function toggleActivities(messageId: string) {
  expandedActivityIds.value = expandedActivityIds.value.includes(messageId)
    ? expandedActivityIds.value.filter((id) => id !== messageId)
    : [...expandedActivityIds.value, messageId]
}

function shouldShowActivities(message: AgentMessage) {
  return message.status === 'sending' || expandedActivityIds.value.includes(message.id)
}

function upsertActivity(message: AgentMessage, activity: AgentActivity) {
  const activities = message.activities || (message.activities = [])
  const index = activities.findIndex((item) => item.id === activity.id)
  if (index >= 0) activities[index] = activity
  else activities.push(activity)
  if (!expandedActivityIds.value.includes(message.id)) expandedActivityIds.value = [...expandedActivityIds.value, message.id]
  persistAgentSession()
  void nextTick(scrollAgentToBottom)
}

function emptyConstraints() {
  return { city: '', days: 0, pacePreference: '', startDate: '', endDate: '', datesFlexible: false }
}

function loadAgentSession(tripId: string): AgentSession {
  try {
    const saved = localStorage.getItem(agentSessionKey(tripId))
    if (saved) {
      const parsed = JSON.parse(saved) as AgentSession
      return {
        ...parsed,
        tripId,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        constraints: { ...emptyConstraints(), ...parsed.constraints, pacePreference: parsed.constraints?.pacePreference || parsed.constraints?.pace || '' },
        pendingTask: parsed.pendingTask || null,
        planRevision: Number(parsed.planRevision) || 0,
        draftPlan: parsed.draftPlan || null,
        draftTrip: parsed.draftTrip || null
      }
    }
  } catch (error) {
    console.warn('Failed to restore agent session:', error)
  }
  return {
    id: `agent-session-${Date.now()}`,
    tripId,
    messages: [],
    constraints: emptyConstraints(),
    pendingTask: null,
    planRevision: 0,
    draftPlan: null,
    draftTrip: null,
    updatedAt: new Date().toISOString()
  }
}

function loadUndoSnapshot(tripId: string): TripSnapshot | null {
  try {
    const saved = localStorage.getItem(agentUndoKey(tripId))
    return saved ? JSON.parse(saved) as TripSnapshot : null
  } catch {
    return null
  }
}

function persistAgentSession() {
  agentSession.value.tripId = activeTripId.value
  agentSession.value.constraints = { ...tripConstraints }
  agentSession.value.updatedAt = new Date().toISOString()
  localStorage.setItem(agentSessionKey(activeTripId.value), JSON.stringify(agentSession.value))
}

function switchAgentSession(tripId: string) {
  if (!tripId || tripId === activeTripId.value) return
  if (activeAssistantMessage?.status === 'sending') {
    activeAssistantMessage.status = 'superseded'
    activeAssistantMessage.content = '已切换到另一条路线，本次处理已停止。'
    activeAssistantMessage.activities = activeAssistantMessage.activities?.map((activity) =>
      activity.status === 'running' ? { ...activity, status: 'superseded' } : activity
    )
  }
  persistAgentSession()
  activeRequestController?.abort()
  activeRequestController = null
  activeRequestId.value = null
  activeInstructions = []
  activeInstructionMessageIds = []
  activeAssistantMessage = null
  activeTripId.value = tripId
  setActiveTripId(tripId)
  agentSession.value = loadAgentSession(tripId)
  previewingDraft.value = Boolean(agentSession.value.draftPlan)
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview')
  mapRef.value?.setDraftDestinations(agentSession.value.draftPlan?.route.destinations || [])
  mapRef.value?.setDraftPreviewMode(previewingDraft.value)
  Object.assign(tripConstraints, emptyConstraints(), agentSession.value.constraints)
  dateRange.value = tripConstraints.startDate && tripConstraints.endDate ? [tripConstraints.startDate, tripConstraints.endDate] : []
  undoSnapshot.value = loadUndoSnapshot(tripId)
  expandedActivityIds.value = []
  void nextTick(scrollAgentToBottom)
}

function addAgentMessage(message: AgentMessage) {
  agentSession.value.messages.push(message)
  persistAgentSession()
  void nextTick(scrollAgentToBottom)
}

function bumpPlanRevision() {
  agentSession.value.planRevision = (Number(agentSession.value.planRevision) || 0) + 1
  persistAgentSession()
}

function scrollAgentToBottom() {
  if (agentScrollRef.value) agentScrollRef.value.scrollTop = agentScrollRef.value.scrollHeight
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function escapeMessageHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function formatMessageInline(value: string) {
  return escapeMessageHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderMessageContent(content: string) {
  const output: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (list) output.push(`</${list}>`)
    list = null
  }
  for (const rawLine of String(content || '').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^[*-]\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    if (heading) {
      closeList()
      output.push(`<h${heading[1].length}>${formatMessageInline(heading[2])}</h${heading[1].length}>`)
    } else if (bullet || ordered) {
      const nextList = bullet ? 'ul' : 'ol'
      if (list !== nextList) {
        closeList()
        list = nextList
        output.push(`<${list}>`)
      }
      output.push(`<li>${formatMessageInline((bullet || ordered)?.[1] || '')}</li>`)
    } else {
      closeList()
      output.push(`<p>${formatMessageInline(line)}</p>`)
    }
  }
  closeList()
  return output.join('')
}

function fillAgentRequest(value: string) {
  agentRequest.value = value
  void nextTick(() => agentInputRef.value?.focus())
}

function draftDays(plan: AgentPlanResult) {
  const grouped = new Map<number, string[]>()
  for (const place of plan.route.destinations) {
    const day = Number(place.day) || 1
    const places = grouped.get(day) || []
    places.push(place.name)
    grouped.set(day, places)
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([day, places]) => ({
    day,
    places,
    reason: '这是草案安排，确认前可以继续替换地点或调整节奏。'
  }))
}

function focusDraftPreview() {
  if (!agentSession.value.draftPlan) return
  previewingDraft.value = true
  activeDay.value = 'overview'
  selectedPlaceId.value = null
  mapRef.value?.setDraftPreviewMode(true)
  mapRef.value?.setVisibleDay('overview')
  mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: agentSession.value.draftPlan.route.destinations })
}

function showFormalRoute() {
  previewingDraft.value = false
  activeDay.value = 'overview'
  selectedPlaceId.value = null
  mapRef.value?.setDraftPreviewMode(false)
  mapRef.value?.setVisibleDay('overview')
  if (destinations.value.length) mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: destinations.value })
}

function suggestionLabel(suggestion: AgentSuggestion | string) {
  return typeof suggestion === 'string' ? suggestion : suggestion.label
}

function suggestionKey(suggestion: AgentSuggestion | string) {
  return typeof suggestion === 'string' ? suggestion : suggestion.id
}

function handleSuggestion(message: AgentMessage, suggestion: AgentSuggestion | string) {
  if (typeof suggestion === 'string') {
    fillAgentRequest(suggestion)
    return
  }
  if (suggestion.action === 'focus_draft_map') {
    focusDraftPreview()
    return
  }
  if (suggestion.action === 'confirm_proposal') {
    const proposalMessage = agentMessages.value.find((item) => item.proposal?.id === suggestion.proposalId) || message
    void confirmAgentProposal(proposalMessage)
    return
  }
  if (suggestion.message) {
    agentRequest.value = suggestion.message
    void sendAgentMessage()
  }
}

async function readAgentResponse(response: Response): Promise<AgentChatResponse> {
  const body = await response.text()
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    if (body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html')) {
      throw new Error('AI 服务尚未加载最新接口，请重启后端服务后再试。')
    }
    throw new Error(`AI 服务返回了无法识别的响应（${response.status}）。`)
  }
  try {
    return JSON.parse(body) as AgentChatResponse
  } catch {
    throw new Error('AI 服务返回的数据格式有误，请稍后再试。')
  }
}

async function readAgentStream(response: Response, onActivity: (activity: AgentActivity) => void): Promise<AgentChatResponse> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return readAgentResponse(response)
  if (!contentType.includes('application/x-ndjson') || !response.body) {
    if (!response.ok) {
      const detail = await response.text()
      if (response.status === 500 && /proxy|ECONNREFUSED|connect/i.test(detail)) {
        throw new Error('无法连接 CROSS 后端服务，请先启动 server。')
      }
      throw new Error(`AI 服务请求失败（${response.status}）。`)
    }
    throw new Error('AI 服务返回了无法识别的流式响应。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload: AgentChatResponse | null = null

  const consumeLine = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as { type: string; activity?: AgentActivity; payload?: AgentChatResponse; error?: string }
    if (event.type === 'activity' && event.activity) onActivity(event.activity)
    if (event.type === 'final' && event.payload) finalPayload = event.payload
    if (event.type === 'error') throw new Error(event.error || 'AI 服务未能完成这次调整。')
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(consumeLine)
    if (done) break
  }
  if (buffer.trim()) consumeLine(buffer)
  if (!finalPayload) throw new Error('AI 服务连接已结束，但没有返回最终行程结果。')
  return finalPayload
}

async function readRunEvents(response: Response, onActivity: (activity: AgentActivity) => void): Promise<AgentChatResponse> {
  if (!response.ok || !response.body) throw new Error(`无法读取Agent运行状态（${response.status}）。`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload: AgentChatResponse | null = null
  const consume = (frame: string) => {
    const eventName = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() || ''
    const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
    if (!data) return
    const event = JSON.parse(data) as { payload?: AgentChatResponse | AgentActivity }
    if (eventName === 'run.activity' && event.payload) onActivity(event.payload as AgentActivity)
    if (['proposal.ready', 'run.completed'].includes(eventName)) finalPayload = event.payload as AgentChatResponse
    if (['run.failed', 'run.cancelled'].includes(eventName)) throw new Error((event.payload as AgentChatResponse)?.error || 'Agent未能完成这次请求。')
  }
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    frames.forEach(consume)
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
  if (!finalPayload) throw new Error('Agent运行结束，但没有返回结果。')
  return finalPayload
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

function displayOrder(place: Destination, index: number) {
  return place.withinDayOrder ?? place.order ?? index + 1
}

function selectDay(day: number | 'overview' | 'unscheduled') {
  activeDay.value = day
  selectedPlaceId.value = null
  mapRef.value?.setVisibleDay(day)
  void nextTick(() => mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: visibleDestinations.value }))
}

function mapViewportPadding() {
  if (window.innerWidth <= 900) return { top: 84, right: 44, bottom: 44, left: 44 }
  const left = leftPanelRef.value?.getBoundingClientRect().right || 44
  const right = rightPanelRef.value ? window.innerWidth - rightPanelRef.value.getBoundingClientRect().left : 44
  return { top: 84, right: Math.max(44, Math.round(right + 20)), bottom: 44, left: Math.max(44, Math.round(left + 20)) }
}

function resolveMapCenterForPOI(): [number, number] {
  return mapCenter.value || mapRef.value?.getMapCenter?.() || [116.397428, 39.90923]
}

function focusDestination(place: Destination) {
  selectedPlaceId.value = place.id
  if (place.day) {
    activeDay.value = place.day
    mapRef.value?.setVisibleDay(place.day)
  }
  mapRef.value?.flyToLocation(place.coordinates[0], place.coordinates[1], { zoom: 14 })
}

function canMoveDestination(id: string, direction: 'up' | 'down') {
  const current = destinations.value.find((place) => place.id === id)
  if (!current) return false
  const peers = current.planningStatus === 'unscheduled' || current.planningStatus === 'candidate'
    ? unscheduledDestinations.value
    : destinations.value
      .filter((place) => Number(place.day || 1) === Number(current.day || 1) && place.planningStatus !== 'unscheduled' && place.planningStatus !== 'candidate')
      .sort((a, b) => (a.withinDayOrder ?? a.order ?? 0) - (b.withinDayOrder ?? b.order ?? 0))
  const index = peers.findIndex((place) => place.id === id)
  return direction === 'up' ? index > 0 : index >= 0 && index < peers.length - 1
}

function moveDestination(id: string, direction: 'up' | 'down') {
  const current = destinations.value.find((place) => place.id === id)
  if (!current) return
  if (current.planningStatus !== 'unscheduled' && current.planningStatus !== 'candidate') {
    tripStore.reorderDestinationWithinDay(id, direction)
    tripStore.refreshCurrentRoute()
    bumpPlanRevision()
    void nextTick(() => mapRef.value?.updateMap())
    return
  }
  const updated = [...destinations.value]
  const index = updated.findIndex((place) => place.id === id)
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= updated.length) return
  ;[updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]]
  updated.forEach((place, position) => { place.order = position + 1 })
  tripStore.updateDestinationOrder(updated)
  tripStore.refreshCurrentRoute()
  bumpPlanRevision()
}

function removeDestination(id: string) {
  tripStore.removeDestination(id)
  tripStore.destinations.forEach((place, index) => { place.order = index + 1 })
  tripStore.refreshCurrentRoute()
  bumpPlanRevision()
  mapRef.value?.updateMap()
}

function editDestination(place: Destination) {
  mapRef.value?.openPointForm(place.coordinates, {
    id: place.id,
    name: place.name,
    description: place.description,
    coordinates: place.coordinates,
    day: place.day,
    order: place.order
  }, (data: Partial<Destination>) => {
    tripStore.updateDestination(place.id, {
      name: data.name,
      description: data.description,
      date: data.date,
      image: data.image
    })
    bumpPlanRevision()
    mapRef.value?.updateMap(true)
  })
}

function loadPresetRoute() {
  tripStore.loadPresetRoute('jiangzhehu')
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview')
  bumpPlanRevision()
  mapRef.value?.updateMap(false)
}

function clearRoute() {
  ElMessageBox.confirm('确定要清空所有目的地吗？', '提示', { type: 'warning' })
    .then(() => {
      tripStore.clearPlanningState()
      bumpPlanRevision()
      mapRef.value?.updateMap()
    })
    .catch(() => undefined)
}

async function saveRoute() {
  if (!destinations.value.length) return false
  const previousTripId = activeTripId.value
  const routeId = previousTripId.startsWith('draft-trip-') ? createSavedTripId() : previousTripId
  persistAgentSession()
  if (routeId !== previousTripId) {
    migrateAgentStorage(previousTripId, routeId)
    activeTripId.value = routeId
    agentSession.value.tripId = routeId
  }
  const route = tripStore.buildCurrentRoute({ id: routeId, name: currentRoute.value?.name || '我的旅行路线' })
  tripStore.setRoute(route)
  await tripStore.saveRouteToList(route)
  persistAgentSession()
  ElMessage.success('路线已保存')
  return true
}

function startNewRoute() {
  switchAgentSession(createDraftTripId())
  tripStore.clearPlanningState({ markDirty: false })
  tripStore.markRouteSaved()
  selectedPlaceId.value = null
  activeDay.value = 'overview'
  mapRef.value?.setVisibleDay('overview', false)
  mapRef.value?.updateMap()
}

async function requestNewRoute() {
  const hasRouteContent = Boolean(currentRoute.value || tripStore.currentTrip || destinations.value.length)
  if (!hasRouteContent || !tripStore.isRouteDirty) {
    startNewRoute()
    return
  }
  if (!destinations.value.length) {
    try {
      await ElMessageBox.confirm('当前路线有未保存变更，但没有可保存的地点。要放弃这些变更并新建吗？', '新建路线', {
        confirmButtonText: '放弃并新建', cancelButtonText: '继续编辑', type: 'warning'
      })
      startNewRoute()
    } catch {
      // Keep editing the current route.
    }
    return
  }
  try {
    await ElMessageBox.confirm('当前路线有未保存变更。', '新建路线', {
      confirmButtonText: '保存并新建', cancelButtonText: '放弃并新建',
      distinguishCancelAndClose: true, type: 'warning'
    })
    await saveRoute()
    startNewRoute()
  } catch (action) {
    if (action === 'cancel') startNewRoute()
  }
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
      bumpPlanRevision()
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
function fitBounds() { mapRef.value?.fitBounds({ padding: mapViewportPadding(), destinations: visibleDestinations.value }) }

function retryMapRender() {
  mapRenderError.value = false
  mapRef.value?.updateMap(false)
}

async function sendAgentMessage() {
  const content = agentRequest.value.trim()
  if (!content) return
  const previousMessageIds = activeRequestId.value ? activeInstructionMessageIds : []
  if (activeRequestId.value) {
    activeRequestController?.abort()
    if (activeAssistantMessage) {
      activeAssistantMessage.status = 'superseded'
      activeAssistantMessage.content = '收到你的新要求，已停止上一轮处理，并按最新内容重新调整。'
      activeAssistantMessage.activities = activeAssistantMessage.activities?.map((activity) =>
        activity.status === 'running' ? { ...activity, status: 'superseded' } : activity
      )
    }
  }
  const userMessage: AgentMessage = {
    id: `message-${Date.now()}-user`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    status: 'complete'
  }
  addAgentMessage(userMessage)
  const instructions = [content]
  const instructionMessageIds = [...previousMessageIds, userMessage.id]
  const requestId = `request-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const basePlanRevision = agentSession.value.planRevision
  const controller = new AbortController()
  const assistantMessage: AgentMessage = {
    id: `message-${Date.now()}-assistant`,
    role: 'assistant',
    content: '我先读一下你的安排，看看从哪里接着整理 🧭',
    createdAt: new Date().toISOString(),
    status: 'sending',
    activities: []
  }
  addAgentMessage(assistantMessage)
  agentRequest.value = ''
  activeRequestId.value = requestId
  activeRequestController = controller
  activeInstructions = instructions
  activeInstructionMessageIds = instructionMessageIds
  activeAssistantMessage = assistantMessage
  persistAgentSession()
  try {
    const currentPlan = destinations.value.length
      ? { route: tripStore.buildCurrentRoute(), schedule: tripStore.schedule, warnings: [] }
      : null
    const recentMessages = agentMessages.value
      .filter((message) => !instructionMessageIds.includes(message.id) && message.id !== assistantMessage.id && message.status === 'complete')
      .slice(-12)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }))
    const createResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({
        sessionId: agentSession.value.id,
        requestId,
        tripId: activeTripId.value,
        trip: tripStore.currentTrip || agentSession.value.draftTrip || undefined,
        message: content,
        pendingTask: agentSession.value.pendingTask,
        planRevision: basePlanRevision,
        recentMessages,
        constraints: tripConstraints,
        currentPlan,
        destinations: destinations.value
      })
    })
    const created = await readAgentResponse(createResponse) as unknown as { runId?: string; error?: string }
    if (!createResponse.ok || !created.runId) throw new Error(created.error || '无法创建Agent任务。')
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/runs/${created.runId}/events`, { credentials: 'include', signal: controller.signal })
    const payload = await readRunEvents(response, (activity) => {
      if (activeRequestId.value === requestId) upsertActivity(assistantMessage, activity)
    })
    if (activeRequestId.value !== requestId) return
    if (!response.ok) throw new Error(payload.error || '暂时无法处理这次调整')
    assistantMessage.status = 'complete'
    assistantMessage.content = payload.reply
    assistantMessage.changes = payload.changes
    assistantMessage.suggestions = payload.suggestions?.slice(0, 3)
    assistantMessage.proposal = payload.proposal
    assistantMessage.draftPlan = payload.draftPlan
    assistantMessage.draftTrip = payload.draftTrip
    assistantMessage.draftExplanation = payload.draftExplanation
    agentSession.value.pendingTask = payload.pendingTask || null
    if (payload.draftPlan) {
      agentSession.value.draftPlan = payload.draftPlan
      mapRef.value?.setDraftDestinations(payload.draftPlan.route.destinations)
      focusDraftPreview()
    }
    if (payload.draftTrip) agentSession.value.draftTrip = payload.draftTrip
    if (payload.constraints) Object.assign(tripConstraints, payload.constraints)
    payload.warnings?.forEach((warning, index) => addAgentMessage({
      id: `message-${Date.now()}-warning-${index}`,
      role: 'system',
      content: warning.startsWith('⚠️') ? warning : `⚠️ ${warning}`,
      createdAt: new Date().toISOString(),
      status: 'complete'
    }))
    persistAgentSession()
  } catch (error) {
    if (controller.signal.aborted || activeRequestId.value !== requestId) return
    const message = error instanceof Error ? error.message : '暂时无法处理这次调整'
    assistantMessage.role = 'system'
    assistantMessage.status = 'failed'
    assistantMessage.content = message
    assistantMessage.activities = assistantMessage.activities?.map((activity) => activity.status === 'running' ? { ...activity, status: 'failed' } : activity)
    ElMessage.error(message)
  } finally {
    if (activeRequestId.value === requestId) {
      activeRequestId.value = null
      activeRequestController = null
      activeInstructions = []
      activeInstructionMessageIds = []
      activeAssistantMessage = null
      persistAgentSession()
    }
  }
}

async function confirmAgentProposal(message: AgentMessage) {
  if (!message.proposal || message.proposal.status !== 'pending') return
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/proposals/${message.proposal.id}/confirm`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: agentSession.value.planRevision })
    })
    const payload = await readAgentResponse(response) as AgentChatResponse & { status?: string }
    if (!response.ok || (!payload.plan && !(payload as AgentChatResponse & { trip?: unknown }).trip)) throw new Error(payload.error || '无法应用这份修改。')
    undoSnapshot.value = tripStore.createTripSnapshot()
    localStorage.setItem(agentUndoKey(activeTripId.value), JSON.stringify(undoSnapshot.value))
    if (payload.plan) {
      tripStore.applyAgentPlan({ ...payload.plan, route: { ...payload.plan.route, id: activeTripId.value } })
      bumpPlanRevision()
    }
    if (payload.trip) {
      tripStore.applyTripOutline(payload.trip)
      agentSession.value.planRevision = payload.trip.revision || agentSession.value.planRevision + 1
    }
    agentSession.value.draftPlan = null
    agentSession.value.draftTrip = null
    mapRef.value?.setDraftDestinations([])
    mapRef.value?.setDraftPreviewMode(false)
    previewingDraft.value = false
    message.proposal.status = 'applied'
    addAgentMessage({ id: `message-${Date.now()}-applied`, role: 'system', content: '已确认并同步更新地图与日程。', createdAt: new Date().toISOString(), status: 'complete' })
    persistAgentSession()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法应用这份修改。')
  }
}

async function rejectAgentProposal(message: AgentMessage) {
  if (!message.proposal || message.proposal.status !== 'pending') return
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/proposals/${message.proposal.id}/reject`, { method: 'POST', credentials: 'include' })
    if (!response.ok) throw new Error('无法拒绝这份修改。')
    message.proposal.status = 'rejected'
    persistAgentSession()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法拒绝这份修改。')
  }
}

function undoLastAgentChange() {
  if (!undoSnapshot.value) return
  tripStore.restoreTripSnapshot(undoSnapshot.value)
  bumpPlanRevision()
  undoSnapshot.value = null
  localStorage.removeItem(agentUndoKey(activeTripId.value))
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
  bumpPlanRevision()
  activeDay.value = 'unscheduled'
  mapRef.value?.setVisibleDay('unscheduled')
  focusDestination(place)
  ElMessage.success(`已加入待规划：${place.name}`)
}

watch(showRouteLine, (visible) => {
  mapRef.value?.setRouteLineVisible(visible)
}, { immediate: true })

watch(dayOptions, (days) => {
  if (typeof activeDay.value === 'number' && !days.includes(activeDay.value)) activeDay.value = 'overview'
})

watch(() => currentRoute.value?.id, (routeId) => {
  if (routeId && routeId !== activeTripId.value) switchAgentSession(routeId)
})

onMounted(() => {
  Object.assign(tripConstraints, agentSession.value.constraints)
  dateRange.value = tripConstraints.startDate && tripConstraints.endDate ? [tripConstraints.startDate, tripConstraints.endDate] : []
  void nextTick(scrollAgentToBottom)
  nextTick(() => {
    mapRef.value?.setDraftDestinations(agentSession.value.draftPlan?.route.destinations || [])
    mapRef.value?.setDraftPreviewMode(previewingDraft.value)
    mapRef.value?.onViewChange((center: [number, number]) => { mapCenter.value = center })
    mapRef.value?.onRenderError((error: Error) => {
      mapRenderError.value = true
      addAgentMessage({
        id: `message-${Date.now()}-map-warning`,
        role: 'system',
        content: `⚠️ 行程已经保存，但地图暂时没有刷新。你可以点击“重试地图”。`,
        createdAt: new Date().toISOString(),
        status: 'complete'
      })
      console.warn('Map render failed after retry:', error)
    })
    mapRef.value?.onFeatureClick((feature) => {
      const place = destinations.value.find((item) => item.id === feature.id)
      if (place) {
        focusDestination(place)
        editDestination(place)
      }
    })
    mapRef.value?.onReady(() => {
      const focusId = typeof route.query.focus === 'string' ? route.query.focus : ''
      const place = destinations.value.find((item) => item.id === focusId)
      if (place) focusDestination(place)
    })
  })
})

watch(tripConstraints, persistAgentSession, { deep: true })

onBeforeUnmount(() => {
  if (activeAssistantMessage?.status === 'sending') {
    activeAssistantMessage.status = 'superseded'
    activeAssistantMessage.content = '已离开当前路线，本次处理已停止。'
    activeAssistantMessage.activities = activeAssistantMessage.activities?.map((activity) =>
      activity.status === 'running' ? { ...activity, status: 'superseded' } : activity
    )
    persistAgentSession()
  }
  activeRequestController?.abort()
})
</script>

<style scoped>
.map-view { --cross-ink-soft: rgba(32, 37, 41, .76); --cross-ink-faint: rgba(32, 37, 41, .38); --cross-muted: #555f64; position: relative; width: 100%; height: 100%; min-height: 0; background: #d8dcdd; overflow: hidden; }
.workspace { position: relative; height: 100%; min-height: 0; }
.paper-panel { background: rgba(216, 220, 221, .94); border: 1px solid rgba(29, 34, 38, .18); border-radius: 8px; box-shadow: 0 6px 20px rgba(29, 34, 38, .1); }
.trip-panel, .agent-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.panel-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 18px 16px 14px; border-bottom: 1px solid rgba(29, 34, 38, .14); }
.panel-title h1, .panel-title h2 { margin: 2px 0 4px; color: #1d2226; font-size: 20px; line-height: 1.2; font-weight: 650; }
.panel-title span, .eyebrow { color: rgba(29, 34, 38, .76); font-size: 12px; }
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
.day-heading small { color: #6f6559; font-size: 11px; font-weight: 400; }
.place-list { display: flex; flex-direction: column; gap: 2px; }
.place-row { display: flex; align-items: flex-start; gap: 9px; padding: 10px 4px; border-bottom: 1px solid #f0e9df; cursor: pointer; }
.place-row:hover, .place-row.selected { background: #f7f0e4; }
.place-row.draft { background: #eee7dc; }
.place-marker { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 50%; background: #5b6b73; color: #dcdfde; font-size: 11px; font-weight: 700; }
.place-marker.muted { background: #d4dfd0; color: #5f7267; }
.place-copy { min-width: 0; flex: 1; }
.place-copy strong, .place-copy small { display: block; }
.place-copy strong { overflow: hidden; color: #293b30; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.place-copy small { margin-top: 3px; color: #625d56; font-size: 11px; }
.empty-copy { padding: 28px 8px; color: #69635b; font-size: 13px; text-align: center; }
.text-action { border: 0; background: transparent; color: var(--cross-rust); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.map-stage { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.map-canvas { width: 100%; height: 100%; }
.draft-map-banner { position: absolute; top: 74px; left: 400px; z-index: 11; display: flex; max-width: min(420px, calc(100% - 800px)); align-items: center; gap: 14px; border-left: 3px solid var(--cross-rust); background: rgba(216, 220, 221, .94); padding: 8px 10px; box-shadow: 0 2px 10px rgba(32, 37, 41, .1); }
.draft-map-banner strong, .draft-map-banner span { display: block; }
.draft-map-banner strong { color: var(--cross-ink); font-size: 12px; }
.draft-map-banner span { margin-top: 2px; color: var(--cross-ink-soft); font-size: 11px; }
.draft-map-banner button { border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.draft-map-banner button:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.map-toolbar { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 10; display: flex; align-items: center; gap: 7px; padding: 7px; }
.map-toolbar :deep(.poi-search) { width: min(360px, 42%); }
.toolbar-divider { width: 1px; height: 22px; background: rgba(29, 34, 38, .16); }
.toolbar-button { border: 0; background: transparent; color: #5b6b73; padding: 7px 8px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.toolbar-button:hover, .toolbar-button.active { background: #e4ebef; color: #1d2226; }
.toolbar-button:disabled { color: rgba(29, 34, 38, .32); cursor: not-allowed; }
.map-key { position: absolute; left: 12px; bottom: 12px; z-index: 10; display: flex; align-items: center; gap: 7px; padding: 7px 10px; color: #5b6b73; font-size: 11px; }
.key-line { width: 20px; height: 0; border-top: 2px dashed #5b6b73; opacity: .6; }
.draft-line { border-top-style: dashed; }
.agent-panel { position: absolute; top: 20px; right: 20px; bottom: 20px; z-index: 3; width: 360px; }
.workspace.right-collapsed .agent-panel { width: 46px; }
.agent-title { padding: 15px 16px 12px; }
.trip-brief { position: relative; display: grid; grid-template-columns: auto repeat(3, minmax(0, 1fr)); gap: 6px 8px; align-items: center; padding: 7px 12px 8px; border-bottom: 1px solid rgba(29, 34, 38, .14); }
.brief-label { color: var(--cross-ink-soft); font-size: 11px; white-space: nowrap; }
.brief-item { position: relative; min-width: 0; }
.trip-brief.editing .brief-item:not(.active) { display: none; }
.brief-item.active { grid-column: 1 / -1; padding-left: 8px; }
.brief-item.active::before { position: absolute; top: 3px; bottom: 4px; left: 0; width: 2px; background: var(--cross-rust); content: ''; }
.brief-row { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) 9px; gap: 5px; align-items: center; border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--cross-ink); padding: 3px 0 4px; font: inherit; text-align: left; cursor: pointer; }
.brief-row > span { color: var(--cross-ink-soft); font-size: 11px; white-space: nowrap; }
.brief-row > strong { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.brief-row > i { color: var(--cross-ink-faint); font-style: normal; font-size: 14px; line-height: 1; transition: transform .18s ease; }
.brief-row:hover, .brief-row:focus-visible { border-bottom-color: var(--cross-ink-faint); outline: none; }
.brief-item.active .brief-row > i { color: var(--cross-rust); transform: rotate(90deg); }
.brief-editor { padding: 6px 2px 8px 56px; color: var(--cross-ink); }
.brief-editor > label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
.destination-editor > input { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; outline: none; background: transparent; color: var(--cross-ink); padding: 7px 1px; font: inherit; font-size: 12px; }
.destination-editor > input:focus { border-bottom-color: var(--cross-rust); }
.destination-group { margin-top: 12px; }
.destination-group > small { display: block; margin-bottom: 3px; color: var(--cross-ink-soft); font-size: 10px; }
.destination-group > button { display: grid; width: 100%; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 4px; align-items: center; border: 0; border-bottom: 1px solid rgba(32, 37, 41, .09); background: transparent; color: var(--cross-ink); padding: 7px 0; font: inherit; text-align: left; cursor: pointer; }
.destination-group > button:hover strong { color: var(--cross-rust); }
.destination-group > button span { color: var(--cross-moss); }
.destination-group > button strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.destination-group > button em { color: var(--cross-ink-soft); font-size: 10px; font-style: normal; }
.use-query, .defer-action { margin-top: 9px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 11px; cursor: pointer; }
.use-query:hover, .defer-action:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.date-editor :deep(.el-date-editor) { width: 100%; box-sizing: border-box; background: rgba(197, 203, 204, .42); box-shadow: inset 0 0 0 1px rgba(32, 37, 41, .14); }
.date-editor > small { display: block; margin-top: 7px; color: var(--cross-ink-soft); font-size: 10px; }
.pace-editor { display: grid; gap: 5px; }
.pace-editor > label { margin-bottom: 3px; }
.pace-editor > button { border: 1px solid rgba(32, 37, 41, .14); border-radius: 3px 9px 3px 3px; background: transparent; color: var(--cross-ink); padding: 8px 9px; font: inherit; text-align: left; cursor: pointer; }
.pace-editor > button strong, .pace-editor > button span { display: block; }
.pace-editor > button strong { font-size: 12px; }
.pace-editor > button span { margin-top: 3px; color: var(--cross-ink-soft); font-size: 10px; line-height: 1.45; }
.pace-editor > button:hover, .pace-editor > button.selected { border-color: var(--cross-rust); }
.pace-editor > button.selected strong { color: var(--cross-rust); }
.agent-scroll { flex: 1; padding: 14px 14px 8px; }
.agent-state, .agent-result { color: #5b6b73; font-size: 13px; line-height: 1.55; }
.proposal-card { margin-top: 10px; padding: 10px; border: 1px solid rgba(142, 67, 43, .28); border-radius: 6px; background: rgba(250, 247, 240, .62); }
.proposal-card p { margin: 6px 0; }
.proposal-actions { display: flex; gap: 8px; align-items: center; }
.proposal-segments { display: grid; gap: 4px; margin: 8px 0; padding-left: 20px; }
.proposal-segments li { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; }
.proposal-segments small { grid-column: 1 / -1; color: var(--cross-ink-soft); }
.draft-result-card { margin-top: 10px; border-top: 2px solid var(--cross-rust); border-bottom: 1px solid rgba(32, 37, 41, .18); background: rgba(216, 220, 221, .42); padding: 11px 0; }
.draft-result-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.draft-result-card > header strong, .draft-result-card > header small { display: block; }
.draft-result-card > header strong { color: var(--cross-ink); font-size: 13px; }
.draft-result-card > header small { margin-top: 3px; color: var(--cross-ink-soft); font-size: 11px; }
.draft-basis, .draft-evidence { margin-top: 10px; border-top: 1px solid rgba(32, 37, 41, .12); padding-top: 8px; }
.draft-basis > strong, .draft-evidence > strong { color: var(--cross-ink); font-size: 11px; }
.draft-basis ul { margin: 5px 0 0; padding-left: 17px; color: var(--cross-ink-soft); font-size: 11px; line-height: 1.6; }
.draft-days { margin: 10px 0 0; padding: 0; list-style: none; }
.draft-days li { display: grid; grid-template-columns: 48px 1fr; gap: 3px 8px; border-top: 1px solid rgba(32, 37, 41, .1); padding: 8px 0; }
.draft-days li strong { color: var(--cross-rust); font-size: 12px; }
.draft-days li span { color: var(--cross-ink); font-size: 12px; line-height: 1.5; }
.draft-days li small { grid-column: 2; margin: 0; color: var(--cross-ink-soft); font-size: 11px; line-height: 1.5; }
.draft-evidence { display: flex; flex-wrap: wrap; gap: 5px 7px; align-items: center; }
.draft-evidence > strong { width: 100%; }
.draft-evidence span { border-left: 2px solid var(--cross-moss); color: var(--cross-ink-soft); padding-left: 5px; font-size: 10px; }
.draft-result-actions { display: flex; gap: 9px; align-items: center; margin-top: 10px; }
.confirm-action { border: 0; border-radius: 4px; padding: 6px 10px; background: var(--cross-rust); color: #fff; cursor: pointer; }
.chat-message { max-width: 92%; margin: 0 0 12px; border: 1px solid rgba(48, 56, 61, .14); border-radius: 8px; background: rgba(244, 246, 245, .74); padding: 9px 10px; color: #30383d; font-size: 13px; line-height: 1.55; }
.chat-message.user { margin-left: auto; border-color: rgba(79, 102, 86, .28); background: rgba(79, 102, 86, .14); }
.chat-message.system { max-width: 100%; border-style: dashed; background: rgba(91, 107, 115, .1); color: #5b6b73; }
.chat-message.failed { border-color: rgba(161, 75, 60, .36); background: rgba(161, 75, 60, .09); }
.chat-message.superseded { border-color: rgba(32, 37, 41, .12); background: rgba(197, 203, 204, .36); color: var(--cross-ink-soft); }
.message-content { margin-top: 5px; white-space: pre-wrap; }
.message-content :deep(p) { margin: 0 0 7px; }
.message-content :deep(p:last-child) { margin-bottom: 0; }
.message-content :deep(h1), .message-content :deep(h2), .message-content :deep(h3) { margin: 8px 0 5px; color: var(--cross-ink); font-size: 13px; }
.message-content :deep(ul), .message-content :deep(ol) { margin: 5px 0 8px; padding-left: 18px; }
.message-content :deep(li) { margin: 3px 0; }
.message-content :deep(code) { background: rgba(32, 37, 41, .08); padding: 1px 3px; font-family: inherit; font-size: .95em; }
.chat-message small { display: block; margin-top: 5px; color: rgba(48, 56, 61, .74); }
.message-meta { display: flex; min-height: 14px; align-items: center; justify-content: flex-start; gap: 8px; color: rgba(48, 56, 61, .68); font-size: 11px; }
.chat-message.user .message-meta { justify-content: flex-end; }
.message-meta time { font: inherit; }
.thinking-mark { display: inline-flex; height: 12px; align-items: center; gap: 2px; }
.thinking-mark i { display: block; width: 2px; border-radius: 2px; background: var(--cross-rust); animation: thinking-rise 1.15s ease-in-out infinite; }
.thinking-mark i:nth-child(1) { height: 4px; }
.thinking-mark i:nth-child(2) { height: 9px; animation-delay: -.82s; }
.thinking-mark i:nth-child(3) { height: 6px; animation-delay: -.56s; }
.thinking-mark i:nth-child(4) { height: 11px; animation-delay: -.28s; }
@keyframes thinking-rise { 0%, 100% { transform: scaleY(.55); opacity: .45; } 50% { transform: scaleY(1); opacity: 1; } }
.change-list { margin: 8px 0 0; border-top: 1px solid rgba(48, 56, 61, .12); padding: 7px 0 0 18px; color: #4f6656; font-size: 12px; }
.change-list li { margin: 3px 0; }
.follow-up-suggestions { display: grid; gap: 5px; margin-top: 9px; border-top: 1px solid rgba(32, 37, 41, .12); padding-top: 8px; }
.follow-up-suggestions button { border: 0; border-bottom: 1px solid rgba(32, 37, 41, .14); background: transparent; color: var(--cross-ink-soft); padding: 5px 1px; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.follow-up-suggestions button::before { margin-right: 5px; color: var(--cross-rust); content: '↗'; }
.follow-up-suggestions button:hover, .follow-up-suggestions button:focus-visible { border-bottom-color: var(--cross-rust); color: var(--cross-rust); outline: none; }
.activity-panel { margin-top: 8px; border-top: 1px solid rgba(32, 37, 41, .12); padding-top: 6px; }
.activity-heading { display: flex; width: 100%; align-items: center; justify-content: space-between; border: 0; background: transparent; color: var(--cross-ink-soft); padding: 2px 0; font: inherit; font-size: 11px; cursor: pointer; }
.activity-heading i { color: var(--cross-rust); font-style: normal; font-size: 14px; }
.activity-list { margin: 7px 0 0; padding: 0; list-style: none; }
.activity-list li { display: grid; grid-template-columns: 16px 1fr; gap: 5px; padding: 4px 0; color: var(--cross-ink-soft); }
.activity-list li.running { color: var(--cross-ink); }
.activity-list li.failed { color: var(--cross-rust); }
.activity-list li.superseded { color: var(--cross-ink-soft); opacity: .7; }
.activity-mark { color: var(--cross-moss); font-size: 10px; line-height: 1.7; }
.activity-list li.running .activity-mark { color: var(--cross-rust); animation: activity-pulse 1.2s ease-in-out infinite; }
.activity-list li.failed .activity-mark { color: var(--cross-rust); }
.activity-list li.superseded .activity-mark { color: var(--cross-ink-faint); }
.activity-list strong, .activity-list small { display: block; }
.activity-list strong { font-size: 11px; font-weight: 600; }
.activity-list small { margin-top: 1px; color: var(--cross-ink-soft); font-size: 10px; line-height: 1.45; }
@keyframes activity-pulse { 50% { opacity: .35; } }
.undo-bar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid rgba(95, 91, 112, .24); border-radius: 6px; background: rgba(229, 226, 234, .96); padding: 8px 10px; color: #5f5b70; font-size: 11px; }
.state-title { margin: 0 0 8px; color: #1d2226; font-size: 15px; font-weight: 650; }
.agent-state p { margin: 0; }
.empty-agent { padding-top: 8px; }
.empty-agent > p:not(.state-title) { max-width: 29em; color: var(--cross-ink-soft); line-height: 1.75; }
.quick-prompts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.quick-prompts button { border: 1px solid rgba(91, 107, 115, .28); border-radius: 3px 9px 3px 3px; background: transparent; color: #5b6b73; padding: 6px 8px; font: inherit; font-size: 11px; cursor: pointer; transition: transform .18s ease, border-color .18s ease, color .18s ease; }
.quick-prompts button:hover { transform: translateY(-1px); border-color: var(--cross-rust); color: var(--cross-rust); }
.setup-link { margin-top: 13px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink-soft); padding: 2px 0; font: inherit; font-size: 11px; cursor: pointer; }
.setup-link:hover, .setup-link:focus-visible { border-bottom-color: var(--cross-rust); color: var(--cross-rust); outline: none; }
.trace-list { margin: 0; padding-left: 20px; color: rgba(29, 34, 38, .76); }
.trace-list li { padding: 5px 0; }
.draft-day { padding: 9px 0; border-bottom: 1px solid rgba(29, 34, 38, .1); }
.draft-day strong, .draft-day span { display: block; }
.draft-day strong { color: #6b6c7b; font-size: 12px; }
.draft-day span { margin-top: 3px; color: #5b6b73; font-size: 13px; }
.result-summary { margin: 0 0 6px; color: rgba(29, 34, 38, .76); font-size: 12px; }
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
.agent-input textarea::placeholder, .destination-editor > input::placeholder { color: rgba(32, 37, 41, .64); }
.agent-input textarea:focus { border-color: var(--cross-rust); outline: none; }
.send-button:disabled { background: #c7cdcf; border-color: #c7cdcf; color: rgba(29, 34, 38, .46); cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .quick-prompts button, .brief-row > i { transition: none; } .quick-prompts button:hover { transform: none; } .activity-list li.running .activity-mark, .thinking-mark i { animation: none; } }
.legacy-sidebar { position: absolute; top: 20px; bottom: 20px; left: 20px; z-index: 2; width: 360px; min-width: 0; overflow: hidden; border: 1px solid rgba(29, 34, 38, .18); border-radius: 8px; background: rgba(216, 220, 221, .94); box-shadow: var(--cross-shadow); }
.legacy-sidebar-content { display: flex; height: 100%; flex-direction: column; gap: 14px; overflow-y: auto; padding: 14px; box-sizing: border-box; }
.legacy-header { padding-bottom: 13px; border-bottom: 1px dashed #e1ded6; }
.legacy-header-row { display: flex; align-items: center; justify-content: space-between; color: var(--cross-ink); font-size: 16px; }
.legacy-header-row strong { letter-spacing: .04em; }
.legacy-header-row label { color: var(--cross-muted); font-size: 12px; font-weight: 400; }
.legacy-sample, .legacy-actions button { margin-top: 10px; border: 1px solid rgba(95, 91, 112, .34); border-radius: 5px; background: rgba(95, 91, 112, .16); color: #30383d; padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.legacy-header .legacy-sample { margin-top: 0; }
.legacy-actions { display: flex; gap: 8px; }
.legacy-actions button { margin-top: 0; border-color: rgba(79, 102, 86, .34); background: rgba(79, 102, 86, .16); color: #30383d; }
.legacy-actions .new-route-action { border-color: rgba(155, 75, 62, .44); background: rgba(155, 75, 62, .12); }
.legacy-actions .clear-route-action { border-color: rgba(122, 85, 92, .34); background: rgba(122, 85, 92, .16); color: #30383d; }
.legacy-actions button:disabled { opacity: .55; cursor: not-allowed; }
.legacy-days { display: flex; flex-wrap: wrap; gap: 7px; padding-bottom: 12px; border-bottom: 1px dashed #e1ded6; }
.legacy-days button { border: 1px solid transparent; border-radius: 5px 7px 5px 6px; background: rgba(48, 56, 61, .08); color: #30383d; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; transition: transform .18s ease, box-shadow .18s ease; }
.legacy-days .overview-tab { background: rgba(48, 56, 61, .1); }
.legacy-days .unscheduled-tab { background: rgba(79, 102, 86, .16); }
.legacy-days button:hover { transform: translateY(-1px); }
.legacy-days button.active { border-color: var(--day-color, rgba(48, 56, 61, .28)); box-shadow: inset 0 -2px 0 var(--day-color, rgba(48, 56, 61, .28)); color: var(--cross-ink); }
.legacy-list { flex: 1; min-height: 260px; overflow-y: auto; }
.legacy-empty { padding-top: 80px; color: var(--cross-muted); font-size: 13px; text-align: center; }
.route-source-tabs { display: flex; gap: 10px; border-bottom: 1px solid rgba(32, 37, 41, .14); padding-bottom: 8px; }
.route-source-tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--cross-ink-soft); padding: 3px 0; font: inherit; font-size: 12px; cursor: pointer; }
.route-source-tabs button.active { border-bottom-color: var(--cross-rust); color: var(--cross-ink); font-weight: 650; }
.legacy-place { display: flex; align-items: flex-start; gap: 10px; margin: 0; border: 0; border-bottom: 1px solid rgba(29, 34, 38, .12); border-radius: 0; background: transparent; padding: 11px 2px; cursor: pointer; transition: background-color .18s ease; }
.legacy-place:hover { background: rgba(95, 114, 103, .07); box-shadow: none; }
.legacy-place.selected { background: rgba(32, 37, 41, .07); }
.legacy-order { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; flex: 0 0 auto; border: 0; border-radius: 50%; color: #f3efe7; font-size: 11px; font-weight: 650; box-shadow: 0 1px 3px rgba(32, 37, 41, .18); }
.legacy-place.selected .legacy-order { transform: scale(1.08); box-shadow: 0 2px 6px rgba(32, 37, 41, .2); }
.legacy-place > div:nth-child(2) { min-width: 0; flex: 1; }
.legacy-place strong, .legacy-place small { display: block; }
.legacy-place strong { overflow: hidden; color: var(--cross-ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.legacy-place small { overflow: hidden; margin-top: 4px; color: var(--cross-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.legacy-place-actions { display: flex; gap: 3px; }
.legacy-place-actions button { border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; background: transparent; color: var(--cross-ink-soft); padding: 3px 2px; font: inherit; font-size: 11px; cursor: pointer; }
.legacy-place-actions button:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.legacy-place-actions button:last-child { color: var(--cross-ink-soft); }
.legacy-place-actions button:disabled { opacity: .45; cursor: not-allowed; }
.legacy-route-info { display: flex; flex-direction: column; gap: 4px; border: 1px dashed rgba(29, 34, 38, .22); border-radius: 7px; background: rgba(220, 223, 222, .72); padding: 12px; color: var(--cross-muted); font-size: 12px; }
.legacy-route-info strong { color: var(--cross-ink); font-size: 14px; }
.map-toolbar { top: 20px; left: 400px; right: 400px; z-index: 2; gap: 16px; padding: 8px 20px; overflow: hidden; border-radius: 8px; background: rgba(216,220,221,.88); box-shadow: 0 2px 12px rgba(29,34,38,.1); }
.map-toolbar :deep(.poi-search) { width: min(400px, 45%); min-width: 0; flex: 1 1 auto; }
.toolbar-divider { background: transparent; }
.toolbar-button { border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; background: transparent; color: var(--cross-ink-soft); padding: 6px 4px; font-size: 12px; }
.toolbar-button:hover, .toolbar-button.active { border-bottom-color: var(--cross-rust); background: transparent; color: var(--cross-rust); }
.map-retry { color: var(--cross-rust); }
@media (max-width: 1180px) { .legacy-sidebar { width: 340px; } .agent-panel { width: 300px; } .map-toolbar { left: 380px; right: 340px; } .draft-map-banner { left: 380px; max-width: min(360px, calc(100% - 720px)); } }
@media (max-width: 900px) { .map-view { overflow-y: auto; } .workspace { min-height: 1100px; } .legacy-sidebar, .agent-panel { top: 12px; bottom: auto; width: calc(100% - 24px); } .legacy-sidebar { left: 12px; height: 360px; } .agent-panel { top: 390px; right: 12px; height: 360px; } .map-stage { top: 760px; height: 520px; } .map-toolbar { left: 12px; right: 12px; } .draft-map-banner { top: 72px; left: 12px; max-width: calc(100% - 24px); } }
</style>
