<template>
  <div class="m-desktop-only">
    <div class="m-desktop-only__card">
      <svg class="m-desktop-only__icon" viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2.5" y="4" width="19" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
      <h2 class="m-desktop-only__title">请在电脑端使用</h2>
      <p class="m-desktop-only__desc">{{ pageName }}涉及大画布与精细操作，暂未适配手机，请用电脑打开以获得完整体验。</p>
      <button type="button" class="m-desktop-only__btn" @click="goHome">返回首页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const pageName = computed(() => String((route.meta as Record<string, unknown>)?.mobileTitle || '该功能'))
const goHome = () => { void router.replace('/') }
</script>

<style scoped>
.m-desktop-only {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-body, var(--bg-surface, #ffffff));
}

.m-desktop-only__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 320px;
}

.m-desktop-only__icon {
  color: var(--text-tertiary, #9aa);
  margin-bottom: 18px;
}

.m-desktop-only__title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #111111);
}

.m-desktop-only__desc {
  margin: 0 0 24px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary, #666666);
}

.m-desktop-only__btn {
  height: 44px;
  padding: 0 28px;
  border: none;
  border-radius: 22px;
  background: var(--brand-main-default, #4d5bff);
  color: #ffffff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
</style>
