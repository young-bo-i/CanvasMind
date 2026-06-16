<template>
  <div class="m-layout" :data-tabbar="showTabBar ? 'on' : 'off'" :data-header="showHeader ? 'on' : 'off'">
    <MobileHeader v-if="showHeader" :title="headerTitle" :show-back="showBack">
      <template #left><slot name="header-left" /></template>
      <template #actions><slot name="header-actions" /></template>
    </MobileHeader>

    <main class="m-layout__main">
      <slot />
    </main>

    <BottomTabBar v-if="showTabBar" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import MobileHeader from './MobileHeader.vue'
import BottomTabBar from './BottomTabBar.vue'

// 视图可显式覆盖外壳;不传则按路由 meta / 是否 Tab 路由自动判定。
const props = defineProps<{
  header?: boolean
  tabbar?: boolean
  title?: string
}>()

const route = useRoute()

// 4 个底部 Tab 对应的路由名（与 BottomTabBar 保持一致）。
const TAB_ROUTE_NAMES = ['Home', 'Generate', 'AssetManagement', 'AccountManagement']
const isTabRoute = computed(() => TAB_ROUTE_NAMES.includes(String(route.name || '')))

const headerTitle = computed(() => props.title || String((route.meta as Record<string, unknown>)?.mobileTitle || ''))

// Tab 路由是根级，不显示返回；非 Tab 路由显示返回。
const showBack = computed(() => !isTabRoute.value)
// 默认：有标题就显示顶栏；视图可用 :header 显式控制。
const showHeader = computed(() => (props.header !== undefined ? props.header : Boolean(headerTitle.value)))
// 默认：仅 4 个 Tab 路由显示底部导航；视图可用 :tabbar 显式控制。
const showTabBar = computed(() => (props.tabbar !== undefined ? props.tabbar : isTabRoute.value))
</script>

<style scoped>
.m-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--bg-body, var(--bg-surface, #ffffff));
  overflow: hidden;
}

.m-layout__main {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

/* 给底部 Tab 留出滚动余量，避免内容被遮住。 */
.m-layout[data-tabbar='on'] .m-layout__main {
  padding-bottom: calc(54px + env(safe-area-inset-bottom));
}
</style>
