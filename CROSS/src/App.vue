<template>
  <el-container class="app-container">
    <el-header class="app-header">
      <div class="header-content">
        <h1 class="logo">
          越陌 <span>CROSS</span>
        </h1>
        <el-menu
          :default-active="activeMenu"
          mode="horizontal"
          router
          :ellipsis="false"
          class="header-menu"
        >
          <el-menu-item index="/home">
            <span>首页</span>
          </el-menu-item>
          <el-menu-item index="/map">
            <span>路线规划</span>
          </el-menu-item>
          <el-menu-item index="/schedule">
            <span>日程安排</span>
          </el-menu-item>
          <el-menu-item index="/budget">
            <span>预算管理</span>
          </el-menu-item>
        </el-menu>
      </div>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const activeMenu = computed(() => route.path)
</script>

<style scoped>
.app-container {
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

.app-header {
  flex: 0 0 60px;
  position: relative;
  z-index: 20;
  background: rgba(216, 220, 221, 0.9);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  color: var(--cross-ink);
  padding: 0;
  box-shadow: 0 1px 0 rgba(29, 34, 38, 0.08);
  border-bottom: 1px solid var(--cross-border);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 20px;
  position: relative;
  min-width: 800px;
}

.logo {
  position: absolute;
  left: 20px;
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--cross-ink);
  font-size: 20px;
  font-weight: 650;
  margin: 0;
}

.logo span { font-weight: 500; }

.header-menu {
  --el-menu-active-color: var(--cross-ink);
  --el-menu-hover-text-color: var(--cross-ink);
  background: transparent;
  border: none;
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
}

.header-menu :deep(.el-menu-item) {
  color: var(--cross-muted);
  border-bottom: 2px solid transparent;
  font-size: 13px;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.header-menu :deep(.el-menu-item:hover),
.header-menu :deep(.el-menu-item.is-active) {
  background: transparent;
  color: var(--cross-ink);
}

.header-menu :deep(.el-menu-item.is-active) {
  color: var(--cross-ink) !important;
  border-bottom-color: var(--cross-terracotta);
}

.app-main {
  flex: 0 0 calc(100vh - 60px);
  min-height: 0;
  padding: 0;
  overflow: auto;
  height: calc(100vh - 60px);
}
</style>
