<template>
  <div class="journey-empty">
    <svg class="journey-empty__art" viewBox="0 0 240 104" aria-hidden="true">
      <path class="journey-empty__mist journey-empty__mist--back" d="M2 73C38 42 68 43 98 64c24 16 48 15 72-3 24-18 47-17 68 2" />
      <path class="journey-empty__mist journey-empty__mist--front" d="M2 84c34-18 64-17 91 0 24 15 48 14 72-2 25-16 49-15 73 1" />
      <path class="journey-empty__route" d="M25 88c33-26 58-9 83-24 28-17 49 8 80-13" />
      <circle class="journey-empty__point" cx="25" cy="88" r="3" />
      <circle class="journey-empty__point journey-empty__point--end" cx="188" cy="51" r="4" />
    </svg>
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <button v-if="actionLabel" type="button" @click="$emit('action')">{{ actionLabel }} <span aria-hidden="true">↗</span></button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description: string
  actionLabel?: string
}>()

defineEmits<{ action: [] }>()
</script>

<style scoped>
.journey-empty {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 32px 20px;
  color: var(--cross-ink);
  text-align: center;
}

.journey-empty__art {
  width: min(240px, 72%);
  margin-bottom: 18px;
  overflow: visible;
}

.journey-empty__mist,
.journey-empty__route {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.journey-empty__mist--back { stroke: var(--cross-mountain); stroke-width: 18; stroke-opacity: .14; }
.journey-empty__mist--front { stroke: var(--cross-lake); stroke-width: 22; stroke-opacity: .13; }
.journey-empty__route { stroke: var(--cross-ink); stroke-width: 1.25; stroke-opacity: .55; stroke-dasharray: 4 7; }
.journey-empty__point { fill: var(--cross-moss); opacity: .8; }
.journey-empty__point--end { fill: var(--cross-rust); }

.journey-empty strong { font-size: 15px; font-weight: 560; letter-spacing: .02em; }
.journey-empty p { max-width: 36em; margin: 8px 0 0; color: var(--cross-ink-soft); font-size: 12px; line-height: 1.7; }
.journey-empty button { margin-top: 18px; border: 0; border-bottom: 1px solid var(--cross-ink-faint); background: transparent; color: var(--cross-ink); padding: 4px 1px; font: inherit; font-size: 12px; cursor: pointer; }
.journey-empty button:hover { border-bottom-color: var(--cross-rust); color: var(--cross-rust); }
</style>
