<template>
  <nav class="m-tabbar" aria-label="底部导航">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.name"
      :to="tab.to"
      class="m-tabbar__item"
      :class="{ 'is-active': activeName === tab.name, 'is-center': tab.center }"
    >
      <span class="m-tabbar__icon">
        <svg
          viewBox="0 0 24 24" width="22" height="22"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
        >
          <path v-for="(d, i) in tab.paths" :key="i" :d="d" />
        </svg>
      </span>
      <span class="m-tabbar__label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'

const route = useRoute()
const activeName = computed(() => String(route.name || ''))

interface TabItem {
  name: string
  label: string
  to: string
  center?: boolean
  paths: string[]
}

// 固定 4 Tab 信息架构(与桌面 SideMenu 不同,更适合手机):首页 / 创作(中央强调) / 作品 / 我的。
// name 对应 router 路由名,用于高亮。
const TABS: TabItem[] = [
  { name: 'Home', label: '首页', to: '/', paths: ['M3 9.7 12 3l9 6.7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'] },
  { name: 'Generate', label: '创作', to: '/generate', center: true, paths: ['M12 5v14', 'M5 12h14'] },
  { name: 'AssetManagement', label: '作品', to: '/asset', paths: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'] },
  { name: 'AccountManagement', label: '我的', to: '/account', paths: ['M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'] },
]
</script>

<style scoped>
.m-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  align-items: stretch;
  height: calc(54px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-float, var(--bg-surface, #ffffff));
  border-top: 1px solid var(--line-divider, rgba(0, 0, 0, 0.08));
}

.m-tabbar__item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--text-tertiary, #999999);
  text-decoration: none;
  font-size: 11px;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
}

.m-tabbar__item.is-active {
  color: var(--brand-main-default, var(--text-primary, #111111));
}

.m-tabbar__icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 中央「创作」：抬起的品牌圆钮（即梦式中央主创作键） */
.m-tabbar__item.is-center .m-tabbar__icon {
  width: 46px;
  height: 46px;
  margin-top: -18px;
  border-radius: 50%;
  background: var(--brand-main-default, #4d5bff);
  color: #ffffff;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
}

.m-tabbar__item.is-center {
  color: var(--text-secondary, #666666);
}

.m-tabbar__item.is-center.is-active {
  color: var(--brand-main-default, #4d5bff);
}

.m-tabbar__item.is-center.is-active .m-tabbar__icon {
  color: #ffffff;
}
</style>
