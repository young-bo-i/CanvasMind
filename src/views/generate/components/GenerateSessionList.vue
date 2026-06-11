<template>
  <div class="record-list-container">
    <div class="record-list record-virtual-list" :style="`--content-generator-height:${contentGeneratorHeight}px`">
      <div
        class="virtual-list-container"
        style="--virtual-list-rotate:rotate(180deg);--virtual-list-direction:rtl;--virtual-list-justify-content:flex-end"
      >
        <div class="scroll-container-j7wUS8" style="height:100%">
          <div ref="scrollContainerRef" class="virtual-list" style="height:100%">
            <div :style="`height:${spacerHeight}`"></div>
            <div
              :id="scrollListId"
              class="scroll-list"
              style="transform:translate3d(0px,0px,0px)"
            >
              <div class="scroll-slot"></div>
              <div class="top-placeholder-fTCjHC">
                <div class="top-placeholder-aEry7y">
                  <div class="clean-agent-context-wrapper">
                    <span
                      class="clean-agent-context-text"
                      @click="emit('create-session')"
                    >
                      {{ createSessionText }}
                    </span>
                  </div>
                  <div class="empty-placeholder"></div>
                </div>
              </div>
              <slot />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="filter-mask"></div>
    <div class="filter-container filter">
      <div class="container-ufW1eH collapsed-HB97Ck">
        <div class="lv-input-group-wrapper lv-input-group-wrapper-default search-input-ZwhOpf">
          <span class="lv-input-group">
            <span class="lv-input-inner-wrapper lv-input-inner-wrapper-has-prefix lv-input-inner-wrapper-default lv-input-clear-wrapper">
              <span class="lv-input-group-prefix">
                <svg
                  class="search-icon-rvzopq search-icon-interactive"
                  fill="none"
                  height="1em"
                  preserveAspectRatio="xMidYMid meet"
                  role="presentation"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                  @click="emit('search')"
                >
                  <g>
                    <path
                      clip-rule="evenodd"
                      d="M4.563 10.75a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm6.5-8.5a8.5 8.5 0 1 0 5.261 15.176l3.406 3.406a1 1 0 0 0 1.415-1.414l-3.407-3.406A8.5 8.5 0 0 0 11.062 2.25Z"
                      data-follow-fill="currentColor"
                      fill="currentColor"
                      fill-rule="evenodd"
                    ></path>
                  </g>
                </svg>
              </span>
              <input
                class="lv-input lv-input-size-default"
                maxlength="100"
                placeholder="搜索"
                :value="searchValue"
                @input="handleSearchInput"
                @keydown.enter="emit('search')"
              >
            </span>
          </span>
        </div>
      </div>
      <span class="separator"></span>
      <el-dropdown trigger="click" popper-class="generate-filter-popper" @command="(val: string) => onFilterSelect('time', val)">
        <div class="container-KL2j0F">
          <span class="trigger-AnFRb7">
            <span class="filter-text-bBfqrS filter-text-MnA06c" :class="{ 'filter-text-active': selectedTime !== 'all' }">{{ timeLabel }}</span>
            <svg class="dropdown-arrow-qZsXaR" fill="none" height="1em" preserveAspectRatio="xMidYMid meet" role="presentation" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
              <g><path clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" data-follow-fill="currentColor" fill="currentColor" fill-rule="evenodd"></path></g>
            </svg>
          </span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="opt in TIME_OPTIONS" :key="opt.value" :command="opt.value" :class="{ 'is-active': selectedTime === opt.value }">{{ opt.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="separator"></span>
      <el-dropdown trigger="click" popper-class="generate-filter-popper" @command="(val: string) => onFilterSelect('type', val)">
        <div class="container-KL2j0F">
          <span class="trigger-AnFRb7">
            <span class="filter-text-bBfqrS" :class="{ 'filter-text-active': selectedType !== 'all' }">{{ typeLabel }}</span>
            <svg class="dropdown-arrow-qZsXaR" fill="none" height="1em" preserveAspectRatio="xMidYMid meet" role="presentation" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
              <g><path clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" data-follow-fill="currentColor" fill="currentColor" fill-rule="evenodd"></path></g>
            </svg>
          </span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="opt in TYPE_OPTIONS" :key="opt.value" :command="opt.value" :class="{ 'is-active': selectedType === opt.value }">{{ opt.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="separator"></span>
      <el-dropdown trigger="click" popper-class="generate-filter-popper" @command="(val: string) => onFilterSelect('action', val)">
        <div class="container-KL2j0F">
          <span class="trigger-AnFRb7">
            <span class="filter-text-bBfqrS" :class="{ 'filter-text-active': selectedAction !== 'all' }">{{ actionLabel }}</span>
            <svg class="dropdown-arrow-qZsXaR" fill="none" height="1em" preserveAspectRatio="xMidYMid meet" role="presentation" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
              <g><path clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" data-follow-fill="currentColor" fill="currentColor" fill-rule="evenodd"></path></g>
            </svg>
          </span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="opt in ACTION_OPTIONS" :key="opt.value" :command="opt.value" :class="{ 'is-active': selectedAction === opt.value }">{{ opt.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(defineProps<{
  contentGeneratorHeight?: number
  spacerHeight?: string
  scrollListId?: string
  createSessionText?: string
  searchValue?: string
  timeFilterLabel?: string
  typeFilterLabel?: string
  actionFilterLabel?: string
}>(), {
  contentGeneratorHeight: 174,
  spacerHeight: '1056.88px',
  scrollListId: 'scroll-list-generate-session',
  createSessionText: '创建新会话',
  searchValue: '',
  timeFilterLabel: '时间',
  typeFilterLabel: '生成类型',
  actionFilterLabel: '操作类型',
})

const emit = defineEmits<{
  'update:searchValue': [value: string]
  search: []
  'create-session': []
  'time-filter-change': [value: string]
  'type-filter-change': [value: string]
  'action-filter-change': [value: string]
  'scroll-state': [payload: { scrollTop: number; isAtBottom: boolean; isScrollingUp: boolean }]
}>()

// 即梦风格筛选项：时间 / 生成类型 / 操作类型（文生 vs 图生）。
const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]
const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'agent', label: '对话' },
  { value: 'research', label: '研究' },
]
const ACTION_OPTIONS = [
  { value: 'all', label: '全部操作' },
  { value: 'text', label: '文生' },
  { value: 'image', label: '图生' },
]

const selectedTime = ref('all')
const selectedType = ref('all')
const selectedAction = ref('all')

// 未选时显示档位名（时间/生成类型/操作类型），选中后显示具体选项。
const timeLabel = computed(() => selectedTime.value === 'all' ? '时间' : (TIME_OPTIONS.find(o => o.value === selectedTime.value)?.label || '时间'))
const typeLabel = computed(() => selectedType.value === 'all' ? '生成类型' : (TYPE_OPTIONS.find(o => o.value === selectedType.value)?.label || '生成类型'))
const actionLabel = computed(() => selectedAction.value === 'all' ? '操作类型' : (ACTION_OPTIONS.find(o => o.value === selectedAction.value)?.label || '操作类型'))

const onFilterSelect = (kind: 'time' | 'type' | 'action', value: string) => {
  if (kind === 'time') {
    selectedTime.value = value
    emit('time-filter-change', value)
  } else if (kind === 'type') {
    selectedType.value = value
    emit('type-filter-change', value)
  } else {
    selectedAction.value = value
    emit('action-filter-change', value)
  }
}

const handleSearchInput = (event: Event) => {
  emit('update:searchValue', String((event.target as HTMLInputElement | null)?.value || ''))
}

// 列表外层使用 transform: rotate(180deg) 实现「最新消息贴底」的对话布局，
// 浏览器原生滚动不感知 transform，默认方向因此与视觉相反。
// 这里统一接管 wheel / touchmove，按视觉方向反向写入 scrollTop，让滚轮、触摸手势与画面方向一致。
const scrollContainerRef = ref<HTMLElement | null>(null)
let lastScrollTop = 0
let touchLastY = 0

// 滚轮/触摸是否落在「内部可滚动元素」（如展开的提示词框）上、且其仍能在该方向继续滚动。
// 列表外层用 capture 接管滚轮，会抢走所有滚轮事件；命中内部可滚动元素时让其原生滚动、列表不劫持。
const innerScrollableCanScroll = (startNode: EventTarget | null, deltaY: number): boolean => {
  const container = scrollContainerRef.value
  let node = startNode as HTMLElement | null
  while (node && node !== container) {
    if (node.nodeType === 1) {
      const overflowY = window.getComputedStyle(node).overflowY
      const scrollable = (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1
      if (scrollable) {
        const atTop = node.scrollTop <= 0
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1
        if (deltaY > 0 && !atBottom) return true
        if (deltaY < 0 && !atTop) return true
      }
    }
    node = node.parentElement
  }
  return false
}

const handleWheel = (event: WheelEvent) => {
  const target = scrollContainerRef.value
  if (!target) return
  // 命中内部可滚动元素（展开的提示词框等）则交给它原生滚动，外层列表不劫持。
  if (innerScrollableCanScroll(event.target, event.deltaY)) return
  event.stopImmediatePropagation()
  event.preventDefault()
  target.scrollTop -= event.deltaY
}

const handleTouchStart = (event: TouchEvent) => {
  touchLastY = event.touches[0]?.clientY ?? 0
}

const handleTouchMove = (event: TouchEvent) => {
  const target = scrollContainerRef.value
  if (!target) return
  const currentY = event.touches[0]?.clientY ?? touchLastY
  const deltaY = touchLastY - currentY
  touchLastY = currentY
  // 命中内部可滚动元素则交给其原生滚动，外层列表不劫持。
  if (innerScrollableCanScroll(event.target, deltaY)) return
  event.stopImmediatePropagation()
  event.preventDefault()
  target.scrollTop -= deltaY
}

const handleScroll = () => {
  const target = scrollContainerRef.value
  if (!target) return
  const currentScrollTop = target.scrollTop
  // 容器旋转 180°：DOM 顶部即视觉底部，scrollTop 接近 0 表示已贴近最新消息一侧。
  const isAtBottom = currentScrollTop <= 10
  // scrollTop 增大表示视口在 DOM 上向下移，对应视觉上向上回看旧消息。
  const isScrollingUp = currentScrollTop > lastScrollTop
  lastScrollTop = currentScrollTop
  emit('scroll-state', { scrollTop: currentScrollTop, isAtBottom, isScrollingUp })
}

const scrollToElementById = (elementId: string) => {
  const container = scrollContainerRef.value
  if (!container || !elementId) {
    return false
  }

  const target = document.getElementById(elementId)
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetCenter = targetRect.top + targetRect.height / 2
  const viewportCenter = containerRect.top + container.clientHeight / 2
  const delta = targetCenter - viewportCenter
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const nextTop = Math.max(0, Math.min(maxScrollTop, container.scrollTop - delta))

  container.scrollTo({
    top: nextTop,
    behavior: 'smooth',
  })

  return true
}

defineExpose({
  scrollToElementById,
})

onMounted(() => {
  const target = scrollContainerRef.value
  if (!target) return
  target.addEventListener('wheel', handleWheel, { passive: false, capture: true })
  target.addEventListener('touchstart', handleTouchStart, { passive: true })
  target.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
  target.addEventListener('scroll', handleScroll, { passive: true })
})

onBeforeUnmount(() => {
  const target = scrollContainerRef.value
  if (!target) return
  target.removeEventListener('wheel', handleWheel, true)
  target.removeEventListener('touchstart', handleTouchStart)
  target.removeEventListener('touchmove', handleTouchMove, true)
  target.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
/* 选中筛选项时高亮档位文字，并让触发器可点击 */
.filter-text-active {
  color: var(--el-color-primary, #7c5cff);
  font-weight: 600;
}

.container-KL2j0F {
  cursor: pointer;
}
</style>
