<template>
  <Teleport to="body">
    <Transition name="m-sheet">
      <div v-if="visible" class="m-sheet-root" role="dialog" aria-modal="true">
        <div class="m-sheet-mask" @click="close"></div>
        <div class="m-sheet" :style="{ maxHeight }">
          <div class="m-sheet__handle" @click="close"></div>
          <div v-if="title || $slots.header" class="m-sheet__header">
            <slot name="header"><span class="m-sheet__title">{{ title }}</span></slot>
            <button type="button" class="m-sheet__close" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div class="m-sheet__body">
            <slot></slot>
          </div>
          <div v-if="$slots.footer" class="m-sheet__footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  visible: boolean
  title?: string
  maxHeight?: string
}>(), {
  title: '',
  maxHeight: '82vh',
})

const emit = defineEmits<{ 'update:visible': [value: boolean] }>()
const close = () => emit('update:visible', false)
</script>

<style scoped>
.m-sheet-root {
  position: fixed;
  inset: 0;
  z-index: 11000;
}

.m-sheet-mask {
  position: absolute;
  inset: 0;
  background: var(--bg-mask-30, rgba(0, 0, 0, 0.4));
}

.m-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 16px max(16px, env(safe-area-inset-bottom));
  background: var(--bg-float, var(--bg-surface, #ffffff));
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.22);
}

.m-sheet__handle {
  width: 40px;
  height: 4px;
  margin: 6px auto 4px;
  border-radius: 2px;
  background: var(--line-divider, rgba(0, 0, 0, 0.18));
  cursor: pointer;
}

.m-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 10px;
}

.m-sheet__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #111111);
}

.m-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-tertiary, #999999);
  cursor: pointer;
}

.m-sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.m-sheet__footer {
  flex: 0 0 auto;
  padding-top: 10px;
}

/* 进出场动画 */
.m-sheet-enter-active .m-sheet,
.m-sheet-leave-active .m-sheet {
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
}
.m-sheet-enter-from .m-sheet,
.m-sheet-leave-to .m-sheet {
  transform: translateY(100%);
}
.m-sheet-enter-active .m-sheet-mask,
.m-sheet-leave-active .m-sheet-mask {
  transition: opacity 0.26s ease;
}
.m-sheet-enter-from .m-sheet-mask,
.m-sheet-leave-to .m-sheet-mask {
  opacity: 0;
}
</style>
