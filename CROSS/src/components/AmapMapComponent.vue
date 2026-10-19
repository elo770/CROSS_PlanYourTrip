<template>
  <div ref="mapContainer" class="map">
    <Teleport to="body">
    <div v-if="showPointForm" class="point-form-overlay" @click.self="closePointForm">
      <div class="point-form-container" :class="{ 'on-left': pointFormOnLeft, 'editing-point': isEditing }" :style="pointFormPosition">
        <div class="point-form-header">
          <PlaceCategoryIcon class="point-category-icon" :category="pointFormData.placeCategory || undefined" />
          <div class="point-form-heading">
            <template v-if="isEditing">
              <input v-if="editingPointName" ref="pointNameInput" v-model="pointFormData.name" class="point-heading-input" aria-label="地点名称" @blur="editingPointName = false" @keydown.enter.prevent="editingPointName = false">
              <button v-else type="button" class="point-heading-button" title="修改地点名称" @click="startEditingPointName">{{ pointFormData.name }}</button>
              <div class="point-form-subtitle">
                <select v-if="editingPointDay" ref="pointDaySelect" v-model="pointFormData.assignment" aria-label="所属 Day" @change="pointFormOrder = undefined; editingPointDay = false" @blur="editingPointDay = false">
                  <option value="unscheduled">待规划</option>
                  <option v-for="day in dayChoices" :key="day" :value="String(day)">Day {{ day }}</option>
                </select>
                <button v-else type="button" title="更换所属 Day" @click="startEditingPointDay">{{ pointFormData.assignment === 'unscheduled' ? '待规划' : `Day ${pointFormData.assignment}` }}</button>
                <span v-if="pointFormOrder">· 第 {{ pointFormOrder }} 站</span>
              </div>
            </template>
            <h3 v-else>添加地点</h3>
          </div>
          <button class="close-btn" aria-label="关闭便签" @click="closePointForm">×</button>
        </div>
        <div class="point-form-content">
          <div v-if="!isEditing" class="form-item">
            <label>点名称</label>
            <input v-model="pointFormData.name" type="text" placeholder="请输入点名称" required>
          </div>
          <div class="form-item">
            <label>备注</label>
            <textarea v-model="pointFormData.description" rows="2" placeholder="记下想看的、想做的事"></textarea>
          </div>
          <div class="form-item place-category-row">
            <label for="point-category">地点类型 <small>可选</small></label>
            <select id="point-category" v-model="pointFormData.placeCategory">
              <option :value="undefined">通用地点</option>
              <option v-for="option in placeCategoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
          <div class="form-item reservation-section">
            <label class="reservation-switch">
              <span>预约</span>
              <input
                type="checkbox"
                :checked="pointFormData.reservationStatus !== 'none'"
                @change="toggleReservationRequired"
              >
              <i aria-hidden="true"></i>
              <strong>需要预约</strong>
            </label>
            <div v-if="pointFormData.reservationStatus !== 'none'" class="reservation-options">
              <button
                type="button"
                :class="{ active: pointFormData.reservationStatus === 'required' }"
                @click="pointFormData.reservationStatus = 'required'"
              >还没预约</button>
              <button
                type="button"
                :class="{ active: pointFormData.reservationStatus === 'booked' }"
                @click="pointFormData.reservationStatus = 'booked'"
              >已预约</button>
            </div>
          </div>
          <div v-if="pointFormData.reservationStatus !== 'none'" class="form-item">
            <label>预约方式</label>
            <input v-model="pointFormData.reservationNote" type="text" placeholder="例如：提前 3 天在官方公众号预约">
          </div>
          <div class="form-item photo-form-item">
            <div class="image-upload-container">
              <div v-if="pointFormData.image" class="image-preview-small">
                <img :src="pointFormData.image" alt="预览图片" class="preview-img-small" />
                <button class="remove-img-btn" @click.stop="removeImage">x</button>
              </div>
              <label class="image-upload-action">
                <svg aria-hidden="true" viewBox="0 0 36 30" fill="none"><path d="M3 8h7l2-4h11l2 4h8v19H3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="18" cy="18" r="6" stroke="currentColor" stroke-width="1.6"/></svg>
                <strong>放一张照片</strong>
                <input type="file" accept="image/*" @change="handleImageUpload" class="image-upload-input">
              </label>
            </div>
          </div>
          <p class="reservation-disclaimer">预约信息请以景点官方渠道为准</p>
        </div>
        <div class="point-form-footer">
          <button class="cancel-btn" @click="closePointForm">取消</button>
          <button class="save-btn" @click="savePointForm">保存</button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTripStore } from '@/store/trip'
import type { Destination, PlaceCategory } from '@/types'
import PlaceCategoryIcon from '@/components/PlaceCategoryIcon.vue'
import { dayColor } from '@/lib/dayPalette'
import { STOP_RING_PATH, PENDING_RING_PATH } from '@/lib/stopMarker'

declare global {
  interface Window {
    AMap?: any
    __crossAmapLoading?: Promise<any>
  }
}

type FeatureClickPayload = {
  id: string
  name: string
  description?: string
  date?: string
  image?: string
  order?: number
  day?: number
  planningStatus?: Destination['planningStatus']
  reservationStatus?: Destination['reservationStatus']
  reservationNote?: string
  placeCategory?: PlaceCategory
  coordinates: [number, number]
}

type MapPoiClickPayload = {
  id: string
  name: string
  coordinates: [number, number]
}

type FitBoundsOptions = {
  padding?: number | { top: number; right: number; bottom: number; left: number }
  duration?: number
  offset?: [number, number]
  destinations?: Destination[]
}

const tripStore = useTripStore()
const emit = defineEmits<{ (event: 'pointFormOpen', value: boolean): void }>()
const amapKey = import.meta.env.VITE_AMAP_KEY
const mapContainer = ref<HTMLDivElement | null>(null)

let map: any = null
let routeLines: any[] = []
let markers: any[] = []
let draftMarkers: any[] = []
let markerByDestinationId = new Map<string, any>()
let mapClickHandler: ((coords: [number, number]) => void) | null = null
let featureClickHandler: ((props: FeatureClickPayload) => void) | null = null
let poiClickHandler: ((poi: MapPoiClickPayload) => void) | null = null
let viewChangeHandler: ((center: [number, number]) => void) | null = null
let readyHandlers: Array<() => void> = []
let isSelecting = false
let panEnabled = true
let highlightedDay: number | null = null
let visibleDay: number | 'overview' | 'unscheduled' = 'overview'
let selectedDestinationId: string | null = null
let routeLineVisible = true
let drawDayOnNextRender = false
let dayDrawFrame = 0
let drawingLines: Array<{ line: any; path: [number, number][] }> = []
let draftDestinations: Destination[] = []
let draftPreviewMode = false
let renderQueued = false
let queuedKeepView = true
let renderRevision = 0
let renderErrorHandler: ((error: Error) => void) | null = null

const showPointForm = ref(false)
const isEditing = ref(false)
const editingPointName = ref(false)
const editingPointDay = ref(false)
const pointNameInput = ref<HTMLInputElement | null>(null)
const pointDaySelect = ref<HTMLSelectElement | null>(null)
const pointFormPosition = ref<{ left?: string; top?: string; maxHeight?: string }>({})
const pointFormOnLeft = ref(false)
const pointFormOrder = ref<number | undefined>()
const pointFormData = ref({
  name: '',
  description: '',
  coordinates: [0, 0] as [number, number],
  assignment: 'unscheduled',
  image: '',
  reservationStatus: 'none' as NonNullable<Destination['reservationStatus']>,
  reservationNote: '',
  placeCategory: undefined as PlaceCategory | undefined
})
const placeCategoryOptions: { value: PlaceCategory; label: string }[] = [
  { value: 'garden', label: '园林' }, { value: 'river', label: '江河' },
  { value: 'street', label: '街区' }, { value: 'food', label: '餐饮' },
  { value: 'mountain', label: '山' }, { value: 'temple', label: '塔寺' },
  { value: 'venue', label: '场馆' }, { value: 'night', label: '夜景' }
]
const dayChoices = computed(() => {
  const maxDay = Math.max(1, ...tripStore.destinations
    .filter((item) => item.planningStatus !== 'unscheduled' && item.planningStatus !== 'candidate' && item.planningStatus !== 'rejected')
    .map((item) => Number(item.day) || 1))
  return Array.from({ length: maxDay }, (_, index) => index + 1)
})
let pointFormCallback: ((data: typeof pointFormData.value) => void) | null = null

onMounted(() => {
  void initMap()
})

onBeforeUnmount(() => {
  clearMapOverlays()
  if (map) {
    map.destroy()
    map = null
  }
})

function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (window.__crossAmapLoading) return window.__crossAmapLoading
  if (!amapKey) return Promise.reject(new Error('请先配置 VITE_AMAP_KEY'))

  window.__crossAmapLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapKey)}&plugin=AMap.Scale,AMap.ToolBar`
    script.async = true
    script.onload = () => resolve(window.AMap)
    script.onerror = () => reject(new Error('高德地图脚本加载失败'))
    document.head.appendChild(script)
  })
  return window.__crossAmapLoading
}

async function initMap() {
  if (!mapContainer.value) return
  const AMap = await loadAMap()
  map = new AMap.Map(mapContainer.value, {
    center: [114.057868, 22.543099],
    zoom: 5,
    viewMode: '2D',
    mapStyle: 'amap://styles/whitesmoke',
    isHotspot: true,
    resizeEnable: true
  })
  map.addControl(new AMap.Scale())
  map.addControl(new AMap.ToolBar({ position: 'RT' }))
  map.on('complete', () => {
    updateMap()
    setMapCursor()
    emitViewCenter()
    const handlers = readyHandlers
    readyHandlers = []
    handlers.forEach((fn) => fn())
  })
  map.on('moveend', () => {
    emitViewCenter()
    if (showPointForm.value) pointFormPosition.value = pointFormPositionFor(pointFormData.value.coordinates)
  })
  map.on('click', (event: any) => {
    if (isSelecting && mapClickHandler) {
      mapClickHandler([event.lnglat.lng, event.lnglat.lat])
    }
  })
  map.on('hotspotclick', (event: any) => {
    if (isSelecting) return
    const lng = event.lnglat?.getLng?.() ?? event.lnglat?.lng
    const lat = event.lnglat?.getLat?.() ?? event.lnglat?.lat
    if (!event.id || !event.name || !Number.isFinite(lng) || !Number.isFinite(lat)) return
    poiClickHandler?.({ id: String(event.id), name: String(event.name), coordinates: [lng, lat] })
  })
}

function dateKeyFromDestDate(date: unknown) {
  if (!date) return ''
  if (date instanceof Date) return date.toISOString().slice(0, 10)
  const m = String(date).match(/^(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? ''
}

function dayMapForDestinations() {
  const dests = tripStore.destinations
    .filter((dest) => dest.planningStatus !== 'unscheduled' && dest.planningStatus !== 'candidate' && dest.planningStatus !== 'rejected')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const dayIndexByKey = new Map<string, number>()
  let autoDay = 0
  const dayById = new Map<string, number>()

  for (const dest of dests) {
    const key = dateKeyFromDestDate(dest.date)
    if (!key) {
      autoDay += 1
      dayById.set(dest.id, autoDay)
      continue
    }
    let idx = dayIndexByKey.get(key)
    if (!idx) {
      idx = dayIndexByKey.size + 1
      dayIndexByKey.set(key, idx)
    }
    dayById.set(dest.id, idx)
  }
  return dayById
}

function offsetDuplicatePoints(points: [number, number][]) {
  const count = new Map<string, number>()
  return points.map(([lng, lat]) => {
    const key = `${lng.toFixed(6)},${lat.toFixed(6)}`
    const idx = count.get(key) ?? 0
    count.set(key, idx + 1)
    if (idx === 0) return [lng, lat] as [number, number]
    const step = 0.00022
    const angle = ((idx - 1) % 6) * (Math.PI / 3)
    const ring = Math.floor((idx - 1) / 6) + 1
    return [lng + Math.cos(angle) * step * ring, lat + Math.sin(angle) * step * ring] as [number, number]
  })
}

function markerContent(
  label: number,
  color: string,
  isSelected: boolean,
  isMuted = false,
  isScheduled = true,
  reservationStatus: Destination['reservationStatus'] = 'none'
) {
  const size = isSelected ? 28 : 24
  const opacity = isMuted ? 0.46 : 1
  const path = isScheduled ? STOP_RING_PATH : PENDING_RING_PATH
  const dash = isScheduled ? '' : 'stroke-dasharray="1 5"'
  const badge = reservationStatus === 'required'
    ? '<span style="position:absolute;top:-9px;right:-12px;border:1.5px dashed #A94732;border-radius:5px;color:#A94732;background:#E7EAEE;padding:1px 3px;font-size:9px;line-height:1.15;transform:rotate(2deg);">约</span>'
    : reservationStatus === 'booked'
      ? '<span style="position:absolute;top:-7px;right:-9px;width:14px;height:14px;border-radius:4px;background:#5E70B2;color:#fff;font-size:10px;line-height:14px;text-align:center;">✓</span>'
      : ''
  const lamp = isSelected ? '<span style="position:absolute;top:3px;left:0;width:7px;height:7px;border-radius:48% 55% 44% 58%;background:#D97546;box-shadow:0 0 0 3px rgba(217,117,70,.17),0 0 7px rgba(217,117,70,.55);" aria-hidden="true"></span>' : ''
  return `<div style="position:relative;width:${size + 12}px;height:${size + 12}px;display:flex;align-items:center;justify-content:center;opacity:${opacity};"><svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">${isScheduled ? `<path d="M7 17 C7 9 15 6 23 7 C32 8 35 16 33 24 C31 33 23 35 16 33 C9 31 6 25 7 17 Z" fill="#E7EAEE"/><path d="M7 17 C7 9 15 6 23 7 C32 8 35 16 33 24 C31 33 23 35 16 33 C9 31 6 25 7 17 Z" fill="${color}" fill-opacity=".3"/>` : ''}<path d="${path}" fill="none" stroke="${color}" stroke-width="${isSelected ? 2.8 : 2.4}" stroke-linecap="round" stroke-linejoin="round" ${dash}/>${isScheduled ? `<text x="20.5" y="25" fill="#202529" font-size="17" font-weight="600" font-family="sans-serif" text-anchor="middle">${label}</text>` : ''}</svg>${badge}${lamp}</div>`
}

function clearMapOverlays() {
  if (!map) return
  cancelAnimationFrame(dayDrawFrame)
  dayDrawFrame = 0
  drawingLines = []
  map.clearMap()
  routeLines = []
  markers = []
  draftMarkers = []
  markerByDestinationId.clear()
}

function drawFocusedDay(lines: Array<{ line: any; path: [number, number][] }>) {
  drawingLines = lines
  const started = performance.now()
  const frame = (now: number) => {
    const progress = Math.min(1, (now - started) / 1100) * lines.length
    lines.forEach(({ line, path }, index) => {
      const part = Math.max(0, Math.min(1, progress - index))
      if (part === 1) {
        line.setPath(path)
        return
      }
      const position = part * (path.length - 1)
      const whole = Math.floor(position)
      const from = path[whole]
      const to = path[Math.min(whole + 1, path.length - 1)]
      line.setPath([...path.slice(0, whole + 1), [
        from[0] + (to[0] - from[0]) * (position - whole),
        from[1] + (to[1] - from[1]) * (position - whole)
      ]])
    })
    if (progress < lines.length) dayDrawFrame = requestAnimationFrame(frame)
    else { dayDrawFrame = 0; drawingLines = [] }
  }
  dayDrawFrame = requestAnimationFrame(frame)
}

function renderMap(keepView = true) {
  if (!map || !window.AMap) return
  clearMapOverlays()

  const allDestinations = [...tripStore.destinations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const destinations = draftPreviewMode ? [] : visibleDay === 'unscheduled'
    ? allDestinations.filter((dest) => dest.planningStatus === 'unscheduled' || dest.planningStatus === 'candidate')
    : allDestinations
  const dayById = dayMapForDestinations()
  const displayCoords = offsetDuplicatePoints(destinations.map((dest) => dest.coordinates))
  const focusedLines: Array<{ line: any; path: [number, number][] }> = []

  for (const segment of visibleDay === 'unscheduled' ? [] : (tripStore.transportSegments || [])) {
    if (segment.status !== 'ready' || !segment.path || segment.path.length < 2) continue
    const isFocusedDay = typeof visibleDay === 'number' && segment.day === visibleDay
    const isMutedDay = typeof visibleDay === 'number' && segment.day !== visibleDay
    const routeLine = new window.AMap.Polyline({
      path: segment.path,
      strokeColor: dayColor(segment.day),
      strokeWeight: isFocusedDay ? 3.4 : isMutedDay ? 2 : 2.8,
      strokeOpacity: isFocusedDay ? 0.96 : isMutedDay ? 0.3 : 0.82,
      strokeStyle: 'dashed',
      strokeDasharray: [3, 7],
      lineJoin: 'round',
      zIndex: isFocusedDay ? 52 : isMutedDay ? 32 : 40
    })
    routeLines.push(routeLine)
    if (isFocusedDay) focusedLines.push({ line: routeLine, path: segment.path })
  }
  const shouldDrawDay = drawDayOnNextRender && routeLineVisible && focusedLines.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (shouldDrawDay) focusedLines.forEach(({ line, path }) => line.setPath([path[0], path[0]]))
  if (routeLines.length) map.add(routeLines)
  if (!routeLineVisible) routeLines.forEach((line) => line.hide())
  if (shouldDrawDay) drawFocusedDay(focusedLines)
  drawDayOnNextRender = false

  markers = destinations.map((dest, index) => {
    const day = (dest as any).day ?? dayById.get(dest.id) ?? dest.order
    const isScheduled = dest.planningStatus !== 'unscheduled' && dest.planningStatus !== 'candidate' && dest.planningStatus !== 'rejected'
    const isFocusedDay = highlightedDay != null && Number(day) === highlightedDay
    const isMuted = highlightedDay != null && Number(day) !== highlightedDay
    const isSelected = dest.id === selectedDestinationId
    const marker = new window.AMap.Marker({
      position: displayCoords[index],
      anchor: 'center',
      content: markerContent(dest.withinDayOrder ?? dest.order ?? index + 1, isScheduled ? dayColor(day) : '#6F7880', isSelected, isMuted, isScheduled, dest.reservationStatus),
      zIndex: isSelected ? 130 : isFocusedDay ? 120 : isMuted ? 62 : 80
    })
    marker.on('click', () => {
      selectedDestinationId = dest.id
      updateMap(true)
      featureClickHandler?.({
        id: dest.id,
        name: dest.name,
        description: dest.description || '',
        date: dest.date ? String(dest.date) : '',
        image: dest.image || '',
        order: dest.withinDayOrder,
        day: Number(day),
        planningStatus: dest.planningStatus,
        reservationStatus: dest.reservationStatus,
        reservationNote: dest.reservationNote,
        placeCategory: dest.placeCategory,
        coordinates: dest.coordinates
      })
    })
    markerByDestinationId.set(dest.id, marker)
    return marker
  })
  if (markers.length) map.add(markers)

  const visibleDraft = visibleDay === 'unscheduled'
    ? draftDestinations.filter((dest) => dest.planningStatus === 'unscheduled' || dest.planningStatus === 'candidate')
    : draftDestinations
  const orderedDraft = [...visibleDraft].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  draftMarkers = orderedDraft.map((dest, index) => {
    const color = dayColor(dest.day ?? 1)
    const isFocusedDay = highlightedDay != null && Number(dest.day) === highlightedDay
    const isMuted = highlightedDay != null && Number(dest.day) !== highlightedDay
    const isSelected = dest.id === selectedDestinationId
    const marker = new window.AMap.Marker({
      position: dest.coordinates,
      anchor: 'center',
      content: markerContent(dest.withinDayOrder ?? index + 1, color, isSelected, isMuted, true, dest.reservationStatus),
      zIndex: isSelected ? 160 : isFocusedDay ? 150 : isMuted ? 105 : 140
    })
    markerByDestinationId.set(dest.id, marker)
    return marker
  })
  if (draftMarkers.length) map.add(draftMarkers)
  if (!keepView) fitBounds()
}

function updateMap(keepView = true) {
  queuedKeepView = queuedKeepView && keepView
  renderRevision += 1
  if (renderQueued) return
  renderQueued = true
  const revision = renderRevision
  queueMicrotask(() => {
    renderQueued = false
    const shouldKeepView = queuedKeepView
    queuedKeepView = true
    try {
      renderMap(shouldKeepView)
    } catch (error) {
      window.setTimeout(() => {
        if (revision !== renderRevision) return
        try {
          renderMap(shouldKeepView)
        } catch (retryError) {
          renderErrorHandler?.(retryError instanceof Error ? retryError : new Error('地图刷新失败'))
        }
      }, 0)
    }
  })
}

function isMapReady() {
  return !!map
}

function onReady(handler: () => void) {
  if (isMapReady()) handler()
  else readyHandlers.push(handler)
}

function withReady(handler: () => void) {
  onReady(handler)
}

watch(
  () => [tripStore.destinations, tripStore.transportSegments],
  () => updateMap(),
  { deep: true }
)

function setHighlightedDay(day: number | null) {
  highlightedDay = day
  updateMap(true)
}

function setVisibleDay(day: number | 'overview' | 'unscheduled', render = true) {
  drawDayOnNextRender = typeof day === 'number' && day !== visibleDay
  visibleDay = day
  highlightedDay = typeof day === 'number' ? day : null
  if (render) updateMap(true)
}

function setSelectedDestination(id: string | null) {
  selectedDestinationId = id
  updateMap(true)
}

function setMapSelecting(selecting: boolean) {
  isSelecting = selecting
  map?.setStatus({ dragEnable: !selecting && panEnabled })
  setMapCursor()
}

function setPanMode(enable: boolean) {
  panEnabled = enable
  map?.setStatus({ dragEnable: enable && !isSelecting })
  setMapCursor()
}

function setMapCursor() {
  if (!mapContainer.value) return
  mapContainer.value.style.cursor = isSelecting ? 'crosshair' : panEnabled ? 'grab' : 'default'
}

function onMapClick(handler: (coords: [number, number]) => void) {
  mapClickHandler = handler
}

function onFeatureClick(handler: (props: FeatureClickPayload) => void) {
  featureClickHandler = handler
}

function onPoiClick(handler: (poi: MapPoiClickPayload) => void) {
  poiClickHandler = handler
}

function onViewChange(handler: (center: [number, number]) => void) {
  viewChangeHandler = handler
  emitViewCenter()
}

function getCenter(): [number, number] | null {
  if (!map) return null
  const center = map.getCenter()
  return [center.lng, center.lat]
}

function getMapCenter(): [number, number] {
  return getCenter() ?? [116.397428, 39.90923]
}

function emitViewCenter() {
  const center = getCenter()
  if (center) viewChangeHandler?.(center)
}

function openPointForm(coordinates: [number, number], props: Partial<FeatureClickPayload> = {}, callback: (data: typeof pointFormData.value) => void) {
  editingPointName.value = false
  editingPointDay.value = false
  pointFormData.value = {
    name: props.name || '',
    description: props.description || '',
    coordinates,
    assignment: props.planningStatus === 'unscheduled' || props.planningStatus === 'candidate' || !props.day ? 'unscheduled' : String(props.day),
    image: props.image || '',
    reservationStatus: props.reservationStatus || 'none',
    reservationNote: props.reservationNote || '',
    placeCategory: props.placeCategory
  }
  pointFormPosition.value = pointFormPositionFor(coordinates)
  pointFormOrder.value = pointFormData.value.assignment === 'unscheduled' ? undefined : props.order
  isEditing.value = !!props.id
  pointFormCallback = callback
  showPointForm.value = true
  emit('pointFormOpen', true)
}

function closePointForm() {
  showPointForm.value = false
  editingPointName.value = false
  editingPointDay.value = false
  emit('pointFormOpen', false)
  pointFormData.value = {
    name: '',
    description: '',
    coordinates: [0, 0],
    assignment: 'unscheduled',
    image: '',
    reservationStatus: 'none',
    reservationNote: '',
    placeCategory: undefined
  }
  isEditing.value = false
  pointFormOrder.value = undefined
  pointFormCallback = null
}

function pointFormPositionFor(coordinates: [number, number]) {
  if (!map || !mapContainer.value || window.innerWidth <= 900) return {}
  const pixel = map.lngLatToContainer(coordinates)
  const rect = mapContainer.value.getBoundingClientRect()
  const width = window.innerWidth
  const height = window.innerHeight
  const x = Math.max(0, Math.min(width, rect.left + pixel.x))
  const y = Math.max(0, Math.min(height, rect.top + pixel.y))
  pointFormOnLeft.value = x + 388 > width
  const left = pointFormOnLeft.value ? Math.max(20, x - 392) : x + 22
  const top = Math.min(Math.max(28, y - 72), Math.max(28, height - 425))
  return { left: `${left}px`, top: `${top}px`, maxHeight: `${height - top - 20}px` }
}

async function startEditingPointName() {
  editingPointName.value = true
  await nextTick()
  pointNameInput.value?.focus()
}

async function startEditingPointDay() {
  editingPointDay.value = true
  await nextTick()
  pointDaySelect.value?.focus()
}

function toggleReservationRequired(event: Event) {
  pointFormData.value.reservationStatus = (event.target as HTMLInputElement).checked ? 'required' : 'none'
  if (pointFormData.value.reservationStatus === 'none') pointFormData.value.reservationNote = ''
}

function savePointForm() {
  if (!pointFormData.value.name.trim()) {
    alert('请输入点名称')
    return
  }
  pointFormCallback?.({ ...pointFormData.value })
  closePointForm()
}

function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过5MB')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (file.size <= 300 * 1024) {
        pointFormData.value.image = dataUrl
        return
      }
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        const context = canvas.getContext('2d')
        if (!context) return
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const compressed = canvas.toDataURL('image/jpeg', 0.72)
        if (compressed.length > 900_000) {
          alert('图片压缩后仍然太大，请选一张更小的照片')
          return
        }
        pointFormData.value.image = compressed
      }
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  }
  input.value = ''
}

function removeImage() {
  pointFormData.value.image = ''
}

function zoomIn() {
  map?.zoomIn()
}

function zoomOut() {
  map?.zoomOut()
}

function amapPadding(padding?: FitBoundsOptions['padding']) {
  if (!padding) return [50, 50, 50, 50]
  if (typeof padding === 'number') return [padding, padding, padding, padding]
  return [padding.top, padding.right, padding.bottom, padding.left]
}

function fitBounds(options: FitBoundsOptions = {}) {
  const selectedDestinations = options.destinations
  if (!map || (selectedDestinations ? selectedDestinations.length === 0 : tripStore.destinations.length === 0 && draftDestinations.length === 0)) return
  withReady(() => {
    const allDestinations = selectedDestinations || [...tripStore.destinations, ...draftDestinations]
    if (allDestinations.length === 1) {
      const [lng, lat] = allDestinations[0].coordinates
      flyToLocation(lng, lat, { zoom: 12, offset: options.offset })
      return
    }
    const overlays = selectedDestinations
      ? selectedDestinations.map((destination) => markerByDestinationId.get(destination.id)).filter(Boolean)
      : [...markers, ...draftMarkers]
    if (overlays.length) map.setFitView(overlays, false, amapPadding(options.padding), 15)
  })
}

function flyToLocation(lng: number, lat: number, options?: { offset?: [number, number]; zoom?: number; speed?: number }) {
  withReady(() => {
    map?.setZoomAndCenter(options?.zoom ?? Math.max(map.getZoom(), 13), [lng, lat], options?.speed === 0, options?.speed ?? 500)
    if (options?.offset) {
      window.setTimeout(() => map?.panBy(options.offset?.[0] ?? 0, options.offset?.[1] ?? 0), 520)
    }
  })
}

function updateSize() {
  map?.resize()
}

function setRouteLineVisible(visible: boolean) {
  routeLineVisible = visible
  if (!visible && dayDrawFrame) {
    cancelAnimationFrame(dayDrawFrame)
    dayDrawFrame = 0
    drawingLines.forEach(({ line, path }) => line.setPath(path))
    drawingLines = []
  }
  routeLines.forEach((line) => visible ? line.show() : line.hide())
}

function setDraftDestinations(destinations: Destination[]) {
  draftDestinations = destinations
  updateMap(true)
}

function setDraftPreviewMode(enabled: boolean) {
  draftPreviewMode = enabled
  updateMap(true)
}

function onRenderError(handler: (error: Error) => void) {
  renderErrorHandler = handler
}

defineExpose({
  updateMap,
  setMapSelecting,
  onMapClick,
  onFeatureClick,
  onPoiClick,
  onViewChange,
  getCenter,
  getMapCenter,
  isMapReady,
  onReady,
  setHighlightedDay,
  setVisibleDay,
  setSelectedDestination,
  onRenderError,
  setRouteLineVisible,
  setDraftDestinations,
  setDraftPreviewMode,
  openPointForm,
  setPanMode,
  zoomIn,
  zoomOut,
  fitBounds,
  flyToLocation,
  updateSize
})
</script>

<style scoped>
.map {
  width: 100%;
  height: 100%;
  min-height: 400px;
  position: relative;
}

.point-form-overlay {
  position: fixed;
  inset: 0;
  background: transparent;
  padding: 0;
  pointer-events: none;
  z-index: 1000;
  box-sizing: border-box;
}

.point-form-container {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: rgba(239, 241, 244, .97);
  border: 1px solid rgba(32, 37, 41, .22);
  border-radius: 16px 19px 16px 17px;
  box-shadow: 0 8px 24px rgba(29, 34, 38, 0.16);
  width: min(370px, calc(100% - 40px));
  max-height: calc(100% - 40px);
  pointer-events: auto;
  transform: rotate(-.25deg);
}

.point-form-container::before {
  position: absolute;
  top: 70px;
  left: -13px;
  width: 24px;
  height: 24px;
  border-width: 0 0 1px 1px;
  border-style: solid;
  border-color: rgba(32, 37, 41, .22);
  background: rgba(239, 241, 244, .97);
  content: '';
  transform: rotate(45deg);
}
.point-form-container.on-left::before { right: -13px; left: auto; border-width: 1px 1px 0 0; }

.point-form-header {
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px 10px;
  border-bottom: 1px solid rgba(29, 34, 38, 0.16);
}

.point-form-header h3 {
  margin: 0;
  font-size: 16px;
  color: #1d2226;
}
.point-form-heading { min-width: 0; flex: 1; }
.point-category-icon { width: 23px; height: 23px; flex: 0 0 auto; color: #405875; }
.point-heading-button, .point-form-subtitle button { padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--cross-ink); font: inherit; }
.point-heading-button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 650; }
.point-heading-input { width: min(100%, 260px); padding: 0; border: 0; border-bottom: 1px solid #6575ac; background: transparent; color: var(--cross-ink); font: inherit; font-size: 16px; font-weight: 650; outline: none; }
.point-form-subtitle { display: flex; align-items: center; gap: 4px; margin-top: 3px; color: var(--cross-ink-soft); font-size: 11px; }
.point-form-subtitle button { color: inherit; text-decoration: underline dotted; text-underline-offset: 3px; }
.point-form-subtitle select { max-width: 120px; border: 0; border-bottom: 1px solid #6575ac; background: transparent; color: var(--cross-ink); font: inherit; }

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: rgba(29, 34, 38, 0.46);
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: #5b6b73;
}

.point-form-content {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 18px 0;
  overflow-y: auto;
}

.form-item {
  margin-bottom: 9px;
}

.form-item label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #1d2226;
  font-size: 14px;
}

.form-item input,
.form-item select,
.form-item textarea {
  width: 100%;
  padding: 8px 2px;
  border: 0;
  border-bottom: 1px solid rgba(29, 34, 38, 0.28);
  background: transparent;
  border-radius: 0;
  font-size: 14px;
  box-sizing: border-box;
  outline: none;
}
.form-item input:focus, .form-item textarea:focus { border-bottom-color: #6575ac; }

.reservation-section { padding-top: 2px; }
.reservation-switch { display: flex !important; min-height: 34px; align-items: center; gap: 10px; }
.reservation-switch > span { margin-right: auto; color: var(--cross-ink-soft); font-weight: 500; }
.reservation-switch input { position: absolute; opacity: 0; pointer-events: none; }
.reservation-switch i { position: relative; width: 38px; height: 21px; flex: 0 0 auto; border: 1px solid rgba(32, 37, 41, .35); border-radius: 11px 9px 11px 10px; background: rgba(48, 56, 61, .08); cursor: pointer; }
.reservation-switch i::after { position: absolute; top: 3px; left: 4px; width: 13px; height: 13px; border-radius: 52% 45% 56% 47%; background: #7c8790; content: ''; transition: transform .16s ease, background-color .16s ease; }
.reservation-switch input:checked + i { border-color: #6575ac; background: rgba(101, 117, 172, .16); }
.reservation-switch input:checked + i::after { background: #6575ac; transform: translateX(16px); }
.reservation-switch strong { color: var(--cross-ink); font-size: 13px; font-weight: 570; }
.reservation-options { display: flex; gap: 10px; margin: 5px 0 0 62px; }
.reservation-options button { min-height: 34px; border: 1px solid rgba(32, 37, 41, .26); border-radius: 14px 10px 14px 11px; background: transparent; color: var(--cross-ink-soft); padding: 5px 12px; font: inherit; font-size: 12px; cursor: pointer; }
.reservation-options button:first-child.active { border-color: #a94732; border-style: dashed; color: #a94732; }
.reservation-options button:last-child.active { border-color: #6575ac; background: rgba(101, 117, 172, .12); color: #4d609d; }
.reservation-disclaimer { margin: 3px 0 0; color: rgba(72, 82, 91, .66); font-size: 11px; }

.image-upload-container {
  margin-top: 5px;
}

.image-preview-small {
  width: 78px;
  height: 66px;
  border: 1px solid rgba(29, 34, 38, 0.14);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  margin: 4px 0 12px;
  transform: rotate(1deg);
}

.preview-img-small {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-img-btn {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-upload-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.image-upload-action { display: flex !important; align-items: center; gap: 12px; width: fit-content; margin: 0 !important; color: rgba(32, 37, 41, .64); cursor: pointer; }
.image-upload-action svg { width: 66px; height: 58px; padding: 14px; box-sizing: border-box; border: 1px dashed rgba(32, 37, 41, .34); border-radius: 6px; }
.image-upload-action strong { font-size: 12px; font-weight: 500; }

.form-item textarea {
  min-height: 48px;
  resize: vertical;
}
.place-category-row { display: flex; align-items: center; gap: 12px; }
.place-category-row label { min-width: 86px; margin: 0; }
.place-category-row label small { color: var(--cross-ink-soft); font-size: 10px; font-weight: 400; }
.place-category-row select { flex: 1; min-width: 0; }

.point-form-footer {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 18px 12px;
  background: transparent;
}

.cancel-btn,
.save-btn {
  padding: 6px 12px;
  border-radius: 3px 10px 4px 8px;
  font-size: 13px;
  cursor: pointer;
  border: none;
}

.cancel-btn {
  background: transparent;
  color: #5b6b73;
}

.cancel-btn:hover {
  background-color: #e2e5e4;
}

.save-btn {
  border: 1.5px solid #5b6b73;
  background: transparent;
  color: #30383d;
}

.save-btn:hover {
  background: rgba(91, 107, 115, .08);
}

@media (max-width: 900px) {
  .point-form-overlay { display: flex; align-items: flex-end; bottom: 64px; padding: 0; }
  .point-form-container { position: relative; top: auto !important; left: auto !important; width: 100%; max-height: 78dvh !important; border-width: 1px 0 0; border-radius: 18px 18px 0 0; transform: none; }
  .point-form-container::before { display: none; }
  .point-form-content { overflow-y: auto; }
  .point-form-footer button { min-height: 44px; }
  .reservation-options button { min-height: 44px; }
}
</style>
