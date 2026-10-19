<template>
  <main class="schedule-view">
    <header class="schedule-header">
      <div>
        <p>ITINERARY</p>
        <h1>日程安排</h1>
      </div>
      <div class="schedule-header-actions">
        <label v-if="scheduleDays.length" class="route-date">
          <span>出发日期 <small>整条路线只设一次</small></span>
          <input :value="tripStore.tripStartDate" type="date" @change="updateStartDate" />
        </label>
        <button class="sample-action" type="button" @click="loadPresetRoute">加载示例路线</button>
      </div>
    </header>

    <ol v-if="scheduleDays.length" class="itinerary-list">
      <li v-for="day in scheduleDays" :key="day.day" class="day-block">
        <div class="day-rail" aria-hidden="true">
          <span :style="{ borderColor: dayColor(day.day), background: dayTint(day.day, 0.18) }"></span>
        </div>

        <section class="day-content">
          <div class="day-heading">
            <div>
              <p class="day-label" :style="{ color: dayColor(day.day) }">DAY {{ day.day }}</p>
              <h2>{{ day.city || `第 ${day.day} 天` }}</h2>
            </div>
            <time v-if="tripStore.tripStartDate && day.date" class="day-date" :datetime="dateInput(day.date)">{{ dateInput(day.date) }}</time>
          </div>

          <ol class="stop-list">
            <template v-for="(destination, index) in day.destinations" :key="destination.id">
              <li v-if="scheduleSegmentBefore(day.destinations, index)" class="schedule-transport-row">
                <span v-if="scheduleSegmentBefore(day.destinations, index)?.status === 'loading'">正在查询路线…</span>
                <span v-else-if="scheduleSegmentBefore(day.destinations, index)?.status === 'failed'">未获取到路线</span>
                <span v-else>{{ transportSummary(scheduleSegmentBefore(day.destinations, index)!) }}</span>
              </li>
              <li class="stop-row">
                <button class="stop-main" type="button" @click="openInMap(destination)">
                  <span class="stop-index" :style="{ background: dayColor(day.day) }">{{ index + 1 }}</span>
                  <span class="stop-copy">
                    <strong>{{ destination.name }} <span v-if="destination.reservationStatus === 'required'" class="reservation-badge required">约</span><span v-else-if="destination.reservationStatus === 'booked'" class="reservation-badge booked">✓</span></strong>
                    <small>{{ destination.description || destination.agentNote || '点击在地图中查看这个地点' }}</small>
                    <small v-if="destination.reservationStatus === 'required'">还没预约<template v-if="destination.reservationNote"> · {{ destination.reservationNote }}</template></small>
                    <small v-else-if="destination.reservationStatus === 'booked'">已预约</small>
                  </span>
                  <span class="locate-hint">定位 ↗</span>
                </button>
                <div class="stop-actions">
                  <button type="button" :disabled="index === 0" aria-label="上移" @click="reorder(destination.id, 'up')">↑</button>
                  <button type="button" :disabled="index === day.destinations.length - 1" aria-label="下移" @click="reorder(destination.id, 'down')">↓</button>
                  <button type="button" @click="openEditor(destination)">编辑</button>
                  <button type="button" @click="removeDestination(destination)">删除</button>
                </div>
              </li>
            </template>
          </ol>
        </section>
      </li>
    </ol>

    <JourneyEmptyState
      v-else
      title="日程是空的"
      description="先去规划页添加几个地点。"
      action-label="加载示例路线"
      @action="loadPresetRoute"
    />

  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTripStore } from '@/store/trip'
import { dayColor, dayTint } from '@/lib/dayPalette'
import type { Destination, TransportSegment } from '@/types'
import JourneyEmptyState from '@/components/JourneyEmptyState.vue'

const tripStore = useTripStore()
const router = useRouter()

const scheduledDestinations = computed(() => tripStore.destinations.filter((destination) =>
  destination.planningStatus !== 'unscheduled' &&
  destination.planningStatus !== 'candidate' &&
  destination.planningStatus !== 'rejected'
))

const scheduleDays = computed(() => tripStore.schedule.map((day) => ({
  ...day,
  destinations: scheduledDestinations.value
    .filter((destination) => Number(destination.day || 1) === day.day)
    .sort((a, b) => (a.withinDayOrder || a.order) - (b.withinDayOrder || b.order))
})))

function scheduleSegmentBefore(dayDestinations: Destination[], index: number) {
  if (index < 1) return undefined
  const previous = dayDestinations[index - 1]
  const current = dayDestinations[index]
  return (tripStore.transportSegments || []).find((segment) =>
    segment.fromDestinationId === previous.id && segment.toDestinationId === current.id
  )
}

function transportSummary(segment: TransportSegment) {
  const mode = { walk: '步行', cycle: '骑行', drive: '驾车', transit: '公共交通' }[segment.mode]
  const distance = (segment.distanceMeters || 0) < 1000
    ? `${Math.round(segment.distanceMeters || 0)} 米`
    : `${((segment.distanceMeters || 0) / 1000).toFixed(1)} 公里`
  return `${mode} · ${distance} · ${Math.ceil((segment.durationSeconds || 0) / 60)} 分钟`
}

function dateInput(date: Date | string) {
  if (typeof date === 'string') return date.slice(0, 10)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function updateStartDate(event: Event) {
  tripStore.setTripStartDate((event.target as HTMLInputElement).value)
}

function openEditor(destination: Destination) {
  router.push({ path: '/map', query: { edit: destination.id } })
}

function reorder(id: string, direction: 'up' | 'down') {
  tripStore.reorderDestinationWithinDay(id, direction)
}

function removeDestination(destination: Destination) {
  ElMessageBox.confirm(`确定从行程中删除“${destination.name}”吗？`, '删除地点', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    tripStore.removeDestination(destination.id)
    tripStore.refreshCurrentRoute()
    ElMessage.success('地点已从地图和日程中删除')
  }).catch(() => undefined)
}

function openInMap(destination: Destination) {
  router.push({ path: '/map', query: { focus: destination.id, day: String(destination.day || 1) } })
}

function loadPresetRoute() {
  tripStore.loadPresetRoute('jiangzhehu')
}
</script>

<style scoped>
.schedule-view {
  min-height: calc(100vh - 60px);
  padding: 38px clamp(24px, 6vw, 92px) 64px;
  background: var(--cross-canvas);
  color: var(--cross-ink);
}

.schedule-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  max-width: 980px;
  margin: 0 auto 34px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--cross-ink-faint);
}

.schedule-header p,
.day-label {
  margin: 0 0 5px;
  font-size: 11px;
  letter-spacing: .09em;
}

.schedule-header p { color: var(--cross-ink-soft); }
.schedule-header h1 { margin: 0; font-size: 22px; font-weight: 580; }

.sample-action {
  border: 0;
  border-bottom: 1px solid var(--cross-ink-faint);
  border-radius: 0;
  background: transparent;
  color: var(--cross-ink-soft);
  padding: 6px 2px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sample-action:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }

.itinerary-list {
  max-width: 980px;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.day-block {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  min-height: 150px;
}

.day-rail { position: relative; }
.day-rail::after {
  position: absolute;
  top: 17px;
  bottom: -1px;
  left: 5px;
  width: 1px;
  background: var(--cross-ink-faint);
  content: '';
}
.day-block:last-child .day-rail::after { display: none; }
.day-rail span {
  position: relative;
  z-index: 1;
  display: block;
  width: 11px;
  height: 11px;
  border: 1px solid;
  border-radius: 50%;
  box-sizing: border-box;
}

.day-content { padding: 0 0 34px 22px; }
.day-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 12px;
}
.day-heading h2 { margin: 0; font-size: 17px; font-weight: 570; }

.schedule-header-actions { display: flex; align-items: flex-end; gap: 24px; }
.route-date { display: flex; flex-direction: column; gap: 4px; color: var(--cross-ink-soft); font-size: 11px; }
.route-date small { margin-left: 6px; color: var(--cross-ink-soft); font-weight: 400; }
.route-date input {
  width: 126px;
  border: 0;
  border-bottom: 1px solid var(--cross-ink-faint);
  border-radius: 0;
  background: transparent;
  color: var(--cross-ink);
  padding: 4px 0;
  font: inherit;
}
.route-date input:focus { border-bottom-color: var(--cross-rust); outline: none; }
.day-date { color: var(--cross-ink-soft); font-size: 11px; }

.stop-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid rgba(32, 37, 41, .14); }
.schedule-transport-row { margin-left: 11px; border-left: 1px dashed var(--cross-ink-faint); padding: 7px 0 7px 24px; color: var(--cross-ink-soft); font-size: 11px; list-style: none; }
.stop-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid rgba(32, 37, 41, .14);
  padding: 10px 0;
}

.stop-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.stop-index {
  display: inline-flex;
  width: 23px;
  height: 23px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #f3efe7;
  font-size: 10px;
  font-weight: 650;
}
.stop-copy { min-width: 0; flex: 1; }
.stop-copy strong,
.stop-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stop-copy strong { font-size: 13px; font-weight: 570; color: var(--cross-ink); }
.reservation-badge { display: inline-flex; min-width: 16px; height: 16px; align-items: center; justify-content: center; vertical-align: 1px; font-size: 10px; line-height: 1; }
.reservation-badge.required { border: 1px dashed #a94732; border-radius: 5px; color: #a94732; }
.reservation-badge.booked { border-radius: 4px; background: #5368ad; color: #fff; }
.stop-copy small { margin-top: 3px; color: var(--cross-ink-soft); font-size: 11px; }
.locate-hint { color: var(--cross-ink-soft); font-size: 10px; opacity: 0; transition: opacity .18s ease; }
.stop-main:hover .locate-hint,
.stop-main:focus-visible .locate-hint { opacity: 1; }

.stop-actions { display: flex; gap: 7px; }
.stop-actions button {
  border: 0;
  border-bottom: 1px solid var(--cross-ink-faint);
  border-radius: 0;
  background: transparent;
  color: var(--cross-ink-soft);
  padding: 3px 1px;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.stop-actions button:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.stop-actions button:disabled { opacity: .3; cursor: not-allowed; }

@media (max-width: 720px) {
  .schedule-view { min-height: 100%; padding: 22px 14px 36px; }
  .schedule-header { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .schedule-header-actions { align-items: flex-end; gap: 10px; }
  .route-date input { min-height: 44px; }
  .schedule-header h1 { font-size: 26px; }
  .sample-action { min-height: 44px; padding: 8px 10px; }
  .itinerary-list { margin-top: 24px; }
  .day-block { grid-template-columns: 16px minmax(0, 1fr); }
  .day-content { padding-left: 8px; }
  .day-heading { display: block; }
  .day-date { display: inline-block; margin-top: 8px; }
  .stop-row { grid-template-columns: 1fr; }
  .stop-main { min-height: 54px; grid-template-columns: 28px minmax(0, 1fr); }
  .stop-actions { display: grid; grid-template-columns: repeat(4, minmax(44px, 1fr)); gap: 4px; padding: 6px 0 0 36px; }
  .stop-actions button { min-width: 44px; min-height: 42px; }
  .locate-hint { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .locate-hint { transition: none; }
}
</style>
