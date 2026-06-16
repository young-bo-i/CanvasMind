<script setup lang="ts">
// 选择弹窗组件
// 支持上下弹出方向设置，可自动根据页面空间计算最佳弹出方向

import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useBreakpointStore } from '@/stores/breakpoint'

// 移动端：把锚定弹层整体改为底部 Sheet（即梦式），调用方 API 不变。
const { isMobile } = useBreakpointStore()

// 弹出方向类型
type Placement = 'top' | 'bottom' | 'auto'

// Props 定义
interface Props {
  visible: boolean
  triggerRef: HTMLElement | null
  title?: string
  // 弹出方向：top-向上, bottom-向下, auto-自动计算
  placement?: Placement
  // 追加到弹窗外层的自定义类名
  popupClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  placement: 'auto',
  popupClass: ''
})

// Emits 定义
const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

// 弹窗位置
const popupPosition = ref({ top: 0, left: 0 })

// 弹窗元素引用
const popupRef = ref<HTMLElement | null>(null)

// 实际弹出方向（用于样式控制）
const actualPlacement = ref<'top' | 'bottom'>('top')

// 预估弹窗高度（用于自动计算方向）
const ESTIMATED_POPUP_HEIGHT = 200

// 计算最佳弹出方向
const calculateBestPlacement = (): 'top' | 'bottom' => {
  if (!props.triggerRef) return 'top'

  const rect = props.triggerRef.getBoundingClientRect()

  // 计算上下可用空间
  const spaceAbove = rect.top
  const spaceBelow = window.innerHeight - rect.bottom

  // 如果指定了方向（非 auto），检查是否有足够空间
  if (props.placement !== 'auto') {
    const preferredPlacement = props.placement

    // 检查指定方向是否有足够空间
    if (preferredPlacement === 'bottom' && spaceBelow >= ESTIMATED_POPUP_HEIGHT) {
      return 'bottom'
    }
    if (preferredPlacement === 'top' && spaceAbove >= ESTIMATED_POPUP_HEIGHT) {
      return 'top'
    }

    // 指定方向空间不足，自动切换到有空间的方向
    if (spaceBelow >= ESTIMATED_POPUP_HEIGHT) {
      return 'bottom'
    }
    if (spaceAbove >= ESTIMATED_POPUP_HEIGHT) {
      return 'top'
    }

    // 两边都不够，选择空间更大的方向
    return spaceBelow > spaceAbove ? 'bottom' : 'top'
  }

  // auto 模式：优先向上弹出
  if (spaceAbove < ESTIMATED_POPUP_HEIGHT && spaceBelow >= ESTIMATED_POPUP_HEIGHT) {
    return 'bottom'
  }

  // 如果两边空间都不足，选择空间更大的方向
  if (spaceAbove < ESTIMATED_POPUP_HEIGHT && spaceBelow < ESTIMATED_POPUP_HEIGHT) {
    return spaceBelow > spaceAbove ? 'bottom' : 'top'
  }

  return 'top'
}

// 计算弹窗位置
const updatePopupPosition = () => {
  if (props.triggerRef) {
    const rect = props.triggerRef.getBoundingClientRect()

    // 计算最佳弹出方向
    actualPlacement.value = calculateBestPlacement()

    // 根据弹出方向计算位置
    if (actualPlacement.value === 'bottom') {
      // 向下弹出：弹窗显示在触发器下方
      popupPosition.value = {
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2
      }
    } else {
      // 向上弹出：弹窗显示在触发器上方
      popupPosition.value = {
        top: rect.top - 8,
        left: rect.left + rect.width / 2
      }
    }
  }
}

// 监听弹窗显示状态，更新位置
watch(() => props.visible, (newVal) => {
  if (newVal) {
    nextTick(() => {
      updatePopupPosition()
    })
  }
})

// 点击外部关闭弹窗
const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (props.visible) {
    const popup = popupRef.value
    const trigger = props.triggerRef
    if (popup && !popup.contains(target) && trigger && !trigger.contains(target)) {
      emit('update:visible', false)
    }
  }
}

// 挂载时添加全局事件监听
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('resize', updatePopupPosition)
  window.addEventListener('scroll', updatePopupPosition, true)
})

// 卸载时移除事件监听
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', updatePopupPosition)
  window.removeEventListener('scroll', updatePopupPosition, true)
})
</script>

<template>
  <Teleport to="body">
    <!-- 移动端：底部 Sheet（遮罩 + 上滑面板 + 拖拽手柄），点遮罩关闭。 -->
    <template v-if="visible && isMobile">
      <div class="lv-sheet-mask" @click="emit('update:visible', false)"></div>
      <div class="lv-sheet" :class="props.popupClass" role="dialog">
        <div class="lv-sheet__handle" @click="emit('update:visible', false)"></div>
        <div v-if="title" class="lv-sheet__title">{{ title }}</div>
        <div class="lv-sheet__body">
          <slot></slot>
        </div>
      </div>
    </template>

    <!-- 桌面端：原锚定弹层。 -->
    <div v-else-if="visible"
         ref="popupRef"
         :class="['lv-select-popup', `placement-${actualPlacement}`, props.popupClass]"
         tabindex="-1"
         :style="{
           position: 'fixed',
           top: popupPosition.top + 'px',
           left: popupPosition.left + 'px',
           transform: actualPlacement === 'bottom' ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
           zIndex: 10001
         }">
      <!-- 标题 -->
      <div v-if="title" class="title-RK9CLE dropdown-title secondary-IGs0cX">{{ title }}</div>
      <!-- 内容插槽 -->
      <slot></slot>
    </div>
  </Teleport>
</template>

<style>
/* 桌面端弹层样式在 generate.css 中定义；以下仅移动端 Sheet。 */
.lv-sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: var(--bg-mask-30, rgba(0, 0, 0, 0.4));
  animation: lv-sheet-fade 0.18s ease;
}

.lv-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10001;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  padding: 6px 14px max(16px, env(safe-area-inset-bottom));
  background: var(--bg-float, var(--bg-surface, #ffffff));
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.22);
  animation: lv-sheet-up 0.24s cubic-bezier(0.32, 0.72, 0, 1);
}

.lv-sheet__handle {
  width: 40px;
  height: 4px;
  margin: 6px auto 8px;
  border-radius: 2px;
  background: var(--line-divider, rgba(0, 0, 0, 0.18));
  cursor: pointer;
}

.lv-sheet__title {
  flex: 0 0 auto;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #111111);
  padding-bottom: 8px;
}

.lv-sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

@keyframes lv-sheet-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes lv-sheet-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
