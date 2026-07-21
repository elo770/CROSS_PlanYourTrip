<template>
  <div class="home-view">
    <div class="home-container">
      <section class="hero-stage">
        <svg class="hero-art" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g class="landscape">
            <path class="mountain mountain-back" d="M0 228L190 136l188 72 230-108 214 122 190-134 226 128 202-82 160 70v196H0Z" />
            <path class="mountain mountain-mid" d="M0 282l250-92 216 90 240-122 226 126 220-104 230 108 218-70v182H0Z" />
            <path class="mountain mountain-front" d="M0 334l284-72 244 74 268-88 242 82 278-66 284 74v62H0Z" />
          </g>

          <g class="roamer">
            <circle class="roamer-outline" cx="3" cy="-94" r="10" />
            <path class="roamer-structure" d="M-2-84 -3-74M6-85 7-75" />
            <path class="roamer-outline" d="M-8-73C-24-48-32-18-28 10-26 26-36 38-48 48M10-73C18-50 14-24 20 0 24 16 20 32 26 46" />
            <path class="roamer-structure" d="M-48 48C-30 54-6 52 26 46" />
            <path class="roamer-structure" d="M8 10C14 28 16 44 22 60 26 72 28 82 32 92M-10 8C-18 24-24 38-30 52-36 64-40 76-46 88" />
            <path class="roamer-detail" d="M0 10C4 26 4 42 8 58 10 70 12 80 16 90M-2 8C-8 22-12 34-16 46-20 58-22 70-26 82" />
            <path class="roamer-structure" d="M-9-68C-20-52-30-36-34-18M11-68C18-56 20-42 16-28" />
            <path class="roamer-detail" d="M-3-68C-12-54-20-40-22-24M5-68C10-58 12-46 10-34" />
            <path class="roamer-hair-primary" d="M-6-102C-18-108-30-104-36-92" />
            <path class="roamer-hair-secondary" d="M-2-104C-14-112-26-110-33-100M2-100C-6-106-14-104-19-98" />
          </g>

          <g class="seam-mist">
            <path class="seam-mist-back" d="M0 380C180 369 320 386 500 378c190-9 320 12 500 2 190-10 390 6 600-4v24H0Z" />
            <path class="seam-mist-front" d="M0 392c220-8 360 7 548 1 190-6 330 8 518 1 202-8 350 5 534-2v8H0Z" />
          </g>
        </svg>

        <div class="hero-caption">
          <p class="hero-kicker">CROSS · 从这里出发</p>
          <button class="hero-cta" type="button" @click="handleHeroAction">
            <el-icon><Location /></el-icon>
            新建一条路线
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      <div class="routes-section">
        <div class="section-heading">
          <h2 class="section-title">我的路线</h2>
          <button v-if="savedRoutes.length" class="new-route-button" type="button" @click="requestNewRoute">新建路线</button>
        </div>
        <div v-if="savedRoutes.length === 0" class="empty-state">
          <JourneyEmptyState
            title="还没有形成路线"
            description="先从一个想去的城市或地点开始，路线、日程和地图会在同一个工作区里逐渐成形。"
            action-label="开始规划"
            @action="requestNewRoute"
          />
        </div>
        <div v-else class="routes-grid">
          <el-card
            v-for="route in savedRoutes"
            :key="route.id"
            class="route-card"
            shadow="hover"
            @click="openRoute(route.id)"
          >
            <template #header>
              <div class="route-card-header">
                <h3>{{ route.name }}</h3>
                <el-button
                  type="danger"
                  :icon="Delete"
                  circle
                  size="small"
                  @click.stop="handleDeleteRoute(route.id)"
                />
              </div>
            </template>
            <div class="route-card-content">
              <div class="route-info-item">
                <el-icon><Location /></el-icon>
                <span>{{ route.destinations.length }} 个目的地</span>
              </div>
              <div class="route-info-item">
                <el-icon><Calendar /></el-icon>
                <span>{{ route.estimatedDays }} 天</span>
              </div>
              <div class="route-destinations">
                <el-tag
                  v-for="(dest) in route.destinations.slice(0, 3)"
                  :key="dest.id"
                  size="small"
                  class="destination-tag"
                >
                  {{ dest.name }}
                </el-tag>
                <span v-if="route.destinations.length > 3" class="more-destinations">
                  +{{ route.destinations.length - 3 }} 更多
                </span>
              </div>
            </div>
          </el-card>
        </div>
      </div>

      <div class="examples-section">
        <h2 class="section-title">示例路线</h2>
        <el-card class="example-card" shadow="hover" @click="loadExampleShanghaiSuzhouRoute">
          <div class="example-card-content">
            <div class="example-icon">
              <el-icon><Star /></el-icon>
            </div>
            <div class="example-info">
              <h3>上海—苏州 4 日</h3>
              <p>上海 2 天，苏州 2 天</p>
              <div class="example-details">
                <span>12 个地点</span>
              </div>
            </div>
            <el-button type="primary" @click.stop="loadExampleShanghaiSuzhouRoute">
              加载路线
            </el-button>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTripStore } from '@/store/trip'
import { clearLegacyAgentStorageOnce, createDraftTripId, createSavedTripId, getActiveTripId, migrateAgentStorage, setActiveTripId } from '@/lib/agentSessionStorage'
import { Star, Delete, Location, Calendar } from '@element-plus/icons-vue'
import JourneyEmptyState from '@/components/JourneyEmptyState.vue'

const router = useRouter()
const tripStore = useTripStore()
clearLegacyAgentStorageOnce()

const savedRoutes = computed(() => tripStore.savedRoutes)

function handleHeroAction() {
  void requestNewRoute()
}

function createNewRoute() {
  setActiveTripId(createDraftTripId())
  tripStore.clearPlanningState({ markDirty: false })
  tripStore.markRouteSaved()
  router.push('/map')
}

async function saveCurrentRoute() {
  if (!tripStore.destinations.length) return false
  const previousTripId = getActiveTripId() || tripStore.currentRoute?.id || createDraftTripId()
  const routeId = previousTripId.startsWith('draft-trip-') ? createSavedTripId() : previousTripId
  if (routeId !== previousTripId) migrateAgentStorage(previousTripId, routeId)
  const route = tripStore.buildCurrentRoute({ id: routeId, name: tripStore.currentRoute?.name || '我的旅行路线' })
  tripStore.setRoute(route)
  await tripStore.saveRouteToList(route)
  setActiveTripId(routeId)
  return true
}

async function requestNewRoute() {
  const hasRouteContent = Boolean(tripStore.currentRoute || tripStore.currentTrip || tripStore.destinations.length)
  if (!hasRouteContent || !tripStore.isRouteDirty) {
    createNewRoute()
    return
  }
  if (!tripStore.destinations.length) {
    try {
      await ElMessageBox.confirm('当前路线有未保存变更，但没有可保存的地点。要放弃这些变更并新建吗？', '新建路线', {
        confirmButtonText: '放弃并新建', cancelButtonText: '继续编辑', type: 'warning'
      })
      createNewRoute()
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
    await saveCurrentRoute()
    createNewRoute()
  } catch (action) {
    if (action === 'cancel') createNewRoute()
  }
}

function loadExampleShanghaiSuzhouRoute() {
  tripStore.loadPresetRoute('jiangzhehu')
  if (tripStore.currentRoute?.id) setActiveTripId(tripStore.currentRoute.id)
  ElMessage.success('已加载示例路线：上海—苏州 4 日')
  router.push('/map')
}

function openRoute(routeId: string) {
  setActiveTripId(routeId)
  tripStore.loadRouteFromList(routeId)
  router.push('/map')
}

function handleDeleteRoute(routeId: string) {
  ElMessageBox.confirm('确定要删除这条路线吗？', '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    tripStore.deleteRoute(routeId)
    ElMessage.success('路线已删除')
  }).catch(() => {})
}
</script>

<style scoped>
.home-view {
  min-height: 100%;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--cross-lake) 24%, var(--cross-canvas)) 0,
    color-mix(in srgb, var(--cross-mountain-far) 18%, var(--cross-canvas)) 285px,
    var(--cross-canvas) 560px,
    var(--cross-paper-deep) 820px,
    var(--cross-paper-deep) 100%
  );
  padding: 0;
  overflow-x: hidden;
}

.home-container {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  background: transparent;
}

.hero-stage {
  position: relative;
  height: clamp(440px, 64vh, 560px);
  min-height: 440px;
  overflow: hidden;
  background: transparent;
  border-bottom: 0;
}

.hero-stage::after {
  display: none;
}

.hero-stage::before {
  display: none;
}

.hero-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  -webkit-mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 4px), transparent 100%);
  mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 4px), transparent 100%);
}

.landscape {
  opacity: 1;
}

.mountain {
  stroke: none;
}

.mountain-back {
  fill: var(--cross-lavender);
  opacity: 0.28;
}

.mountain-mid {
  fill: var(--cross-mountain);
  opacity: 0.42;
}

.mountain-front {
  fill: var(--cross-lake);
  opacity: 0.55;
}

.seam-mist { fill: var(--cross-canvas); pointer-events: none; }
.seam-mist-back { opacity: .34; }
.seam-mist-front { opacity: .62; }

.roamer {
  fill: none;
  stroke: #1d2226;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  animation: roamer-breathe 3.4s ease-in-out infinite;
}

.roamer-outline { stroke-opacity: 0.82; }
.roamer-structure { stroke-opacity: 0.68; }
.roamer-detail { stroke-opacity: 0.5; }
.roamer-hair-primary { stroke-opacity: 0.55; }
.roamer-hair-secondary { stroke-opacity: 0.38; }

@keyframes roamer-breathe {
  0%, 100% { transform: translate(500px, 300px) rotate(-3deg) scale(.8); }
  50% { transform: translate(503px, 298px) rotate(-2deg) scale(.8); }
}

.hero-kicker {
  margin: 0 0 18px;
  color: rgba(29, 34, 38, 0.62);
  font-size: 11px;
  letter-spacing: 0.12em;
}

.hero-cta:hover {
  background: rgba(216, 220, 221, .42);
  color: var(--cross-rust);
  border-color: var(--cross-rust);
}

.hero-caption {
  position: absolute;
  z-index: 2;
  top: 34px;
  left: 50%;
  width: 320px;
  transform: translateX(-50%);
  text-align: center;
}

.hero-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid rgba(32, 37, 41, .34);
  background: rgba(216, 220, 221, .3);
  color: var(--cross-ink);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: border-color .2s ease, background-color .2s ease, color .2s ease, transform .2s ease;
}

.hero-cta:hover { transform: translateY(-1px); }
.hero-cta :deep(.el-icon) { font-size: 15px; }

.hero-cta span {
  margin-left: 7px;
}

.routes-section,
.examples-section {
  max-width: 1200px;
  padding: 28px 20px 0;
  margin: 0 auto 24px;
}

.routes-section {
  position: relative;
  z-index: 2;
  border-top: 0;
  margin-top: 0;
  padding-top: 8px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1d2226;
  margin-bottom: 8px;
}

.empty-state {
  padding: 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border: 0;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-heading .section-title { margin-bottom: 8px; }

.new-route-button {
  border: 1px solid var(--cross-ink-faint);
  border-radius: 5px 8px 5px 6px;
  background: transparent;
  color: var(--cross-ink-soft);
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color .18s ease, color .18s ease, transform .18s ease;
}

.new-route-button:hover,
.new-route-button:focus-visible {
  border-color: var(--cross-rust);
  color: var(--cross-rust);
  outline: none;
  transform: translateY(-1px);
}

.empty-state :deep(.journey-empty) {
  min-height: 150px;
  padding: 0 20px;
  transform: translateY(-40px);
}

.empty-state :deep(.journey-empty__art) {
  width: min(160px, 54%);
  margin-bottom: 6px;
}

.empty-state :deep(.journey-empty p) { margin-top: 4px; line-height: 1.5; }
.empty-state :deep(.journey-empty button) { margin-top: 8px; }

.routes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.route-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.route-card:hover {
  transform: translateY(-4px);
}

.route-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.route-card-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1d2226;
}

.route-card-content {
  padding: 8px 0;
}

.route-info-item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: #5b6b73;
  font-size: 13px;
}

.route-destinations {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(29, 34, 38, 0.14);
}

.destination-tag {
  margin: 0;
  --el-tag-bg-color: rgba(95, 91, 112, 0.16);
  --el-tag-border-color: rgba(95, 91, 112, 0.34);
  --el-tag-text-color: #30383d;
}

.more-destinations {
  color: rgba(29, 34, 38, 0.46);
  font-size: 12px;
  line-height: 24px;
}

.example-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.example-card:hover {
  transform: translateY(-4px);
}

.example-card-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
}

.example-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(95, 91, 112, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #30383d;
  font-size: 24px;
  flex-shrink: 0;
}

.example-info {
  flex: 1;
}

.example-info h3 {
  margin: 0 0 6px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1d2226;
}

.example-info p {
  margin: 0 0 8px 0;
  color: #5b6b73;
  line-height: 1.5;
  font-size: 14px;
}

.example-details {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(29, 34, 38, 0.46);
  font-size: 14px;
}

@media (max-width: 900px) {
  .hero-stage {
    height: 440px;
    min-height: 440px;
  }

  .hero-caption {
    left: 50%;
    top: 24px;
    transform: translateX(-50%);
    width: min(300px, calc(100% - 40px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .roamer {
    animation: none;
  }

  .hero-cta { transition: none; }
  .hero-cta:hover, .new-route-button:hover { transform: none; }
  .new-route-button { transition: none; }
}
</style>

