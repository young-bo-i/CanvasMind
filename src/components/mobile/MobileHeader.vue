<template>
  <header class="m-header">
    <div class="m-header__left">
      <button
        v-if="showBack"
        type="button"
        class="m-header__back"
        aria-label="返回"
        @click="onBack"
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <slot name="left" />
    </div>
    <h1 class="m-header__title">{{ headerTitle }}</h1>
    <div class="m-header__right">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const props = defineProps<{
  title?: string
  showBack?: boolean
}>()

const route = useRoute()
const router = useRouter()

const headerTitle = computed(() => props.title || String((route.meta as Record<string, unknown>)?.mobileTitle || ''))

const onBack = () => {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back()
  } else {
    void router.replace('/')
  }
}
</script>

<style scoped>
.m-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 8px;
  padding-top: env(safe-area-inset-top);
  height: calc(48px + env(safe-area-inset-top));
  background: var(--bg-float, var(--bg-surface, #ffffff));
  border-bottom: 1px solid var(--line-divider, rgba(0, 0, 0, 0.06));
}

.m-header__left,
.m-header__right {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 44px;
}

.m-header__right {
  justify-content: flex-end;
}

.m-header__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--text-primary, #111111);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.m-header__title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #111111);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
