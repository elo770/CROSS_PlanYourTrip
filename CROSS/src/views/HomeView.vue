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

          <image class="roamer" href="/assets/mascot_full_transparent.svg" x="-54" y="-116" width="100" height="214" />

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
        <p class="local-storage-note">路线和预算只保存在当前浏览器；清除浏览器数据后无法找回。</p>
        <div v-if="savedRoutes.length === 0" class="empty-state">
          <JourneyEmptyState
            title="还没有路线"
            description="从一个想去的地方开始吧。"
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
                <div class="route-card-actions">
                  <button type="button" @click.stop="renameRoute(route)">改名</button>
                  <button type="button" @click.stop="handleDeleteRoute(route.id)">删除</button>
                </div>
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
            <button class="example-load-button" type="button" @click.stop="loadExampleShanghaiSuzhouRoute">加载路线</button>
          </div>
        </el-card>
        <el-card class="example-card" shadow="hover" @click="loadExampleBeijingRoute">
          <div class="example-card-content">
            <div class="example-icon"><el-icon><Star /></el-icon></div>
            <div class="example-info">
              <h3>北京漫游 2 日</h3>
              <p>地坛、雍和宫、故宫到后海</p>
              <div class="example-details"><span>30 个地点 · 2 天</span></div>
            </div>
            <button class="example-load-button" type="button" @click.stop="loadExampleBeijingRoute">加载路线</button>
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
import { Star, Location, Calendar } from '@element-plus/icons-vue'
import JourneyEmptyState from '@/components/JourneyEmptyState.vue'
import { promptRouteName } from '@/lib/routeNamePrompt'
import type { Route } from '@/types'

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
  const firstSave = !tripStore.savedRoutes.some((route) => route.id === previousTripId)
  const name = firstSave
    ? await promptRouteName(tripStore.currentRoute?.name || '我的旅行路线', '保存路线')
    : tripStore.currentRoute?.name || '我的旅行路线'
  if (!name) return false
  const routeId = previousTripId.startsWith('draft-trip-') ? createSavedTripId() : previousTripId
  if (routeId !== previousTripId) migrateAgentStorage(previousTripId, routeId)
  const route = tripStore.buildCurrentRoute({ id: routeId, name })
  route.estimatedDays = Math.max(route.estimatedDays, tripStore.currentRoute?.estimatedDays || 1)
  tripStore.setRoute(route)
  try {
    await tripStore.saveRouteToList(route)
  } catch {
    ElMessage.error('保存失败：当前浏览器空间不足，请减少照片后重试')
    return false
  }
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
    if (await saveCurrentRoute()) createNewRoute()
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

function loadExampleBeijingRoute() {
  tripStore.loadPresetRoute('beijing-two-day')
  if (tripStore.currentRoute?.id) setActiveTripId(tripStore.currentRoute.id)
  ElMessage.success('已加载示例路线：北京漫游 2 日')
  router.push('/map')
}

function openRoute(routeId: string) {
  setActiveTripId(routeId)
  tripStore.loadRouteFromList(routeId)
  router.push('/map')
}

async function renameRoute(route: Route) {
  const name = await promptRouteName(route.name, '修改路线名称')
  if (!name || name === route.name) return
  await tripStore.renameSavedRoute(route.id, name)
  ElMessage.success('路线名称已更新')
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
  animation: roamer-breathe 3.4s ease-in-out infinite;
}

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
  border-radius: 6px 11px 7px 9px;
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

.local-storage-note { margin: 0 0 16px; color: var(--cross-ink-soft); font-size: 12px; line-height: 1.6; }

.new-route-button {
  border: 0;
  border-bottom: 1px solid var(--cross-ink-faint);
  border-radius: 0;
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
  border-bottom-color: var(--cross-rust);
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
  border: 1px solid rgba(29, 34, 38, .25);
  border-radius: 7px 14px 8px 11px;
  background: rgba(220, 223, 222, .68);
  box-shadow: none;
  cursor: pointer;
  transition: transform 0.2s;
}

.route-card:hover {
  transform: translateY(-2px);
  box-shadow: none;
}

.route-card :deep(.el-card__header) { border-bottom: 1px dashed rgba(29, 34, 38, .2); }

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

.route-card-actions { display: flex; gap: 12px; }
.route-card-actions button { min-height: 32px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); border-radius: 0; background: transparent; color: var(--cross-ink-soft); padding: 3px 1px; font: inherit; font-size: 12px; cursor: pointer; }
.route-card-actions button:hover, .route-card-actions button:focus-visible { border-bottom-color: var(--cross-rust); color: var(--cross-rust); outline: none; }

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
  border-radius: 4px 8px 4px 6px;
  --el-tag-bg-color: rgba(95, 91, 112, 0.08);
  --el-tag-border-color: rgba(95, 91, 112, 0.2);
  --el-tag-text-color: #30383d;
}

.example-load-button { min-height: 34px; border: 1px solid #5368ad; border-radius: 6px 10px 7px 9px; background: transparent; color: var(--cross-ink); padding: 5px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.example-load-button:hover { background: rgba(101, 117, 172, .12); }

.more-destinations {
  color: rgba(29, 34, 38, 0.46);
  font-size: 12px;
  line-height: 24px;
}

.example-card {
  border: 1px solid rgba(29, 34, 38, .25);
  border-radius: 7px 14px 8px 11px;
  background: rgba(220, 223, 222, .68);
  box-shadow: none;
  cursor: pointer;
  transition: transform 0.2s;
}

.example-card:hover {
  transform: translateY(-2px);
  box-shadow: none;
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

@media (max-width: 720px) {
  .home-view { min-height: 100%; }
  .home-container { width: 100%; }
  .hero-stage { height: 330px; min-height: 330px; }
  .hero-art { min-width: 760px; left: 50%; transform: translateX(-50%); }
  .hero-caption { top: 20px; width: calc(100% - 28px); }
  .hero-kicker { margin-bottom: 12px; }
  .hero-cta { min-height: 46px; padding: 10px 16px; }
  .routes-section,
  .examples-section { padding-right: 14px; padding-left: 14px; }
  .section-header { align-items: flex-start; gap: 12px; }
  .new-route-button { min-height: 44px; }
  .route-card-actions button, .example-load-button { min-height: 44px; }
  .routes-grid { grid-template-columns: 1fr; gap: 12px; }
  .route-card-header h3 { overflow-wrap: anywhere; }
  .route-card:hover,
  .example-card:hover { transform: none; }
  .example-card-content { align-items: flex-start; padding: 14px 4px; }
  .example-icon { width: 42px; height: 42px; }
}

@media (prefers-reduced-motion: reduce) {
  .roamer {
    animation: none;
  }

  .hero-cta { transition: none; }
  .hero-cta:hover, .new-route-button:hover { transform: none; }
  .new-route-button,
  .route-card,
  .example-card { transition: none; }
  .route-card:hover,
  .example-card:hover { transform: none; }
}
</style>
