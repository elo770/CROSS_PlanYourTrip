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
import { useTripStore } from '@/store/trip'
import type { Destination } from '@/types'

interface POISearchResult {
  name: string
  address: string
  coordinates: [number, number]
  sourceLabel: string
}

defineProps<{
  resolveMapCenter: () => [number, number]
}>()

const emit = defineEmits<{
  select: [poi: Destination]
}>()

const tripStore = useTripStore()
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api'

const searchQuery = ref('')
const isSearching = ref(false)
const searchResults = ref<POISearchResult[]>([])
const errorMessage = ref('')
const showDropdown = ref(false)
let debounceTimer: number | null = null
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
  const city = tripStore.currentRoute?.name?.replace(/行程|路线/g, '').trim() || ''
  const params = new URLSearchParams({ query: trimmed })
  if (city) params.set('city', city)
  const response = await fetch(`${apiBaseUrl}/poi/search?${params}`)
  const data = await response.json().catch(() => ({})) as { pois?: POISearchResult[]; error?: string }
  if (!response.ok) throw new Error(data.error || `地点搜索服务请求失败（${response.status}）`)
  return data.pois || []
}

async function searchPOI(query = searchQuery.value) {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 1) {
    searchResults.value = []
    errorMessage.value = ''
    showDropdown.value = false
    return
  }

  const mySeq = ++searchSeq
  isSearching.value = true
  errorMessage.value = ''
  showDropdown.value = true

  try {
    const rows = await searchAMap(trimmedQuery)
    if (mySeq !== searchSeq) return
    searchResults.value = rows
  } catch (error) {
    if (mySeq !== searchSeq) return
    searchResults.value = []
    errorMessage.value =
      error instanceof TypeError
        ? '无法连接地点搜索服务，请确认后端已启动。'
        : error instanceof Error ? `搜索失败：${error.message}` : '搜索失败：网络异常或接口不可用'
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
      order: tripStore.destinations.length + 1,
      planningStatus: 'unscheduled',
      source: 'user'
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

.search-button {
  padding: 10px 16px;
  background-color: #5b6b73;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
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
