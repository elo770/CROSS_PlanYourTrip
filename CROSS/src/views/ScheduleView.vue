<template>
  <main class="schedule-view">
    <header class="schedule-header">
      <div>
        <p>ITINERARY</p>
        <h1>日程安排</h1>
      </div>
      <button class="sample-action" type="button" @click="loadPresetRoute">加载示例路线</button>
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
            <label class="date-editor">
              <span>日期</span>
              <input :value="dateInput(day.date)" type="date" @change="updateDate(day.day, $event)" />
            </label>
          </div>

          <ol class="stop-list">
            <li v-for="(destination, index) in day.destinations" :key="destination.id" class="stop-row">
              <button class="stop-main" type="button" @click="openInMap(destination)">
                <span class="stop-index" :style="{ background: dayColor(day.day) }">{{ index + 1 }}</span>
                <span class="stop-copy">
                  <strong>{{ destination.name }}</strong>
                  <small>{{ destination.description || destination.agentNote || '点击在地图中查看这个地点' }}</small>
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
          </ol>
        </section>
      </li>
    </ol>

    <JourneyEmptyState
      v-else
      title="日程还在等第一站"
      description="先去路线规划加入地点，地图和日程会使用同一份分天与顺序。"
      action-label="加载示例路线"
      @action="loadPresetRoute"
    />

    <el-dialog v-model="showEditor" title="编辑行程地点" width="min(440px, calc(100vw - 32px))">
      <el-form label-position="top">
        <el-form-item label="地点名称">
          <el-input v-model.trim="editForm.name" />
        </el-form-item>
        <el-form-item label="所属日期">
          <el-select v-model="editForm.day" class="day-select">
            <el-option v-for="day in dayOptions" :key="day" :label="`Day ${day}`" :value="day" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.description" type="textarea" :rows="3" placeholder="补充停留重点、预约或交通提醒" />
        </el-form-item>
      </el-form>
      <template #footer>
        <button class="dialog-action" type="button" @click="showEditor = false">取消</button>
        <button class="dialog-action primary" type="button" :disabled="!editForm.name" @click="saveEditor">保存更改</button>
      </template>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTripStore } from '@/store/trip'
import { dayColor, dayTint } from '@/lib/dayPalette'
import type { Destination } from '@/types'
import JourneyEmptyState from '@/components/JourneyEmptyState.vue'

const tripStore = useTripStore()
const router = useRouter()
const showEditor = ref(false)
const editForm = reactive({ id: '', name: '', description: '', day: 1 })

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

const dayOptions = computed(() => {
  const actualDays = [...new Set(scheduledDestinations.value.map((destination) => Number(destination.day || 1)))].sort((a, b) => a - b)
  if (actualDays.length) return actualDays
  const fallbackDays = tripStore.currentRoute?.estimatedDays || 1
  return Array.from({ length: fallbackDays }, (_, index) => index + 1)
})

function dateInput(date: Date | string) {
  if (typeof date === 'string') return date.slice(0, 10)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function updateDate(day: number, event: Event) {
  const date = (event.target as HTMLInputElement).value
  if (date) tripStore.updateDayDate(day, date)
}

function openEditor(destination: Destination) {
  Object.assign(editForm, {
    id: destination.id,
    name: destination.name,
    description: destination.description || destination.agentNote || '',
    day: Number(destination.day || 1)
  })
  showEditor.value = true
}

function saveEditor() {
  if (!editForm.id || !editForm.name) return
  tripStore.updateDestinationDetails(editForm.id, {
    name: editForm.name,
    description: editForm.description,
    day: editForm.day
  })
  showEditor.value = false
  ElMessage.success('日程与地图已同步')
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

.sample-action,
.dialog-action {
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

.sample-action:hover,
.dialog-action:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }

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

.date-editor { display: flex; align-items: center; gap: 10px; color: var(--cross-ink-soft); font-size: 11px; }
.date-editor input {
  width: 126px;
  border: 0;
  border-bottom: 1px solid var(--cross-ink-faint);
  border-radius: 0;
  background: transparent;
  color: var(--cross-ink);
  padding: 4px 0;
  font: inherit;
}
.date-editor input:focus { border-bottom-color: var(--cross-rust); outline: none; }

.stop-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid rgba(32, 37, 41, .14); }
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

.day-select { width: 100%; }
.dialog-action { margin-left: 14px; }
.dialog-action.primary { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
.dialog-action:disabled { opacity: .4; cursor: not-allowed; }

@media (max-width: 720px) {
  .schedule-view { padding: 28px 18px 48px; }
  .schedule-header { align-items: flex-start; }
  .day-content { padding-left: 12px; }
  .day-heading { display: block; }
  .date-editor { margin-top: 12px; justify-content: flex-start; }
  .stop-row { grid-template-columns: 1fr; }
  .stop-actions { padding-left: 35px; }
  .locate-hint { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .locate-hint { transition: none; }
}
</style>
