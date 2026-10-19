<template>
  <span class="cross-companion" :class="`is-${status}`" role="img" :aria-label="label">
    <svg viewBox="-53 -119 80 80" aria-hidden="true">
      <g class="companion-hair">
        <path d="M-6-102C-18-108-30-104-38-92C-42-86-40-80-36-76" />
        <path d="M-2-104C-14-113-28-111-36-101M2-101C-6-106-15-104-21-97" />
        <path d="M-4-96C-14-96-22-90-26-82" />
      </g>
      <g class="companion-head">
        <path d="M-6-99C-9-92-5-84 3-84C11-84 15-91 12-98C10-104 1-107-5-103C-7-101-8-99-8-97" />
      </g>
      <g class="companion-neck">
        <path d="M-2-84C-4-81-3-78-3-74M6-85C8-82 7-78 7-75" />
        <path d="M-8-73C-14-64-19-58-22-50M10-73C13-66 15-58 16-52" />
      </g>
      <circle class="companion-lamp-halo" cx="18" cy="-91" r="7" />
      <circle class="companion-lamp" cx="18" cy="-91" r="2.2" />
    </svg>
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  status?: 'idle' | 'thinking' | 'complete' | 'error'
  label?: string
}>(), {
  status: 'idle',
  label: 'CROSS 旅伴'
})
</script>

<style scoped>
.cross-companion {
  display: inline-flex;
  width: 46px;
  height: 46px;
  align-items: center;
  justify-content: center;
  color: var(--cross-ink);
}

svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.companion-hair { opacity: .62; transform-origin: -5px -98px; }
.companion-head { opacity: .9; transform-origin: 2px -94px; }
.companion-neck { opacity: .76; transform-origin: 2px -78px; }
.companion-lamp,
.companion-lamp-halo { stroke: none; opacity: 0; }
.companion-lamp { fill: var(--cross-rust); }
.companion-lamp-halo { fill: rgba(155, 75, 62, .15); }

.is-thinking .companion-head { animation: companion-look-down 1.8s ease-in-out infinite; }
.is-thinking .companion-hair { animation: companion-hair-drift 2.2s ease-in-out infinite; }
.is-complete .companion-lamp { animation: companion-lamp-on 1.4s ease-out 1 both; }
.is-complete .companion-lamp-halo { animation: companion-halo-on 1.4s ease-out 1 both; }
.is-error { color: var(--cross-rust); }

@keyframes companion-look-down {
  50% { transform: translate(1px, 1px) rotate(3deg); }
}

@keyframes companion-hair-drift {
  50% { transform: translateX(-1.5px) rotate(-1.5deg); }
}

@keyframes companion-lamp-on {
  0% { opacity: 0; transform: scale(.5); }
  28%, 72% { opacity: 1; transform: scale(1); }
  100% { opacity: .72; transform: scale(.86); }
}

@keyframes companion-halo-on {
  0% { opacity: 0; transform: scale(.35); }
  35% { opacity: 1; transform: scale(1); }
  100% { opacity: .35; transform: scale(.82); }
}

@media (prefers-reduced-motion: reduce) {
  .is-thinking .companion-head,
  .is-thinking .companion-hair,
  .is-complete .companion-lamp,
  .is-complete .companion-lamp-halo { animation: none; }
  .is-complete .companion-lamp { opacity: .72; }
  .is-complete .companion-lamp-halo { opacity: .35; }
}
</style>
