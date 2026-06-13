<template>
  <div v-if="visible" class="admin-dialog-mask" @click="handleMaskClick">
    <div
      ref="dialogRef"
      class="admin-dialog"
      :class="panelClass"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      @click.stop
    >
      <div class="admin-dialog__header">
        <div>
          <h3 class="admin-dialog__title">{{ title }}</h3>
          <div v-if="description" class="admin-dialog__desc">{{ description }}</div>
        </div>
        <button class="admin-dialog__close" type="button" :disabled="closeDisabled" @click="handleClose">×</button>
      </div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  visible: boolean
  title: string
  description?: string
  panelClass?: string | string[] | Record<string, boolean>
  closeOnMask?: boolean
  closeDisabled?: boolean
}>(), {
  description: '',
  panelClass: '',
  closeOnMask: true,
  closeDisabled: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

const handleClose = () => {
  if (props.closeDisabled) {
    return
  }
  emit('update:visible', false)
  emit('close')
}

const handleMaskClick = () => {
  if (!props.closeOnMask) {
    return
  }
  handleClose()
}

// 弹层根节点，用于聚焦与 Tab 焦点环捕获。
const dialogRef = ref<HTMLElement | null>(null)

// 可聚焦元素选择器，和首页详情弹层保持一致。
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 打开前的焦点，用于关闭后还原。
let focusBeforeOpen: Element | null = null

// 收集弹层内当前可聚焦元素。
const getFocusableElements = (): HTMLElement[] => {
  const root = dialogRef.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[inert]'),
  )
}

// 键盘：Esc 关闭（等同遮罩/关闭按钮）；Tab/Shift+Tab 在弹层内循环。
const onDocumentKeydown = (event: KeyboardEvent) => {
  if (!props.visible) return
  if (event.key === 'Escape') {
    event.preventDefault()
    handleClose()
    return
  }
  if (event.key !== 'Tab') return
  const list = getFocusableElements()
  if (list.length === 0) {
    // 无可聚焦子元素时，把焦点锁在弹层本身。
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement
  if (event.shiftKey) {
    if (active === first || !(active instanceof HTMLElement) || !list.includes(active)) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last || !(active instanceof HTMLElement) || !list.includes(active)) {
    event.preventDefault()
    first.focus()
  }
}

const teardownDialogChrome = () => {
  document.removeEventListener('keydown', onDocumentKeydown, true)
  if (focusBeforeOpen instanceof HTMLElement) {
    focusBeforeOpen.focus()
  }
  focusBeforeOpen = null
}

// 打开：记录原焦点、注册 Esc/Tab、聚焦弹层；关闭：还原焦点并解绑。
watch(
  () => props.visible,
  (open) => {
    document.removeEventListener('keydown', onDocumentKeydown, true)
    if (open) {
      focusBeforeOpen = document.activeElement
      document.addEventListener('keydown', onDocumentKeydown, true)
      void nextTick(() => {
        const list = getFocusableElements()
        if (list.length) {
          list[0].focus()
        } else {
          dialogRef.value?.focus()
        }
      })
    } else {
      teardownDialogChrome()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  teardownDialogChrome()
})
</script>
