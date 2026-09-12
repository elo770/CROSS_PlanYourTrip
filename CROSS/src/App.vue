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
    <nav class="mobile-nav" aria-label="主导航">
      <router-link to="/home">
        <svg class="nav-icon" viewBox="0 0 28 24" aria-hidden="true">
          <path d="M3.5 17.5c3.2-1.2 5.1-5.7 8.5-5.7 3 0 3.9 3.2 6.6 3.2 2.3 0 3.7-1.8 5.9-3.1" />
          <path class="soft-line" d="M4.2 10.5c2.6-.2 4.2-2.9 6.7-2.9 2.3 0 3.8 2.1 6 2.1 2 0 3.3-1.1 5-2.7" />
          <circle class="nav-dot" cx="4" cy="17.4" r="1.6" />
        </svg>
        <small>首页</small>
      </router-link>
      <router-link to="/map">
        <svg class="nav-icon route-icon" viewBox="0 0 28 24" aria-hidden="true">
          <path class="route-path" d="M4 17.5c3.1-5.5 6.1-7.5 9-5.3 3.2 2.5 5.3-5 10.8-5.4" />
          <circle class="route-start" cx="4" cy="17.5" r="2" />
          <circle class="route-end" cx="24" cy="6.8" r="2" />
        </svg>
        <small>路线</small>
      </router-link>
      <router-link to="/schedule">
        <svg class="nav-icon" viewBox="0 0 28 24" aria-hidden="true">
          <path d="M6 5.5h16a2 2 0 0 1 2 2v12H4v-12a2 2 0 0 1 2-2Z" />
          <path d="M4 10h20M9 3v5M19 3v5" />
          <circle class="nav-dot" cx="9" cy="14.5" r="1.4" />
          <path class="soft-line" d="M13 14.5h6" />
        </svg>
        <small>日程</small>
      </router-link>
      <router-link to="/budget">
        <svg class="nav-icon" viewBox="0 0 28 24" aria-hidden="true">
          <path d="M5 7.5c4.4-2 13.8-2 18 0v10c-4.2 2-13.6 2-18 0Z" />
          <path class="soft-line" d="M5 12.5c4.4 2 13.8 2 18 0" />
          <circle class="nav-dot" cx="14" cy="10" r="1.5" />
        </svg>
        <small>预算</small>
      </router-link>
    </nav>
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

.mobile-nav {
  display: none;
}

@media (max-width: 720px) {
  .app-container {
    height: 100dvh;
  }

  .app-header {
    display: none;
  }

  .app-main {
    flex-basis: calc(100dvh - 64px - env(safe-area-inset-bottom));
    height: calc(100dvh - 64px - env(safe-area-inset-bottom));
    overscroll-behavior: contain;
  }

  .mobile-nav {
    position: fixed;
    z-index: 1000;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    height: calc(64px + env(safe-area-inset-bottom));
    grid-template-columns: repeat(4, 1fr);
    padding: 5px 8px env(safe-area-inset-bottom);
    border-top: 1px solid var(--cross-border);
    background: rgba(220, 223, 222, .96);
    box-shadow: 0 -8px 24px rgba(29, 34, 38, .08);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }

  .mobile-nav a {
    display: flex;
    min-width: 0;
    min-height: 54px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 2px;
    border-radius: 9px;
    color: var(--cross-muted);
    text-decoration: none;
  }

  .nav-icon {
    width: 28px;
    height: 24px;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.45;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .nav-icon .soft-line {
    opacity: .42;
  }

  .nav-icon .nav-dot {
    fill: currentColor;
    stroke: none;
  }

  .route-icon .route-path {
    stroke-dasharray: 2.3 3.2;
  }

  .route-icon .route-start {
    fill: var(--cross-moss);
    stroke: none;
  }

  .route-icon .route-end {
    fill: var(--cross-rust);
    stroke: none;
  }

  .mobile-nav a small {
    font-size: 11px;
  }

  .mobile-nav a.router-link-active {
    background: rgba(91, 107, 115, .11);
    color: var(--cross-rust);
    font-weight: 650;
  }
}
</style>
