import { computed, ref } from 'vue'

/**
 * 视口断点 store（移动端/桌面端判定的唯一来源）。
 *
 * - 断点锚定 768px：宽度 < 768 视为移动端，与 Tailwind 默认 `md`(768) 对齐。
 * - 沿用本项目 store 范式：模块级 ref + 单监听 + 导出 useXxxStore()（参照 theme-preference.ts）。
 * - 不要命名 useViewport —— src/composables/useViewport.ts 已被画布 pan/zoom 占用。
 *
 * data-device 属性由 App.vue 依据 isMobile 写到 <html>，CSS 可据此无 JS 反应。
 */

// 移动端最大宽度（含）：与 Tailwind md(768) 对齐 —— <768 为移动端。
const MOBILE_MAX_WIDTH = 767
// 平板上界（不含）：[768,1024) 视为平板，>=1024 为桌面。
const DESKTOP_MIN_WIDTH = 1024

const isClient = () => typeof window !== 'undefined'

const width = ref<number>(isClient() ? window.innerWidth : 1280)
let listenerBound = false

const sync = () => {
  if (isClient()) {
    width.value = window.innerWidth
  }
}

const bindListener = () => {
  if (!isClient() || listenerBound) {
    return
  }
  listenerBound = true
  window.addEventListener('resize', sync, { passive: true })
  // 横竖屏切换部分机型只触发 orientationchange，兜底。
  window.addEventListener('orientationchange', sync, { passive: true })
  sync()
}

export function useBreakpointStore() {
  bindListener()

  return {
    width: computed(() => width.value),
    isMobile: computed(() => width.value <= MOBILE_MAX_WIDTH),
    isTablet: computed(() => width.value > MOBILE_MAX_WIDTH && width.value < DESKTOP_MIN_WIDTH),
    isDesktop: computed(() => width.value >= DESKTOP_MIN_WIDTH),
  }
}
