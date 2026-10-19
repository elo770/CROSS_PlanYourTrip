<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="category === 'garden'"><path d="M12 20v-6M8 20h8M12 4c-3 0-5 2-5 5-2 1-2 4 0 5 2 1 8 1 10 0 2-1 2-4 0-5 0-3-2-5-5-5Z" /></template>
    <template v-else-if="category === 'river'"><path d="M3 7c3-2 5-2 8 0s5 2 10 0M3 12c3-2 5-2 8 0s5 2 10 0M3 17c3-2 5-2 8 0s5 2 10 0" /></template>
    <template v-else-if="category === 'street'"><path d="M3 20V8l5-2v14m0-11 6-3v14m0-10 7-2v12M3 20h18M6 11v2m5-3v2m6 0v2" /></template>
    <template v-else-if="category === 'food'"><path d="M4 11h16c0 5-3 8-8 8s-8-3-8-8ZM7 21h10M6 4l8 5m-4-6 8 6" /></template>
    <template v-else-if="category === 'mountain'"><path d="m2 20 7-12 4 6 2-4 7 10H2ZM7 11l2 2 2-2" /></template>
    <template v-else-if="category === 'temple'"><path d="M3 9c4 0 6-2 9-5 3 3 5 5 9 5M5 11h14M7 11v9m5-9v9m5-9v9M4 20h16" /></template>
    <template v-else-if="category === 'venue'"><path d="M3 20V9l9-5 9 5v11H3ZM8 20v-7h8v7M3 10h18" /></template>
    <template v-else-if="category === 'night'"><path d="M16 4a8 8 0 1 0 4 14 7 7 0 0 1-4-14ZM5 3v3m-1.5-1.5h3M20 4v2m-1-1h2" /></template>
    <template v-else><path d="M12 21c-1-2-7-7-7-12a7 7 0 0 1 14 0c0 5-6 10-7 12ZM9 9a3 3 0 0 1 5-2" /><circle cx="12" cy="9" r="1" /></template>
  </svg>
</template>

<script setup lang="ts">
import type { PlaceCategory } from '@/types'

defineProps<{ category?: PlaceCategory }>()
</script>
