<template>
  <div class="poi-search">
    <div class="search-input-container">
      <input
        v-model="searchQuery"
        @input="handleInput"
        @keyup.enter="searchPOI()"
        placeholder="查找地点"
        type="text"
        class="search-input"
      />
      <button
        @click="searchPOI()"
        class="search-button"
        :disabled="!searchQuery.trim() || isSearching"
      >
        <span v-if="isSearching" class="loading-icon">...</span>
        <span v-else>搜索</span>
      </button>
    </div>

    <div v-if="showDropdown" class="search-dropdown">
      <div v-if="isSearching" class="search-loading">搜索中...</div>
      <div v-else-if="errorMessage" class="search-error">{{ errorMessage }}</div>
      <div v-else-if="searchResults.length === 0" class="search-empty">未找到相关地点</div>
      <div
        v-else
        v-for="(result, index) in searchResults"
        :key="`${result.name}-${result.coordinates[0]}-${result.coordinates[1]}-${index}`"
        class="search-result-item"
        @click="selectPOI(result)"
      >
        <div class="poi-name">{{ result.name }}</div>
        <div class="poi-address">{{ result.address }}</div>
        <div class="poi-meta">
          <span class="poi-engine">{{ result.sourceLabel }}</span>
          <span class="poi-coordinates">
            {{ result.coordinates[0].toFixed(6) }}, {{ result.coordinates[1].toFixed(6) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useTripStore } from '../store/trip'
import type { Destination } from '../types'
import { gcj02ToWgs84, isViewportRoughlyChina } from '@/lib/coordConvert'

interface POISearchResult {
  name: string
  address: string
  coordinates: [number, number]
  sourceLabel: string
}

interface MapTilerFeature {
  text?: string
  place_name?: string
  center?: [number, number]
}

interface MapTilerResponse {
  features?: MapTilerFeature[]
}

const props = defineProps<{
  /** 返回当前用于判定的地图中心 [lng, lat] */
  resolveMapCenter: () => [number, number]
}>()

const emit = defineEmits<{
  select: [poi: Destination]
}>()

const tripStore = useTripStore()

const amapKey = import.meta.env.VITE_AMAP_KEY as string | undefined
const mapquestKey = import.meta.env.VITE_MAPQUEST_KEY as string | undefined
const maptilerKey = import.meta.env.VITE_MAPTILER_KEY as string | undefined

const searchQuery = ref('')
const isSearching = ref(false)
const searchResults = ref<POISearchResult[]>([])
const errorMessage = ref('')
const showDropdown = ref(false)
let debounceTimer: number | null = null
/** 丢弃过期的异步搜索结果（连续输入时先发出的请求后返回） */
let searchSeq = 0

function handleInput() {
  showDropdown.value = false
  errorMessage.value = ''

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = window.setTimeout(() => {
    if (searchQuery.value.trim().length >= 1) {
      void searchPOI()
    } else {
      searchResults.value = []
      errorMessage.value = ''
    }
  }, 400)
}

async function searchAMap(trimmed: string): Promise<POISearchResult[]> {
  if (!amapKey) return []

  const url =
    'https://restapi.amap.com/v3/place/text?' +
    new URLSearchParams({
      keywords: trimmed,
      key: amapKey,
      types: '',
      city: '',
      offset: '10',
      page: '1',
      extensions: 'all'
    }).toString()

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`高德 ${response.status}`)
  }

  const data = (await response.json()) as {
    status?: string
    info?: string
    pois?: {
      name: string
      address?: string
      pname?: string
      cityname?: string
      adname?: string
      location?: string
    }[]
  }

  if (data.status !== '1') {
    throw new Error(data.info || '高德接口返回异常')
  }

  const pois = data.pois || []
  return pois
    .map((p) => {
      if (!p.location) return null
      const parts = p.location.split(',')
      if (parts.length < 2) return null
      const gcjLng = Number(parts[0])
      const gcjLat = Number(parts[1])
      if (!Number.isFinite(gcjLng) || !Number.isFinite(gcjLat)) return null

      const [wLng, wLat] = gcj02ToWgs84(gcjLng, gcjLat)
      const admin = [p.pname, p.cityname, p.adname].filter(Boolean).join('')
      const detail = [admin, p.address].filter(Boolean).join(' ')
      return {
        name: p.name,
        address: detail || admin || p.address || p.adname || '',
        coordinates: [wLng, wLat] as [number, number],
        sourceLabel: '高德'
      }
    })
    .filter((item): item is POISearchResult => item !== null)
}

async function searchMapQuest(
  trimmed: string,
  lng: number,
  lat: number
): Promise<POISearchResult[]> {
  if (!mapquestKey) return []

  const params = new URLSearchParams({
    key: mapquestKey,
    q: trimmed,
    limit: '10',
    location: `${lng},${lat}`
  })

  const url = `https://www.mapquestapi.com/search/v3/prediction?${params.toString()}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`MapQuest ${response.status}`)
  }

  const data = (await response.json()) as {
    results?: {
      displayString?: string
      place?: { geometry?: { coordinates?: number[] } }
    }[]
  }

  const results = data.results || []
  const out: POISearchResult[] = []

  for (const p of results) {
    const coords = p.place?.geometry?.coordinates
    if (!coords || coords.length < 2) continue
    const lng = coords[0]
    const lat = coords[1]
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    out.push({
      name: p.displayString || '地点',
      address: '',
      coordinates: [lng, lat],
      sourceLabel: 'MapQuest'
    })
  }

  return out
}

async function searchMapTiler(
  trimmed: string,
  lng: number,
  lat: number
): Promise<POISearchResult[]> {
  if (!maptilerKey) return []

  const url =
    `https://api.maptiler.com/geocoding/${encodeURIComponent(trimmed)}.json` +
    `?key=${encodeURIComponent(maptilerKey)}` +
    '&language=zh&limit=10' +
    `&proximity=${lng},${lat}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`MapTiler ${response.status}`)
  }

  const data: MapTilerResponse = await response.json()
  return (data.features || [])
    .map((item) => {
      if (!item.center || item.center.length < 2) return null
      return {
        name: item.text || item.place_name || '未命名地点',
        address: item.place_name || item.text || '未知地址',
        coordinates: [item.center[0], item.center[1]] as [number, number],
        sourceLabel: 'MapTiler'
      }
    })
    .filter((item): item is POISearchResult => item !== null)
}

async function searchPOI(query = searchQuery.value) {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 1) {
    searchResults.value = []
    errorMessage.value = ''
    showDropdown.value = false
    return
  }

  if (!amapKey && !mapquestKey && !maptilerKey) {
    searchResults.value = []
    errorMessage.value =
      '请在 .env 中配置 VITE_AMAP_KEY、VITE_MAPQUEST_KEY 或 VITE_MAPTILER_KEY 至少一项，并重启 dev'
    showDropdown.value = true
    return
  }

  const mySeq = ++searchSeq
  isSearching.value = true
  errorMessage.value = ''
  showDropdown.value = true

  try {
    const [lng, lat] = props.resolveMapCenter()
    const inChina = isViewportRoughlyChina(lng, lat)
    let rows: POISearchResult[] = []

    const runAmap = () => (amapKey ? searchAMap(trimmedQuery) : Promise.resolve([]))
    const runMt = () =>
      maptilerKey ? searchMapTiler(trimmedQuery, lng, lat) : Promise.resolve([])
    const runMq = () =>
      mapquestKey ? searchMapQuest(trimmedQuery, lng, lat) : Promise.resolve([])

    if (inChina) {
      rows = await runAmap()
      if (rows.length === 0) rows = await runMt()
      if (rows.length === 0) rows = await runMq()
    } else {
      rows = await runMt()
      if (rows.length === 0) rows = await runMq()
      if (rows.length === 0) rows = await runAmap()
    }

    if (mySeq !== searchSeq) return

    searchResults.value = rows
    if (rows.length === 0) {
      errorMessage.value = ''
    }
  } catch (error) {
    if (mySeq !== searchSeq) return
    searchResults.value = []
    errorMessage.value =
      error instanceof Error
        ? `搜索失败：${error.message}`
        : '搜索失败：网络异常或接口不可用'
    console.error('POI 搜索失败:', error)
  } finally {
    if (mySeq === searchSeq) {
      isSearching.value = false
    }
  }
}

function selectPOI(poi: POISearchResult) {
  const destination: Destination = {
    id: Date.now().toString(),
    name: poi.name,
    description: poi.address,
    coordinates: [poi.coordinates[0], poi.coordinates[1]],
    order: tripStore.destinations.length + 1
  }

  tripStore.addDestination(destination)
  emit('select', destination)

  searchQuery.value = ''
  showDropdown.value = false
  searchResults.value = []
  errorMessage.value = ''
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.poi-search')) {
    showDropdown.value = false
  }
}

watch(showDropdown, (newVal) => {
  if (newVal) {
    document.addEventListener('click', handleClickOutside)
  } else {
    document.removeEventListener('click', handleClickOutside)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})
</script>

<style scoped>
.poi-search {
  position: relative;
  width: 100%;
  max-width: 400px;
  z-index: 1000;
}

.search-input-container {
  display: flex;
  gap: 8px;
}

.search-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid rgba(29, 34, 38, 0.18);
  background: #dcdfde;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.3s;
}

.search-input:focus {
  border-color: #5b6b73;
}

.search-input:disabled {
  background-color: #dfe2e1;
  cursor: not-allowed;
}

.search-button {
  padding: 10px 16px;
  background-color: #5b6b73;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
}

.search-button:hover:not(:disabled) {
  background-color: #6b7d86;
}

.search-button:disabled {
  background-color: #c7cdcf;
  cursor: not-allowed;
}

.loading-icon {
  animation: spin 1s linear infinite;
  display: inline-block;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background-color: #dcdfde;
  border: 1px solid rgba(29, 34, 38, 0.18);
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(29, 34, 38, 0.1);
  max-height: 300px;
  overflow-y: auto;
}

.search-loading,
.search-empty,
.search-error {
  padding: 16px;
  text-align: center;
  font-size: 14px;
}

.search-loading,
.search-empty {
  color: rgba(29, 34, 38, 0.46);
}

.search-error {
  color: #a14b3c;
  background: #f1e6e2;
}

.search-result-item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(29, 34, 38, 0.1);
  transition: background-color 0.2s;
}

.search-result-item:hover {
  background-color: #e4ebef;
}

.search-result-item:last-child {
  border-bottom: none;
}

.poi-name {
  font-size: 14px;
  font-weight: 600;
  color: #1d2226;
  margin-bottom: 4px;
}

.poi-address {
  font-size: 12px;
  color: #5b6b73;
  margin-bottom: 4px;
}

.poi-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(29, 34, 38, 0.46);
}

.poi-engine {
  color: #5b6b73;
  flex-shrink: 0;
}

.poi-coordinates {
  text-align: right;
  word-break: break-all;
}
</style>
