<template>
  <main class="not-found-view">
    <JourneyEmptyState
      title="这个页面不存在"
      description="回首页重新出发。"
      action-label="回到首页"
      @action="router.push('/home')"
    />
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import JourneyEmptyState from '@/components/JourneyEmptyState.vue'

const router = useRouter()
</script>

<style scoped>
.not-found-view {
  display: grid;
  min-height: 100%;
  place-items: center;
  background: var(--cross-paper);
}
</style>
