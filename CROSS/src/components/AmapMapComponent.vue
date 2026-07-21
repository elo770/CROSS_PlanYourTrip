<template>
  <div ref="mapContainer" class="map">
    <div v-if="showPointForm" class="point-form-overlay" @click.self="closePointForm">
      <div class="point-form-container">
        <div class="point-form-header">
          <h3>{{ isEditing ? '编辑点信息' : '添加点信息' }}</h3>
          <button class="close-btn" @click="closePointForm">x</button>
        </div>
        <div class="point-form-content">
          <div class="form-item">
            <label>点名称</label>
            <input v-model="pointFormData.name" type="text" placeholder="请输入点名称" required>
          </div>
          <div class="form-item">
            <label>描述:</label>
            <textarea v-model="pointFormData.description" placeholder="请输入描述，可选"></textarea>
          </div>
          <div class="form-item">
            <label>日期:</label>
            <input v-model="pointFormData.date" type="date" placeholder="选择日期">
          </div>
          <div class="form-item">
            <label>图片:</label>
            <div class="image-upload-container">
              <div v-if="pointFormData.image" class="image-preview-small">
                <img :src="pointFormData.image" alt="预览图片" class="preview-img-small" />
                <button class="remove-img-btn" @click.stop="removeImage">x</button>
              </div>
              <input type="file" accept="image/*" @change="handleImageUpload" class="image-upload-input">
              <div class="upload-tip-small">点击上传图片(可选)</div>
            </div>
          </div>
        </div>
        <div class="point-form-footer">
          <button class="cancel-btn" @click="closePointForm">取消</button>
          <button class="save-btn" @click="savePointForm">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTripStore } from '@/store/trip'
import type { Destination } from '@/types'
import { dayColor } from '@/lib/dayPalette'

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
  coordinates: [number, number]
}

type FitBoundsOptions = {
  padding?: number | { top: number; right: number; bottom: number; left: number }
  duration?: number
  offset?: [number, number]
  destinations?: Destination[]
}

const tripStore = useTripStore()
const amapKey = import.meta.env.VITE_AMAP_KEY
const mapContainer = ref<HTMLDivElement | null>(null)

let map: any = null
let routeLines: any[] = []
let draftRouteLines: any[] = []
let markers: any[] = []
let draftMarkers: any[] = []
let mapClickHandler: ((coords: [number, number]) => void) | null = null
let featureClickHandler: ((props: FeatureClickPayload) => void) | null = null
let viewChangeHandler: ((center: [number, number]) => void) | null = null
let readyHandlers: Array<() => void> = []
let isSelecting = false
let panEnabled = true
let highlightedDay: number | null = null
let visibleDay: number | 'overview' | 'unscheduled' = 'overview'
let routeLineVisible = true
let draftDestinations: Destination[] = []
let draftPreviewMode = false
let renderQueued = false
let queuedKeepView = true
let renderRevision = 0
let renderErrorHandler: ((error: Error) => void) | null = null

const showPointForm = ref(false)
const isEditing = ref(false)
const pointFormData = ref({
  name: '',
  description: '',
  coordinates: [0, 0] as [number, number],
  date: new Date().toISOString().split('T')[0],
  image: ''
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
  map.on('moveend', emitViewCenter)
  map.on('click', (event: any) => {
    if (isSelecting && mapClickHandler) {
      mapClickHandler([event.lnglat.lng, event.lnglat.lat])
    }
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

function groupPlacesByDay(places: Destination[], dayById = new Map<string, number>()) {
  const groups = new Map<number, Destination[]>()
  for (const place of places) {
    const day = Number(place.day ?? dayById.get(place.id) ?? 1)
    const items = groups.get(day) || []
    items.push(place)
    groups.set(day, items)
  }
  return Array.from(groups.entries()).map(([day, items]) => ({
    day,
    places: items.sort((a, b) => (a.withinDayOrder ?? a.order ?? 0) - (b.withinDayOrder ?? b.order ?? 0))
  }))
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

function markerContent(label: number, color: string, isHighlighted: boolean) {
  const size = isHighlighted ? 28 : 24
  const shadow = isHighlighted
    ? '0 2px 7px rgba(32,37,41,.24)'
    : '0 1px 4px rgba(32,37,41,.18)'
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#F3EFE7;font-weight:600;font-size:11px;box-shadow:${shadow};">${label}</div>`
}

function clearMapOverlays() {
  if (!map) return
  map.clearMap()
  routeLines = []
  draftRouteLines = []
  markers = []
  draftMarkers = []
}

function renderMap(keepView = true) {
  if (!map || !window.AMap) return
  clearMapOverlays()

  const allDestinations = [...tripStore.destinations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const destinations = draftPreviewMode ? [] : visibleDay === 'overview'
    ? allDestinations
    : visibleDay === 'unscheduled'
      ? allDestinations.filter((dest) => dest.planningStatus === 'unscheduled' || dest.planningStatus === 'candidate')
      : allDestinations.filter((dest) => Number(dest.day) === visibleDay)
  const scheduledDestinations = destinations.filter(
    (dest) => dest.planningStatus !== 'unscheduled' && dest.planningStatus !== 'candidate' && dest.planningStatus !== 'rejected'
  )
  const dayById = dayMapForDestinations()
  const displayCoords = offsetDuplicatePoints(destinations.map((dest) => dest.coordinates))

  for (const group of groupPlacesByDay(scheduledDestinations, dayById)) {
    if (group.places.length < 2) continue
    const routeLine = new window.AMap.Polyline({
      path: group.places.map((dest) => dest.coordinates),
      strokeColor: dayColor(group.day),
      strokeWeight: 2,
      strokeOpacity: 0.48,
      strokeStyle: 'dashed',
      strokeDasharray: [3, 8],
      lineJoin: 'round',
      zIndex: 40
    })
    routeLines.push(routeLine)
  }
  if (routeLines.length) map.add(routeLines)
  if (!routeLineVisible) routeLines.forEach((line) => line.hide())

  markers = destinations.map((dest, index) => {
    const day = (dest as any).day ?? dayById.get(dest.id) ?? dest.order
    const isScheduled = dest.planningStatus !== 'unscheduled' && dest.planningStatus !== 'candidate' && dest.planningStatus !== 'rejected'
    const isHighlighted = highlightedDay != null && Number(day) === highlightedDay
    const marker = new window.AMap.Marker({
      position: displayCoords[index],
      anchor: 'center',
      content: markerContent(dest.withinDayOrder ?? dest.order ?? index + 1, isScheduled ? dayColor(day) : '#30383D', isHighlighted),
      zIndex: isHighlighted ? 120 : 80
    })
    marker.on('click', () => {
      featureClickHandler?.({
        id: dest.id,
        name: dest.name,
        description: dest.description || '',
        date: dest.date ? String(dest.date) : '',
        image: dest.image || '',
        order: dest.order,
        day: Number(day),
        coordinates: dest.coordinates
      })
    })
    return marker
  })
  if (markers.length) map.add(markers)

  const visibleDraft = visibleDay === 'overview'
    ? draftDestinations
    : visibleDay === 'unscheduled'
      ? draftDestinations.filter((dest) => dest.planningStatus === 'unscheduled' || dest.planningStatus === 'candidate')
      : draftDestinations.filter((dest) => Number(dest.day) === visibleDay)
  const orderedDraft = [...visibleDraft].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const group of groupPlacesByDay(orderedDraft)) {
    if (group.places.length < 2) continue
    const draftRouteLine = new window.AMap.Polyline({
      path: group.places.map((dest) => dest.coordinates),
      strokeColor: dayColor(group.day),
      strokeWeight: 2,
      strokeOpacity: 0.42,
      strokeStyle: 'dashed',
      strokeDasharray: [3, 8],
      lineJoin: 'round',
      zIndex: 60
    })
    draftRouteLines.push(draftRouteLine)
  }
  if (draftRouteLines.length) map.add(draftRouteLines)
  draftMarkers = orderedDraft.map((dest, index) => {
    const color = dayColor(dest.day ?? 1)
    return new window.AMap.Marker({
      position: dest.coordinates,
      anchor: 'center',
      content: `<div style="width:24px;height:24px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#F3EFE7;font-weight:600;font-size:11px;box-shadow:0 1px 4px rgba(29,34,38,.14);">${dest.withinDayOrder ?? index + 1}</div>`,
      zIndex: 140
    })
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
  () => tripStore.destinations,
  () => updateMap(),
  { deep: true }
)

function setHighlightedDay(day: number | null) {
  highlightedDay = day
  updateMap(true)
}

function setVisibleDay(day: number | 'overview' | 'unscheduled', render = true) {
  visibleDay = day
  highlightedDay = typeof day === 'number' ? day : null
  if (render) updateMap(true)
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
  pointFormData.value = {
    name: props.name || '',
    description: props.description || '',
    coordinates,
    date: props.date ? new Date(props.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    image: props.image || ''
  }
  isEditing.value = !!props.id
  pointFormCallback = callback
  showPointForm.value = true
}

function closePointForm() {
  showPointForm.value = false
  pointFormData.value = {
    name: '',
    description: '',
    coordinates: [0, 0],
    date: new Date().toISOString().split('T')[0],
    image: ''
  }
  isEditing.value = false
  pointFormCallback = null
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
      pointFormData.value.image = e.target?.result as string
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
    const overlays = selectedDestinations ? markers : [...markers, ...draftMarkers]
    if (overlays.length) map.setFitView(overlays, false, amapPadding(options.padding), 15)
  })
}

function flyToLocation(lng: number, lat: number, options?: { offset?: [number, number]; zoom?: number; speed?: number }) {
  withReady(() => {
    map?.setZoomAndCenter(options?.zoom ?? Math.max(map.getZoom(), 13), [lng, lat], false, 500)
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
  onViewChange,
  getCenter,
  getMapCenter,
  isMapReady,
  onReady,
  setHighlightedDay,
  setVisibleDay,
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
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.point-form-container {
  background: #dcdfde;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(29, 34, 38, 0.2);
  width: 80%;
  max-width: 320px;
  overflow: hidden;
}

.point-form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid rgba(29, 34, 38, 0.16);
}

.point-form-header h3 {
  margin: 0;
  font-size: 16px;
  color: #1d2226;
}

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
  padding: 12px;
}

.form-item {
  margin-bottom: 12px;
}

.form-item label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #1d2226;
  font-size: 14px;
}

.form-item input,
.form-item textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid rgba(29, 34, 38, 0.18);
  background: #e2e5e4;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-item input[type="date"] {
  height: 36px;
}

.image-upload-container {
  margin-top: 5px;
}

.image-preview-small {
  width: 150px;
  height: 100px;
  border: 1px solid rgba(29, 34, 38, 0.14);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  margin-bottom: 10px;
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
  margin-bottom: 5px;
}

.upload-tip-small {
  font-size: 12px;
  color: #5b6b73;
}

.form-item textarea {
  min-height: 80px;
  resize: vertical;
}

.point-form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(29, 34, 38, 0.16);
  background-color: #cfd5d6;
}

.cancel-btn,
.save-btn {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: none;
}

.cancel-btn {
  background-color: #dcdfde;
  color: #5b6b73;
  border: 1px solid rgba(29, 34, 38, 0.18);
}

.cancel-btn:hover {
  background-color: #e2e5e4;
}

.save-btn {
  background-color: #5b6b73;
  color: white;
}

.save-btn:hover {
  background-color: #6b7d86;
}
</style>
