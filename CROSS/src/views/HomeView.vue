<template>
  <div class="home-view">
    <div class="home-container">
      <section class="hero-stage">
        <svg class="hero-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <path class="mountain mountain-back" d="M0 540 220 380 400 470 560 340 760 460 900 300 1080 440 1260 360 1440 480 1600 400V900H0Z" />
          <path class="mountain mountain-mid" d="M0 620 260 500 480 590 680 460 880 580 1080 470 1300 580 1600 510V900H0Z" />
          <path class="mountain mountain-front" d="M0 700 300 620 560 690 820 610 1100 690 1360 630 1600 680V900H0Z" />

          <g class="rain-lines">
            <line x1="120" y1="60" x2="108" y2="110" />
            <line x1="260" y1="120" x2="248" y2="170" />
            <line x1="420" y1="40" x2="408" y2="90" />
            <line x1="600" y1="150" x2="588" y2="200" />
            <line x1="780" y1="80" x2="768" y2="130" />
            <line x1="950" y1="180" x2="938" y2="230" />
            <line x1="1120" y1="60" x2="1108" y2="110" />
            <line x1="1280" y1="140" x2="1268" y2="190" />
            <line x1="1420" y1="90" x2="1408" y2="140" />
            <line x1="180" y1="260" x2="168" y2="310" />
            <line x1="520" y1="290" x2="508" y2="340" />
            <line x1="860" y1="270" x2="848" y2="320" />
            <line x1="1220" y1="300" x2="1208" y2="350" />
            <line x1="1500" y1="250" x2="1488" y2="300" />
          </g>

          <path class="hero-route" d="M548 820 C650 785 732 814 800 770 C875 720 918 748 1015 704" />
          <circle class="route-end" cx="1015" cy="704" r="7" />

          <g class="roamer">
            <circle cx="3" cy="-94" r="10" />
            <path d="M-2-84 -3-74M6-85 7-75" />
            <path d="M-8-73C-24-48-32-18-28 10-26 26-36 38-48 48" />
            <path d="M10-73C18-50 14-24 20 0 24 16 20 32 26 46" />
            <path d="M-48 48C-30 54-6 52 26 46" />
            <path d="M8 10C14 28 16 44 22 60 26 72 28 82 32 92M0 10C4 26 4 42 8 58 10 70 12 80 16 90" />
            <path d="M16 90 30 94M-10 8C-18 24-24 38-30 52-36 64-40 76-46 88M-2 8C-8 22-12 34-16 46-20 58-22 70-26 82" />
            <path d="M-26 82-44 90M-9-68C-20-52-30-36-34-18M11-68C18-56 20-42 16-28" />
            <path d="M-6-102C-18-108-30-104-36-92M-2-104C-14-112-26-110-33-100M2-100C-6-106-14-104-19-98" />
          </g>
        </svg>

        <div class="hero-caption">
          <p class="hero-kicker">CROSS · 从这里出发</p>
          <h1>{{ savedRoutes.length ? '下一站，还没有决定。' : '路还没有形成。' }}</h1>
          <p>开始你的旅程。</p>
          <button class="hero-cta" type="button" @click="handleHeroAction">
            开始你的旅程
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      <div class="routes-section">
        <h2 class="section-title">我的路线</h2>
        <div v-if="savedRoutes.length === 0" class="empty-state">
          <el-empty description="还没有保存的路线，开始创建您的第一条路线吧！" />
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
        <el-card class="example-card" shadow="hover" @click="loadExampleJiangZheHuRoute">
          <div class="example-card-content">
            <div class="example-icon">
              <el-icon><Star /></el-icon>
            </div>
            <div class="example-info">
              <h3>江浙沪旅游攻略</h3>
              <p>上海—苏州—杭州—乌镇，江南水乡与城市人文</p>
              <div class="example-details">
                <span>4 个目的地</span>
                <span>•</span>
                <span>7 天</span>
              </div>
            </div>
            <el-button type="primary" @click.stop="loadExampleJiangZheHuRoute">
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
import { Star, Delete, Location, Calendar } from '@element-plus/icons-vue'

const router = useRouter()
const tripStore = useTripStore()

const savedRoutes = computed(() => tripStore.savedRoutes)

function handleHeroAction() {
  if (savedRoutes.value.length > 0) {
    openRoute(savedRoutes.value[0].id)
    return
  }
  createNewRoute()
}

function createNewRoute() {
  // 清空当前路线
  tripStore.destinations = []
  tripStore.currentRoute = null
  tripStore.schedule = []
  // 跳转到地图规划页面
  router.push('/map')
}

function loadExampleJiangZheHuRoute() {
  tripStore.loadPresetRoute('jiangzhehu')
  ElMessage.success('已加载示例路线：江浙沪旅游攻略')
  router.push('/map')
}

function openRoute(routeId: string) {
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
  min-height: calc(100vh - 60px);
  background: #d8dcdd;
  padding: 0;
  overflow-y: auto;
}

.home-container {
  max-width: none;
  margin: 0 auto;
}

.hero-stage {
  position: relative;
  min-height: calc(100vh - 60px);
  overflow: hidden;
  background: #d8dcdd;
  border-bottom: 0;
}

.hero-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.mountain {
  stroke: none;
}

.mountain-back {
  fill: #8a8798;
  opacity: 0.28;
}

.mountain-mid {
  fill: #6b6c7b;
  opacity: 0.42;
}

.mountain-front {
  fill: #5b6b73;
  opacity: 0.55;
}

.rain-lines {
  stroke: #1d2226;
  stroke-width: 1.1;
  stroke-opacity: 0.1;
  stroke-linecap: round;
  animation: rain-drift 2.4s linear infinite;
}

@keyframes rain-drift {
  0% { transform: translateY(-14px); }
  100% { transform: translateY(14px); }
}

.hero-route {
  fill: none;
  stroke: #a14b3c;
  stroke-width: 1.4;
  stroke-dasharray: 7 9;
  stroke-linecap: round;
  stroke-opacity: 0.72;
  animation: route-draw 1.4s ease-out both;
}

@keyframes route-draw {
  from { stroke-dashoffset: 150; opacity: 0; }
  to { stroke-dashoffset: 0; opacity: 0.72; }
}

.route-end {
  fill: #a14b3c;
  opacity: 0.8;
}

.roamer {
  fill: none;
  stroke: #1d2226;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-opacity: 0.78;
  animation: roamer-breathe 3.4s ease-in-out infinite;
}

@keyframes roamer-breathe {
  0%, 100% { transform: translate(548px, 772px) rotate(-3deg); }
  50% { transform: translate(551px, 770px) rotate(-2deg); }
}

.hero-kicker {
  margin: 0 0 10px;
  color: rgba(29, 34, 38, 0.62);
  font-size: 11px;
  letter-spacing: 0.12em;
}

.hero-cta:hover {
  color: #a14b3c;
  border-color: #a14b3c;
}

.hero-caption {
  position: absolute;
  left: 58%;
  bottom: 78px;
  width: 300px;
  text-align: left;
}

.hero-caption h1 {
  margin: 0 0 12px;
  color: #1d2226;
  font-size: 28px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.hero-caption > p:not(.hero-kicker) {
  margin: 0 0 26px;
  color: rgba(29, 34, 38, 0.62);
  font-size: 14px;
  font-weight: 300;
}

.hero-cta {
  padding: 12px 28px;
  border: 1px solid rgba(29, 34, 38, 0.28);
  background: transparent;
  color: #1d2226;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.25s ease, color 0.25s ease;
}

.hero-cta span {
  margin-left: 7px;
}

.routes-section,
.examples-section {
  max-width: 1200px;
  padding: 28px 20px 0;
  margin: 0 auto 24px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1d2226;
  margin-bottom: 16px;
}

.empty-state {
  padding: 40px 20px;
  background: rgba(216, 220, 221, 0.72);
  border-radius: 8px;
  box-shadow: none;
  border: 1px solid rgba(29, 34, 38, 0.18);
}

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
    min-height: 650px;
  }

  .hero-caption {
    left: 50%;
    bottom: 48px;
    transform: translateX(-50%);
    width: min(300px, calc(100% - 40px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .rain-lines,
  .hero-route,
  .roamer {
    animation: none;
  }
}
</style>

