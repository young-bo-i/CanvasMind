<template>
  <!-- 移动端:统一切到移动外壳(底部 Tab + 顶栏 + 滚动区),复用同一份 slot/视图,不动路由与业务。 -->
  <MobileLayout v-if="isMobile">
    <slot />
  </MobileLayout>

  <div
    v-else
    class="frontstage-page-shell"
    :class="[`frontstage-page-shell--${layoutModeClass}`]"
    :data-layout-mode="layoutModeClass"
  >
    <div id="csr-root">
      <div class="global-dreamina-container">
        <div id="dreamina" class="root_bf55f">
          <div class="top-down-layer">
            <div
              class="container-moSF_y"
              :style="sideMenuStyleVars"
              :data-layout-mode="layoutModeClass"
            >
              <TopMenuBar v-if="isTopMenuLayout" />
              <SideMenu v-else />
              <slot v-if="layout === 'raw'" />
              <div v-else class="content-wrapper-cF1zaN">
                <div :id="mainContainerId || undefined" class="main-container-nXfW_A">
                  <div class="content-TZbgMr" :data-content-scroll-y="contentScrollY">
                    <slot />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 移动/桌面共用的覆盖层插槽(弹窗/浮层等),两端都渲染。 -->
  <slot name="after" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SideMenu from '@/components/home/components/SideMenu.vue'
import TopMenuBar from '@/components/home/components/TopMenuBar.vue'
import MobileLayout from '@/components/mobile/MobileLayout.vue'
import { useHomeSideMenuConfig } from '@/composables/useHomeSideMenuConfig'
import { useBreakpointStore } from '@/stores/breakpoint'

withDefaults(defineProps<{
  layout?: 'standard' | 'raw'
  mainContainerId?: string
  contentScrollY?: 'auto' | 'hidden'
}>(), {
  layout: 'standard',
  mainContainerId: '',
  contentScrollY: 'auto',
})

const { isMobile } = useBreakpointStore()
const { sideMenuStyleVars, layoutMode } = useHomeSideMenuConfig()
const isTopMenuLayout = computed(() => layoutMode.value === 'top')
const layoutModeClass = computed(() => (isTopMenuLayout.value ? 'top' : 'side'))
</script>

<style scoped>
:deep(.content-TZbgMr) {
  overflow-x: hidden;
}

:deep(.content-TZbgMr[data-content-scroll-y='auto']) {
  overflow-y: auto;
}

:deep(.content-TZbgMr[data-content-scroll-y='hidden']) {
  overflow-y: hidden !important;
}

.frontstage-page-shell[data-layout-mode='top'] :deep(.container-moSF_y) {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.frontstage-page-shell[data-layout-mode='top'] :deep(.content-wrapper-cF1zaN),
.frontstage-page-shell[data-layout-mode='top'] :deep(.main-container-nXfW_A),
.frontstage-page-shell[data-layout-mode='top'] :deep(.content-TZbgMr) {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.frontstage-page-shell[data-layout-mode='top'] :deep(.entry-erESAd),
.frontstage-page-shell[data-layout-mode='top'] :deep(.entry-lav5_s) {
  height: 100%;
  min-height: 0;
}

.frontstage-page-shell[data-layout-mode='top'] :deep(.record-list-container) {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
