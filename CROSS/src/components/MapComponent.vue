<template>
  <div id="map" ref="mapContainer" class="map">
    <div v-if="showPointForm" class="point-form-overlay" @click.self="closePointForm">
      <div class="point-form-container">
        <div class="point-form-header">
          <h3>{{ isEditing ? '编辑点信息' : '添加点信息' }}</h3>
          <button class="close-btn" @click="closePointForm">x</button>
        </div>
        <div class="point-form-content">
          <div class="form-item">
            <label>点名称:</label>
            <input v-model="pointFormData.name" type="text" placeholder="请输入点名称" required>
          </div>
          <div class="form-item">
            <label>描述:</label>
            <textarea v-model="pointFormData.description" placeholder="请输入描述(可选)"></textarea>
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
              <input
                type="file"
                accept="image/*"
                @change="handleImageUpload"
                class="image-upload-input"
              >
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
import maplibregl, { LngLatBounds } from 'maplibre-gl'
import { useTripStore } from '@/store/trip'

type DestinationFeatureProperties = {
  id: string
  name: string
  description?: string
  date?: string
  image?: string
  order?: number
  day?: number
  withinDayOrder?: number
  label?: number
  color?: string
  origLng?: number
  origLat?: number
}

type FeatureClickPayload = DestinationFeatureProperties & {
  coordinates: [number, number]
}

const tripStore = useTripStore()
const maptilerKey = import.meta.env.VITE_MAPTILER_KEY
const mapContainer = ref<HTMLDivElement | null>(null)

const SOURCE_ID = 'trip-source'
const POINT_LAYER_ID = 'trip-points'
const POINT_SHADOW_LAYER_ID = 'trip-points-shadow'
const LABEL_LAYER_ID = 'trip-point-labels'
const LINE_LAYER_ID = 'trip-route'
const HIGHLIGHT_LAYER_ID = 'trip-points-highlight'

let map: maplibregl.Map | null = null
let mapClickHandler: ((coords: [number, number]) => void) | null = null
let featureClickHandler: ((props: FeatureClickPayload) => void) | null = null
let viewChangeHandler: ((center: [number, number]) => void) | null = null
let readyHandlers: Array<() => void> = []
let isSelecting = false
let panEnabled = false
let pendingUpdate = false
let highlightedDay: number | null = null

// 萌萌马卡龙（柔和、低冲突）配色
const MORANDI_PALETTE = [
  // 参考你给的“常用图表示例”配色条
  '#8A8798', // 山灰紫
  '#5B6B73', // 湖蓝灰
  '#A9B9C1', // 雾蓝
  '#5F7267', // 苔绿
  '#9BAF94', // 淡苔绿
  '#D4DFD0', // 浅苔绿
  '#E7DCC5', // 淡杏黄
  '#E3CDD0', // 淡粉
  '#C8A29A', // 柔陶土
  '#A14B3C'  // 砖红
]

function safeOrderIndexExpr() {
  // 统一把 order 转成 number，缺失则按 1
  // index = (order - 1) mod paletteLength
  return [
    'mod',
    ['-', ['coalesce', ['to-number', ['get', 'order']], 1], 1],
    MORANDI_PALETTE.length
  ] as any
}

const circleColorExpr = [
  'match',
  safeOrderIndexExpr(),
  0, MORANDI_PALETTE[0],
  1, MORANDI_PALETTE[1],
  2, MORANDI_PALETTE[2],
  3, MORANDI_PALETTE[3],
  4, MORANDI_PALETTE[4],
  5, MORANDI_PALETTE[5],
  6, MORANDI_PALETTE[6],
  7, MORANDI_PALETTE[7],
  8, MORANDI_PALETTE[8],
  9, MORANDI_PALETTE[9],
  '#999999'
] as any

function colorForOrder(order: unknown) {
  const d = Number(order)
  const day = Number.isFinite(d) && d > 0 ? d : 1
  return MORANDI_PALETTE[(day - 1) % MORANDI_PALETTE.length]
}

function dateKeyFromDestDate(date: unknown) {
  if (!date) return ''
  if (date instanceof Date) return date.toISOString().slice(0, 10)
  const s = String(date)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? ''
}

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
  setTimeout(() => {
    initMap()
  }, 100)
})

onBeforeUnmount(() => {
  if (map) {
    map.remove()
    map = null
  }
})

function initMap() {
  if (!mapContainer.value) return

  const style = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(maptilerKey)}`
    : {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ]
      }

  map = new maplibregl.Map({
    container: mapContainer.value,
    style,
    center: [114.057868, 22.543099],
    zoom: 5,
    attributionControl: true
  })

  map.on('load', () => {
    ensureTripLayers()
    updateMap()
    setMapCursor()
    emitViewCenter()
    // 通知外部：地图已就绪（例如页面需要在进入路线时自动展示点/路线）
    const handlers = readyHandlers
    readyHandlers = []
    handlers.forEach((fn) => fn())
  })

  map.on('moveend', () => {
    emitViewCenter()
  })

  map.on('click', (event) => {
    if (isSelecting && mapClickHandler) {
      mapClickHandler([event.lngLat.lng, event.lngLat.lat])
      return
    }

    if (!featureClickHandler || isSelecting || !map) return

    const features = map.queryRenderedFeatures(event.point, { layers: [POINT_LAYER_ID] })
    const feature = features[0]
    if (!feature || feature.geometry.type !== 'Point') return

    const coords = feature.geometry.coordinates as [number, number]
    const props = feature.properties || {}
    const origLng =
      props.origLng !== undefined && props.origLng !== null ? Number(props.origLng) : coords[0]
    const origLat =
      props.origLat !== undefined && props.origLat !== null ? Number(props.origLat) : coords[1]
    featureClickHandler({
      id: String(props.id || ''),
      name: String(props.name || ''),
      description: props.description ? String(props.description) : '',
      date: props.date ? String(props.date) : '',
      image: props.image ? String(props.image) : '',
      order: props.order ? Number(props.order) : undefined,
      coordinates: [origLng, origLat]
    })
  })
}

function ensureTripLayers() {
  if (!map || map.getSource(SOURCE_ID)) return

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: emptyFeatureCollection()
  })

  map.addLayer({
    id: LINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    },
    paint: {
      'line-color': '#666666',
      'line-width': 3,
      // 虚线：更轻盈的路线视觉
      'line-dasharray': [1.6, 1.2]
    }
  })

  // 点位阴影层：提升对比度与“萌感”
  map.addLayer({
    id: POINT_SHADOW_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 20, 14, 26],
      'circle-color': '#000000',
      'circle-opacity': 0.16,
      'circle-blur': 0.9,
      'circle-translate': [2, 2]
    }
  })

  map.addLayer({
    id: POINT_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      // 随缩放自动变大，避免“看不见点”
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 16, 14, 22],
      'circle-opacity': 0.95,
      // 按 day/order 分色（莫兰迪色系），超出调色板长度则循环
      'circle-color': ['coalesce', ['get', 'color'], '#FF9AA2'],
      // 不要白色边框：靠阴影层增强可见性
      'circle-stroke-width': 0
    }
  })

  // 高亮层：点击 Day 图例后，仅显示该 day 的更大圆
  map.addLayer({
    id: HIGHLIGHT_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'order'], -9999]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 16, 10, 24, 14, 30],
      'circle-opacity': 1,
      'circle-color': ['coalesce', ['get', 'color'], '#FF9AA2'],
      // 高亮也不加白边，避免“很丑”
      'circle-stroke-width': 0
    }
  })

  map.addLayer({
    id: LABEL_LAYER_ID,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['to-string', ['get', 'label']],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 13, 10, 16, 14, 18]
    },
    paint: {
      // 数字用灰色，周围靠彩色圆点承载“日期颜色”
      'text-color': '#333333',
      // 不要白框：改成轻微深色描边增强可读性
      'text-halo-color': 'rgba(0,0,0,0.22)',
      'text-halo-width': 0.9
    }
  })
}

function setHighlightedDay(day: number | null) {
  highlightedDay = day
  if (!map) return
  withReady(() => {
    if (!map) return
    const value = highlightedDay == null ? -9999 : highlightedDay
    map.setFilter(HIGHLIGHT_LAYER_ID, [
      'all',
      ['==', ['geometry-type'], 'Point'],
      ['==', ['coalesce', ['to-number', ['get', 'day']], -9999], value]
    ] as any)
  })
}

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection' as const,
    features: []
  }
}

function buildFeatureCollection() {
  const destinations = [...tripStore.destinations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  // 以日期分组生成 day：同一天同色；未设置日期则按顺序分配不同 day
  const dayIndexByKey = new Map<string, number>()
  let autoDay = 0
  const dayById = new Map<string, number>()
  for (const dest of destinations) {
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
  // 同坐标点位做轻微“散开”，避免完全重叠看起来像少了点
  const sameCoordCount = new Map<string, number>()
  const pointFeatures = destinations.map((dest) => {
    const [origLng, origLat] = dest.coordinates
    const key = `${origLng.toFixed(6)},${origLat.toFixed(6)}`
    const idx = sameCoordCount.get(key) ?? 0
    sameCoordCount.set(key, idx + 1)
    // 约 15~30m 的偏移（足够区分，又不会离谱）
    const step = 0.00022
    const angle = (idx % 6) * (Math.PI / 3)
    const ring = Math.floor(idx / 6) + 1
    const dlng = Math.cos(angle) * step * ring
    const dlat = Math.sin(angle) * step * ring
    const lng = origLng + dlng
    const lat = origLat + dlat
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [lng, lat]
      },
      properties: {
        id: dest.id,
        name: dest.name,
        description: dest.description || '',
        date: dest.date || '',
        image: dest.image || '',
        order: dest.order,
        day: (dest as any).day ?? dayById.get(dest.id) ?? dest.order,
        withinDayOrder: (dest as any).withinDayOrder,
        // 点内数字与左侧列表保持一致：使用全局序号（不按天重置）
        label: dest.order,
        color: colorForOrder((dest as any).day ?? dayById.get(dest.id) ?? dest.order),
        origLng,
        origLat
      }
    }
  })

  const lineFeature =
    destinations.length > 1
      ? [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: destinations.map((dest) => dest.coordinates)
          },
          properties: {}
        }]
      : []

  return {
    type: 'FeatureCollection' as const,
    features: [...pointFeatures, ...lineFeature]
  }
}

function updateMap(keepView = true) {
  if (!map) return
  if (!map.isStyleLoaded()) {
    pendingUpdate = true
    return
  }

  ensureTripLayers()

  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (!source) return

  const data = buildFeatureCollection()
  source.setData(data)
  pendingUpdate = false

  if (!keepView) {
    fitBounds()
  }
}

function isMapReady() {
  return !!(map && map.isStyleLoaded())
}

function onReady(handler: () => void) {
  if (isMapReady()) {
    handler()
    return
  }
  readyHandlers.push(handler)
}

function withReady(handler: () => void) {
  onReady(() => {
    // 地图刚 ready 时，补一次之前被丢弃的 setData
    if (pendingUpdate) {
      updateMap(true)
    }
    handler()
  })
}

watch(
  () => tripStore.destinations,
  () => {
    updateMap()
  },
  { deep: true }
)

function setMapSelecting(selecting: boolean) {
  isSelecting = selecting
  if (!map) return
  map.dragPan[selecting ? 'disable' : (panEnabled ? 'enable' : 'disable')]?.()
  setMapCursor()
}

function setPanMode(enable: boolean) {
  panEnabled = enable
  if (!map) return

  if (enable && !isSelecting) {
    map.dragPan.enable()
  } else if (!enable && !isSelecting) {
    map.dragPan.disable()
  }

  setMapCursor()
}

function setMapCursor() {
  if (!map) return
  const canvas = map.getCanvas()
  if (isSelecting) {
    canvas.style.cursor = 'crosshair'
  } else if (panEnabled) {
    canvas.style.cursor = 'grab'
  } else {
    canvas.style.cursor = 'default'
  }
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
  return center ? [center.lng, center.lat] : null
}

/** 供 POI 搜索等使用：始终返回 [经度, 纬度]（地图未就绪时默认北京） */
function getMapCenter(): [number, number] {
  if (!map) return [116.39, 39.9]
  const c = map.getCenter()
  return [c.lng, c.lat]
}

function emitViewCenter() {
  if (!viewChangeHandler) return
  const center = getCenter()
  if (center) {
    viewChangeHandler(center)
  }
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

  if (pointFormCallback) {
    pointFormCallback({ ...pointFormData.value })
  }
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
  if (map) {
    map.zoomIn()
  }
}

function zoomOut() {
  if (map) {
    map.zoomOut()
  }
}

type FitBoundsOptions = {
  padding?: number | { top: number; right: number; bottom: number; left: number }
  duration?: number
  /** 单点场景的像素偏移（用于避开侧边栏遮挡） */
  offset?: [number, number]
}

function fitBoundsInternal(options: FitBoundsOptions = {}) {
  if (!map || tripStore.destinations.length === 0) return
  map.resize()

  const bounds = new LngLatBounds()
  tripStore.destinations.forEach((dest) => {
    bounds.extend(dest.coordinates)
  })

  if (tripStore.destinations.length === 1) {
    const padding = options.padding ?? 50
    const leftPad = typeof padding === 'number' ? padding : padding.left
    const rightPad = typeof padding === 'number' ? padding : padding.right
    const offsetX = options.offset?.[0] ?? Math.round((leftPad - rightPad) / 2)
    map.easeTo({
      center: tripStore.destinations[0].coordinates,
      zoom: Math.max(map.getZoom(), 10),
      offset: [offsetX, options.offset?.[1] ?? 0],
      duration: 800
    })
    return
  }

  map.fitBounds(bounds, {
    padding: options.padding ?? 50,
    duration: options.duration ?? 1000,
    offset: options.offset
  })
}

function fitBounds(options: FitBoundsOptions = {}) {
  if (tripStore.destinations.length === 0) return
  withReady(() => fitBoundsInternal(options))
}

function flyToLocation(
  lng: number,
  lat: number,
  options?: { offset?: [number, number]; zoom?: number; speed?: number }
) {
  withReady(() => {
    if (!map) return
    map.flyTo({
      center: [lng, lat],
      zoom: options?.zoom ?? Math.max(map.getZoom(), 14),
      speed: options?.speed ?? 1.2,
      offset: options?.offset,
      essential: true
    })
  })
}

function updateSize() {
  if (map) {
    map.resize()
  }
}

function setRouteLineVisible(visible: boolean) {
  withReady(() => {
    if (!map) return
    ensureTripLayers()
    map.setLayoutProperty(LINE_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  })
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
  setRouteLineVisible,
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
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.point-form-container {
  background: #dcdfde;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
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
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: #666;
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
  color: #333;
  font-size: 14px;
}

.form-item input,
.form-item textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d0d0d0;
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
  border: 1px solid #ddd;
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
  color: #666;
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
  transition: all 0.3s;
}

.cancel-btn {
  background-color: #dcdfde;
  color: #666;
  border: 1px solid #d0d0d0;
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
