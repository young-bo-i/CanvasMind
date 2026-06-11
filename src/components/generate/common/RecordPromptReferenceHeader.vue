<template>
  <div class="record-header-Ji1UfV">
    <div class="record-header-content-dS6EmO">
      <div
        v-if="visibleReferenceImages.length"
        class="record-reference"
        :style="referenceStyleVars"
        role="button"
        title="点击复用到输入框"
        @click="emit('reuse')"
      >
        <div class="reference-background"></div>
        <div class="reference-content single-group">
          <div class="reference-group-GL7NtT" :style="referenceGroupStyle">
            <div
              v-for="(item, index) in visibleReferenceImages"
              :key="`${item.src}-${index}`"
              class="reference-item-KqcMnm"
              :style="buildReferenceItemStyle(index)"
            >
              <div
                class="reference reference-image-FbuFFj"
                :style="buildReferenceCardStyle(index)"
              >
                <img
                  class="image-iZ3_fA"
                  :src="item.src"
                  alt="参考图"
                  loading="lazy"
                  @error="handleReferenceImageError(item.src, index)"
                >
              </div>
            </div>
          </div>
          <div class="quote-icon-container visible-IS5Is5">
            <svg
              class="quote-icon"
              fill="none"
              height="1em"
              preserveAspectRatio="xMidYMid meet"
              role="presentation"
              viewBox="0 0 24 24"
              width="1em"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g>
                <path
                  d="M7.75 8.5c-1.8 1.34-2.75 2.95-2.75 4.82 0 1.69 1.02 3.18 2.85 3.18 1.58 0 2.9-1.2 2.9-2.82 0-1.51-1.05-2.47-2.38-2.72.13-.58.62-1.3 1.57-2.04.95-.74 1.3-.98 1.3-1.65 0-.82-.8-1.42-1.65-1.42-.63 0-1.18.23-1.84.65Zm8 0c-1.8 1.34-2.75 2.95-2.75 4.82 0 1.69 1.02 3.18 2.85 3.18 1.58 0 2.9-1.2 2.9-2.82 0-1.51-1.05-2.47-2.38-2.72.13-.58.62-1.3 1.57-2.04.95-.74 1.3-.98 1.3-1.65 0-.82-.8-1.42-1.65-1.42-.63 0-1.18.23-1.84.65Z"
                  fill="currentColor"
                />
              </g>
            </svg>
          </div>
        </div>
      </div>

      <div
        class="prompt-suffix-labels-wrapper-I8rEI5"
        :class="{ 'is-open': promptOpen }"
        style="--line-height:24px;--padding-top:4px"
        @mouseenter="onPromptEnter"
        @mouseleave="promptOpen = false"
      >
        <div class="prompt-suffix-labels-uZQd1x" style="--line-height:24px;--padding-top:4px" @wheel="onPromptWheel">
          <div class="prompt-suffix-labels-content-D3IiYo">
            <span class="prompt-ZVqVxN">
              <span class="prompt-value-container-JfHRne">
                <span>{{ prompt }}</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 模型 / 功能 / 比例 / 分辨率 / 时长：从提示词中抽出，单独排在最后 -->
    <div v-if="displayLabels.length" class="record-meta-row">
      <span v-for="(label, index) in displayLabels" :key="`${label}-${index}`" class="label-Lt1KEJ">
        {{ label }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

// 点击「引用」(参考图/提示词头部) → 复用该记录内容回填到输入框（对齐即梦）。
const emit = defineEmits<{ (e: 'reuse'): void }>()

// 鼠标移入提示词区域 → 展开为固定高度滚动框（用显式状态而非 :hover，避免展开/滚动时悬停态丢失）。
// 仅当内容确实超出默认 2 行才展开，短提示词不弹出空框。
const promptOpen = ref(false)
const onPromptEnter = (event: MouseEvent) => {
  const wrapper = event.currentTarget as HTMLElement | null
  const box = wrapper?.querySelector('.prompt-suffix-labels-uZQd1x') as HTMLElement | null
  if (box && box.scrollHeight > box.clientHeight + 2) {
    promptOpen.value = true
  }
}

// 展开后用滚轮阅读：直接滚动本框并阻止冒泡，避免滚轮被外层记录列表抢走（导致看似有滚动条却滚不动）。
const onPromptWheel = (event: WheelEvent) => {
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  if (el.scrollHeight <= el.clientHeight) return // 未溢出（未展开/内容短）时不拦截
  el.scrollTop += event.deltaY
  event.preventDefault()
  event.stopPropagation()
}

const props = withDefaults(defineProps<{
  prompt?: string
  model?: string
  ratio?: string
  resolution?: string
  duration?: string
  feature?: string
  referenceImages?: string[]
}>(), {
  prompt: '',
  model: '图片 5.0',
  ratio: '1:1',
  resolution: '2K',
  duration: '',
  feature: '',
  referenceImages: () => [],
})

const maxVisibleCount = 4
const collapsedOffsetX = 12
const rotateList = [-8, 5, -4, 3]
const topOffsetList = [0, 1, 0, 1]
const depthList = [4, 3, 2, 1]

const visibleReferenceImages = computed(() => {
  return (Array.isArray(props.referenceImages) ? props.referenceImages : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(-maxVisibleCount)
    .map(src => ({ src }))
})

const displayLabels = computed(() => {
  return [props.model, props.feature, props.ratio, props.resolution, props.duration]
    .map(item => String(item || '').trim())
    .filter(Boolean)
})

const referenceStyleVars = computed(() => ({
  '--reference-count': String(Math.max(visibleReferenceImages.value.length, 1)),
}))

const referenceGroupStyle = computed(() => ({
  width: `${48 + Math.max(visibleReferenceImages.value.length - 1, 0) * collapsedOffsetX}px`,
  height: '48px',
}))

const buildReferenceItemStyle = (index: number) => {
  const offsetX = index * collapsedOffsetX
  const offsetY = topOffsetList[index] ?? 0
  const zIndex = depthList[index] ?? Math.max(1, maxVisibleCount - index)

  return {
    left: `${offsetX}px`,
    top: `${offsetY}px`,
    zIndex,
  }
}

const buildReferenceCardStyle = (index: number) => {
  const rotate = rotateList[index] ?? (index % 2 === 0 ? -4 : 4)
  return {
    transform: `rotate(${rotate}deg)`,
  }
}

const handleReferenceImageError = (src: string, index: number) => {
  console.warn('[参考图头部][图片加载失败]', {
    序号: index,
    地址前缀: String(src || '').slice(0, 160),
  })
}

</script>

<style scoped>
.record-header-Ji1UfV {
  background: none;
}

.record-header-content-dS6EmO {
  align-items: flex-end;
  color: var(--text-primary);
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  width: 100%;
}

/* 模型/参数元信息行：独立排在提示词下方，靠右对齐 */
.record-meta-row {
  padding: 0 6px;
  margin-bottom: 16px;
  line-height: 22px;
  word-break: break-word;
  text-align: right;
}

.record-reference {
  flex: 0 0 auto;
  height: 48px;
  padding: 4px 8px 8px;
  position: relative;
  width: calc(var(--reference-count) * 36px);
  z-index: 6;
  cursor: pointer;
  transition: filter .2s ease;
}

.record-reference:hover {
  filter: brightness(1.1);
}

.reference-background {
  background: linear-gradient(90deg, var(--bg-body) 82.41%, rgba(15, 15, 18, 0) 98.03%);
  filter: blur(12px);
  height: 76px;
  left: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  transition: width .3s cubic-bezier(.25, .75, .6, 1.1), opacity .3s cubic-bezier(.25, .75, .6, 1.1), transform .3s cubic-bezier(.25, .75, .6, 1.1);
  width: 100%;
  will-change: width, opacity, transform;
}

.reference-content {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  left: 0;
  padding: 7px 20px 8px;
  pointer-events: auto;
  position: absolute;
  top: 0;
  width: 100%;
}

.reference-group-GL7NtT {
  display: flex;
  position: relative;
  transition: transform .3s cubic-bezier(.25, .75, .6, 1.1);
}

.reference-item-KqcMnm {
  border-radius: 4px;
  height: 64px;
  pointer-events: none;
  position: absolute;
  scale: .75;
  transform-origin: 0 0;
  transition: transform .3s cubic-bezier(.25, .75, .6, 1.1);
  width: 48px;
}

.reference.reference-image-FbuFFj {
  background-color: var(--bg-surface);
  border-radius: 4px;
  /* 很窄的小白边，分隔相互叠压的缩略图 */
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-sizing: border-box;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  height: 100%;
  object-fit: cover;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.reference.reference-image-FbuFFj::before {
  background: var(--bg-black);
  content: "";
  height: 100%;
  left: 0;
  opacity: .2;
  position: absolute;
  top: 0;
  width: 100%;
  z-index: 1;
}

.image-iZ3_fA {
  display: block;
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.quote-icon-container {
  align-items: center;
  background-color: var(--bg-float);
  border: 1px solid var(--stroke-tertiary);
  border-radius: 50%;
  bottom: 4px;
  display: flex;
  height: 20px;
  justify-content: center;
  left: 0;
  position: absolute;
  transition: all .3s cubic-bezier(.25, .75, .6, 1.1);
  width: 20px;
}

.quote-icon-container.visible-IS5Is5 {
  opacity: 1;
  visibility: visible;
}

.quote-icon {
  color: var(--text-tertiary);
  height: 12px;
  opacity: .35;
  transform: rotate(-8deg);
  width: 12px;
}

/* 提示词：默认固定 2 行高度；hover 时增高到固定高度 + 滚动条，浮层完整展示（绝对定位，不挤压下方布局），可选中 */
.prompt-suffix-labels-wrapper-I8rEI5 {
  flex-grow: 1;
  min-width: 0;
  position: relative;
  height: 48px;
}

.prompt-suffix-labels-uZQd1x {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--padding-top) 6px;
  height: 48px;
  overflow: hidden;
  border-radius: 8px;
  transition: height .2s ease, background-color .2s ease, box-shadow .2s ease;
}

/* 展开：固定高度的滚动框（显式 height 保证溢出可滚） */
.prompt-suffix-labels-wrapper-I8rEI5.is-open .prompt-suffix-labels-uZQd1x {
  height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg-float, #1e1e24);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 30;
  /* Firefox 常显细滚动条 */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.32) transparent;
}

/* 强制常显滚动条（macOS 默认 overlay 滚动条平时不可见，用户以为没有滚动条） */
.prompt-suffix-labels-uZQd1x::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.prompt-suffix-labels-uZQd1x::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.28);
  border-radius: 4px;
}

.prompt-suffix-labels-uZQd1x::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.45);
}

.prompt-suffix-labels-uZQd1x::-webkit-scrollbar-track {
  background: transparent;
}

.prompt-suffix-labels-content-D3IiYo {
  padding-right: 2px;
  word-break: break-word;
  /* 允许选中已发送的提示词文本 */
  user-select: text;
  -webkit-user-select: text;
}

.prompt-ZVqVxN {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  margin-right: 8px;
  min-width: 0;
  user-select: text;
  -webkit-user-select: text;
}

.prompt-value-container-JfHRne {
  display: inline;
}

.labels-b517mw {
  align-items: center;
  display: inline;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.label-Lt1KEJ {
  color: var(--text-tertiary, rgba(224, 245, 255, 0.45));
  display: inline;
  font-size: 14px;
  font-weight: 400;
  line-height: 24px;
  position: relative;
}

.label-Lt1KEJ:not(:first-child)::before {
  background-color: var(--text-disabled);
  content: " ";
  display: inline-block;
  height: 10px;
  margin: 0 8px;
  width: 1px;
}
</style>
