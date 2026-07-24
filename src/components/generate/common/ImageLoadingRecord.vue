<template>
  <div class="responsive-container-msS_cP responsive-container-NBoaUU">
    <div class="content-DPogfx ai-generated-record-content-hg5EL8">
      <div v-if="time" class="group-title">{{ time }}</div>
      <div class="image-record">
        <!-- 头部：提示词和标签 -->
        <div class="record-header">
          <RecordPromptReferenceHeader
            :prompt="prompt"
            :model="model"
            :ratio="ratio"
            :resolution="resolution"
            :duration="duration"
            :feature="feature"
            :reference-images="referenceImages"
            @reuse="$emit('make-same')"
          />
        </div>
        <div
          v-if="renderedConversationEntries.length"
          class="process-group completed-Mr7mg1 image-stage-process-group"
          :class="{ 'expanded-bG3kBU': conversationExpanded }"
        >
          <div class="header-fE7Yzl" @click="conversationExpanded = !conversationExpanded">
            <div class="header-left-OUNZfc">
              <div class="chevron-wrapper" :class="{ 'collapsed-yhY7l2': !conversationExpanded }">
                <svg width="14" height="14" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg" class="chevron-icon-OYUM9U">
                  <g>
                    <path data-follow-fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" fill="currentColor"></path>
                  </g>
                </svg>
              </div>
              <div class="title-lQ3lE5">生成进度</div>
            </div>
            <div class="image-stage-process-group__summary">
              {{ renderedConversationEntries[currentStageIndex]?.text || '等待进度更新' }}
            </div>
          </div>
          <div class="content-wrapper-WwWXWE" :class="{ 'collapsed-yhY7l2': !conversationExpanded }">
            <div class="content-e0iN2u">
              <div class="visible-messages-wrapper">
                <div
                  v-for="(entry, index) in renderedConversationEntries"
                  :key="`${index}-${entry.stageKey}`"
                  class="message-item"
                >
                  <div class="connector"></div>
                  <div class="message-collapse-wrapper-zmpysd">
                    <div class="node-viewport-KqQuYn">
                      <div
                        class="reasoning-message reasoning-message-expanded node-enter-g30LTv image-stage-reasoning-message"
                        :class="[
                          `reasoning-tone-${resolveStageTone(entry.stageKey)}`,
                          { 'image-stage-reasoning-message--current': index === currentStageIndex },
                        ]"
                      >
                        <div class="header-k72pQ0" :class="`header-tone-${resolveStageTone(entry.stageKey)}`">
                          <div class="header-main">
                            <span class="status-icon">
                              <span class="image-stage-conversation-item__dot" :class="{ 'image-stage-conversation-item__dot--active': index === currentStageIndex }"></span>
                            </span>
                            <span class="title-zHQmQJ image-stage-title">
                              {{ resolveStageTitle(entry.stageKey, index) }}
                            </span>
                            <span
                              v-if="index === currentStageIndex"
                              class="section-tone-badge image-stage-current-badge"
                              :class="`section-tone-badge-${resolveStageTone(entry.stageKey)}`"
                            >
                              当前
                            </span>
                          </div>
                        </div>
                        <div class="body-wrapper" :style="{ maxHeight: 'none' }">
                          <div class="body-KixLFC">
                            <div class="content-dherTv image-stage-content">
                              <div class="image-stage-conversation-item__text">{{ entry.text }}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="record-box-wrapper">
          <!-- 错误状态 -->
          <div v-if="error" class="image-error-container">
            <div class="image-error-content">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{{ error }}</span>
            </div>
          </div>
          <div v-else-if="stopped" class="image-error-container">
            <div class="image-error-content">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M8 8h8v8H8zM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>已停止生成</span>
            </div>
          </div>
          <!-- 生成完成：显示图片 -->
          <div v-else-if="done && images.length" class="image-record-content">
            <div class="responsive-image-grid">
              <div v-for="(url, i) in images" :key="i"
                   class="image-card-wrapper landscape"
                   :style="`--aspect-ratio:${aspectRatio}`">
                <div class="image-record-item">
                  <div class="context-menu-trigger-WJ6VDZ">
                    <div class="slot-card-container-gulhrr image-card-container-dFemyw">
                      <div class="content-container-z0JOWv">
                        <div
                          class="image-card-container-qy7ui4 image-card-preview-trigger"
                          role="button"
                          tabindex="0"
                          :aria-label="`预览生成图片 ${i + 1}`"
                          @click="handlePreview(i)"
                          @keydown.enter.prevent="handlePreview(i)"
                          @keydown.space.prevent="handlePreview(i)"
                        >
                          <div class="container-bG3PQ9 image-GnB1sY">
                            <div style="transition:opacity 300ms;opacity:1">
                              <img class="image-TLmgkP"

                                   draggable="false"
                                   loading="lazy"
                                   decoding="async"
                                   :src="buildThumbnailUrl(url, 960)" />
                            </div>
                          </div>
                        </div>
                        <button
                          class="image-card-download-button"
                          type="button"
                          :aria-label="`下载第 ${i + 1} 张原图`"
                          title="下载原图"
                          @click.stop="$emit('download', i)"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                          <span>下载原图</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- 加载中 -->
          <div v-else class="image-record-content">
            <div class="responsive-image-grid">
              <div v-for="i in count" :key="i"
                   class="image-card-wrapper landscape"
                   :style="`--aspect-ratio:${aspectRatio}`">
                <div class="image-record-item"></div>
              </div>
              <!-- 加载动画覆盖层 -->
              <div class="loading-container-VeCJoq">
                <div class="animation-wrapper">
                  <div class="loading-shimmer"></div>
                </div>
              </div>
              <!-- 网格分割线 -->
              <div class="divider-container vertical-divider-container">
                <div v-for="i in (count - 1)" :key="i" class="vertical-divider"
                     :style="`left:${(i / count) * 100}%;transform:translateX(-50%)`"></div>
              </div>
            </div>
            <!-- 进度徽章 -->
            <div class="progress-badge-RuihdC progress-badge-RQDqWu">
              {{ currentProgress }}%{{ currentProgressText || '造梦中' }}
            </div>
          </div>
          <div v-if="done && !error" class="operations">
            <div class="record-bottom-slots-AYv3JV">
              <div>
                <div class="card-bottom-button-view-xY_JqR"
                     style="--right-padding:14px"
                     @click="$emit('edit')">
                  <div class="icon-Eb0kRz">
                    <svg fill="none"
                         height="1em"
                         preserveAspectRatio="xMidYMid meet"
                         role="presentation"
                         viewBox="0 0 24 24"
                         width="1em"
                         xmlns="http://www.w3.org/2000/svg">
                      <g>
                        <path clip-rule="evenodd"
                              d="M3.764 8.02a2.5 2.5 0 0 1 2.5-2.5H17.03a2.5 2.5 0 0 1 2.5 2.5V9.8a3.25 3.25 0 0 1 2-.082V8.019a4.5 4.5 0 0 0-4.5-4.5H6.264a4.5 4.5 0 0 0-4.5 4.5v7.932a4.5 4.5 0 0 0 4.5 4.5h5.837a2.436 2.436 0 0 1-.05-.57v-1.43H6.263a2.5 2.5 0 0 1-2.5-2.5V8.019Zm17.67 3.964a1 1 0 0 0-1.41-.004l-5.773 5.707a.25.25 0 0 0-.074.178v2.366c0 .138.112.25.25.25h2.347a.25.25 0 0 0 .178-.075l5.71-5.791a1 1 0 0 0-.006-1.41l-1.221-1.22Z"
                              data-follow-fill="currentColor"
                              fill="currentColor"
                              fill-rule="evenodd"></path>
                      </g>
                    </svg>
                  </div>
                  <div>重新编辑</div>
                </div>
              </div>
              <div>
                <div class="card-bottom-button-view-xY_JqR"
                     style="--right-padding:14px"
                     @click="$emit('regenerate')">
                  <div class="icon-Eb0kRz">
                    <svg fill="none"
                         height="1em"
                         preserveAspectRatio="xMidYMid meet"
                         role="presentation"
                         viewBox="0 0 24 24"
                         width="1em"
                         xmlns="http://www.w3.org/2000/svg">
                      <g>
                        <path clip-rule="evenodd"
                              d="m8.56 5.726 3.948-2.776a.5.5 0 0 1 .788.41v2.23h2.72v2H9.187a.996.996 0 0 1-.631-.225c-.518-.367-.61-1.208.003-1.64Zm10.775 9.213a1 1 0 1 0 1.5 1.323 6.403 6.403 0 0 0 1.605-4.249 6.403 6.403 0 0 0-1.606-4.249 6.41 6.41 0 0 0-4.817-2.174v2a4.41 4.41 0 0 1 3.318 1.498 4.403 4.403 0 0 1 1.105 2.925 4.403 4.403 0 0 1-1.105 2.926Zm-14.67-5.88a1 1 0 1 0-1.5-1.323 6.403 6.403 0 0 0-1.605 4.249c0 1.628.607 3.117 1.606 4.25a6.41 6.41 0 0 0 4.817 2.174v-2a4.41 4.41 0 0 1-3.318-1.498 4.403 4.403 0 0 1-1.105-2.926c0-1.123.416-2.145 1.105-2.926Zm3.318 9.35h2.404v2.232a.5.5 0 0 0 .788.409l3.962-2.785a.816.816 0 0 0 .066-.05.999.999 0 0 0-.591-1.806H7.983v2Z"
                              data-follow-fill="currentColor"
                              fill="currentColor"
                              fill-rule="evenodd"></path>
                      </g>
                    </svg>
                  </div>
                  <div>再次生成</div>
                </div>
              </div>
              <div class="operation-button-oVtvlN normal-button-mS74ha"
                   @click="$emit('more')">
                <span class="icon-oB5C0a">
                  <svg fill="none"
                       height="1em"
                       preserveAspectRatio="xMidYMid meet"
                       role="presentation"
                       viewBox="0 0 24 24"
                       width="1em"
                       xmlns="http://www.w3.org/2000/svg">
                    <g>
                      <path clip-rule="evenodd"
                            d="M7 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm7 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm5 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
                            data-follow-fill="currentColor"
                            fill="currentColor"
                            fill-rule="evenodd"></path>
                    </g>
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, type PropType } from 'vue'
import RecordPromptReferenceHeader from './RecordPromptReferenceHeader.vue'
import { buildThumbnailUrl } from '@/api/http'

/**
 * 图片生成阶段对话节点。
 * stageKey 用于映射节点标题与状态色，text 用于展示实际阶段文案。
 */
interface ConversationEntry {
  stageKey?: string
  text?: string
}

const props = defineProps({
  /** 分组时间 */
  time: { type: String, default: '' },
  /** 提示词 */
  prompt: { type: String, default: '' },
  /** 模型版本 */
  model: { type: String, default: '图片 5.0' },
  /** 宽高比标签 */
  ratio: { type: String, default: '1:1' },
  /** 分辨率标签 */
  resolution: { type: String, default: '2K' },
  /** 时长（视频模式） */
  duration: { type: String, default: '' },
  /** 功能（视频模式） */
  feature: { type: String, default: '' },
  /** 输入参考图 */
  referenceImages: { type: Array as PropType<string[]>, default: () => [] },
  /** 生成图片数量 */
  count: { type: Number, default: 4 },
  /** 图片宽高比数值 */
  aspectRatio: { type: Number, default: 1 },
  /** 初始进度百分比 */
  progress: { type: Number, default: 0 },
  /** 进度文案 */
  progressText: { type: String, default: '' },
  /** 是否生成完成 */
  done: { type: Boolean, default: false },
  /** 是否主动停止 */
  stopped: { type: Boolean, default: false },
  /** 生成的图片 URL 列表 */
  images: { type: Array as PropType<string[]>, default: () => [] },
  /** 错误信息 */
  error: { type: String, default: '' },
  /** 阶段对话列表 */
  conversationEntries: { type: Array as PropType<ConversationEntry[]>, default: () => [] }
})

const emit = defineEmits(['edit', 'regenerate', 'more', 'preview', 'download', 'make-same'])

const handlePreview = (index: number) => {
  emit('preview', index)
}

const currentProgress = ref(props.progress)
const currentProgressText = ref(props.progressText)
const conversationExpanded = ref(true)
const currentStageTypedText = ref('')
let timer: ReturnType<typeof setInterval> | null = null
// 性能(evt-5)：打字机改用 rAF（按 elapsed 时间一次显示多字符），把更新封顶到屏幕刷新率、
// 标签页后台时自动暂停，取代 18ms setInterval 的固定 ~55Hz 逐字 reactive 写入（多并发卡片成倍）。
let typingRaf: ReturnType<typeof requestAnimationFrame> | null = null
let typingLastAt = 0

// 按真实执行顺序展示阶段，便于从上到下阅读完整流程。
const orderedConversationEntries = computed(() => {
  const items = Array.isArray(props.conversationEntries) ? props.conversationEntries as ConversationEntry[] : []
  return [...items]
    .map(item => ({
      stageKey: String(item?.stageKey || '').trim(),
      text: String(item?.text || '').trim(),
    }))
    .filter(item => item.text)
})

// 当前阶段始终取最后一个节点。
const currentStageIndex = computed(() => Math.max(orderedConversationEntries.value.length - 1, 0))

// 仅当前阶段走打字机效果，历史阶段直接展示完整文本。
const renderedConversationEntries = computed(() => {
  return orderedConversationEntries.value.map((entry, index) => (
    index === currentStageIndex.value
      ? { ...entry, text: currentStageTypedText.value || '' }
      : entry
  ))
})

// 复用后台阶段键作为标题来源，让图片流程和配置中心保持一致。
const resolveStageTitle = (stageKey: string, index: number) => {
  switch (stageKey) {
    case 'queued':
      return '排队中'
    case 'resolved_provider':
      return '准备中'
    case 'requesting_upstream':
      return '生成中'
    case 'receiving_upstream_result':
      return '解析中'
    case 'syncing_record':
      return '同步中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '生成失败'
    case 'failing':
      return '失败收尾'
    case 'stopping':
      return '停止中'
    case 'stopped':
      return '已停止'
    default:
      return index === 0 ? '当前阶段' : '阶段更新'
  }
}

// 为流程节点补上运行态、成功态和异常态，和技能流程保持一致。
const resolveStageTone = (stageKey: string) => {
  switch (stageKey) {
    case 'completed':
      return 'success'
    case 'failed':
    case 'failing':
    case 'stopped':
    case 'stopping':
      return 'warning'
    default:
      return 'running'
  }
}

// 图片进度是「粗粒度阶段映射」而非上游真实细粒度进度：仅靠 SSE 阶段事件驱动，会在
// 最耗时的 requesting_upstream 阶段（4K 出图 30~90s、期间无新事件）长时间静止，被误判为卡死。
// 因此本地定时器始终在「当前阶段目标之上」留一段软带宽平滑爬升，填补阶段间静止空档（封顶 99）。
const startTimer = () => {
  if (timer) return
  timer = setInterval(() => {
    if (props.done || props.error || props.stopped) { stopTimer(); return }
    const target = Number.isFinite(Number(props.progress)) ? Number(props.progress) : 0
    const ceiling = Math.min(99, Math.max(target, currentProgress.value, 1) + 18)
    if (currentProgress.value < ceiling) {
      const remaining = ceiling - currentProgress.value
      const step = Math.max(1, Math.floor(remaining * 0.08))
      currentProgress.value = Math.min(ceiling, currentProgress.value + step)
    }
  }, 800)
}

const stopTimer = () => {
  if (timer) { clearInterval(timer); timer = null }
}

const stopTypingTimer = () => {
  if (typingRaf !== null) {
    cancelAnimationFrame(typingRaf)
    typingRaf = null
  }
  typingLastAt = 0
}

// 当前阶段文案使用轻量打字机效果，模拟 SSE 流式吐字感。
const syncCurrentStageTypingText = () => {
  const currentEntry = orderedConversationEntries.value[currentStageIndex.value]
  const nextText = String(currentEntry?.text || '')
  if (!nextText) {
    stopTypingTimer()
    currentStageTypedText.value = ''
    return
  }

  const baseText = nextText.startsWith(currentStageTypedText.value)
    ? currentStageTypedText.value
    : ''

  stopTypingTimer()
  currentStageTypedText.value = baseText

  if (currentStageTypedText.value === nextText) {
    return
  }

  // 原速约 18ms/字 ≈ 55 字/秒；用 elapsed 时间换算每帧应揭示的字符数。
  const charsPerMs = 1 / 18
  typingLastAt = 0
  const step = (ts: number) => {
    if (!typingLastAt) typingLastAt = ts
    const currentLength = currentStageTypedText.value.length
    if (currentLength >= nextText.length) {
      typingRaf = null
      typingLastAt = 0
      return
    }
    const revealCount = Math.max(1, Math.floor((ts - typingLastAt) * charsPerMs))
    const nextLength = Math.min(nextText.length, currentLength + revealCount)
    if (nextLength > currentLength) {
      currentStageTypedText.value = nextText.slice(0, nextLength)
      typingLastAt = ts
    }
    typingRaf = currentStageTypedText.value.length >= nextText.length
      ? null
      : requestAnimationFrame(step)
  }
  typingRaf = requestAnimationFrame(step)
}

// 完成时停止进度条
watch(() => props.done, (val) => {
  if (val) stopTimer()
})

watch(() => props.error, (val) => {
  if (val) stopTimer()
})

watch(() => props.stopped, (val) => {
  if (val) stopTimer()
})

watch(() => props.progress, (val) => {
  // 阶段推进只前进不后退：跳到新的阶段目标，本地爬升继续在其之上填充空档。
  const next = Number.isFinite(Number(val)) ? Number(val) : 0
  currentProgress.value = Math.max(currentProgress.value, next)
  if (!props.done && !props.error && !props.stopped && !timer) {
    startTimer()
  }
})

watch(() => props.progressText, (val) => {
  currentProgressText.value = val || ''
  if (!props.done && !props.error && !props.stopped && !timer) {
    startTimer()
  }
})

watch(
  () => orderedConversationEntries.value.map(item => `${item.stageKey}:${item.text}`).join('\n'),
  () => {
    syncCurrentStageTypingText()
  },
  { immediate: true },
)

onMounted(() => {
  if (!props.done && !props.error) startTimer()
  syncCurrentStageTypingText()
})

onUnmounted(() => {
  stopTimer()
  stopTypingTimer()
})
</script>

<style scoped>
@import "@/views/generate/components/generate-agent-record.css";

/* 加载动画覆盖层 */
.loading-container-VeCJoq {
  border-radius: 2px;
  height: 100%;
  left: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  width: 100%;
}

.animation-wrapper {
  background-color: var(--bg-mask-60);
  height: 100%;
  left: 0;
  position: absolute;
  top: 0;
  width: 100%;
  overflow: hidden;
}

/* 纯 CSS 流光占位（替代 2.2MB 加载动画 MP4）。
   关键：用 transform 平移一张预模糊的宽渐变层，而不是 animate background-position。
   后者每帧都要对 blur(28px) 图层整块重绘（paint），出图区常达 800×500、生成 30-90s，
   多卡并发时是持续掉帧税；改成 translateX 后该层只绘制一次，逐帧仅在合成器平移(GPU)。
   父级 .animation-wrapper 已 overflow:hidden，200% 宽超出部分被裁剪。 */
.loading-shimmer {
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: 100%;
  background: linear-gradient(120deg, #6a5cff, #c86dd7, #5b8def, #38c6c6, #6a5cff);
  filter: blur(28px);
  will-change: transform;
  animation: loading-shimmer-move 6s ease-in-out infinite;
}

@keyframes loading-shimmer-move {
  0% { transform: translateX(0); }
  50% { transform: translateX(-50%); }
  100% { transform: translateX(0); }
}

/* 网格分割线 */
.divider-container {
  height: 100%;
  left: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  transform: translateZ(0);
  width: 100%;
  z-index: 5;
}

/* 整张结果卡片都应能打开预览；事件绑在卡片而不是图片节点上，
   避免 object-fit 留白、图片拖拽及上层布局命中差异造成“点了没反应”。 */
.image-card-preview-trigger {
  cursor: zoom-in;
  outline: none;
}

.image-card-preview-trigger:focus-visible {
  box-shadow: inset 0 0 0 2px var(--brand-main-default, #7c5cff);
}

.image-card-preview-trigger .image-TLmgkP {
  pointer-events: none;
  user-select: none;
}

.image-card-wrapper {
  position: relative;
}

.image-card-download-button {
  align-items: center;
  backdrop-filter: blur(12px);
  background: rgba(17, 18, 24, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  bottom: 12px;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  font-weight: 500;
  gap: 6px;
  line-height: 1;
  padding: 9px 12px;
  position: absolute;
  right: 12px;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  z-index: 8;
}

.image-card-download-button:hover {
  background: rgba(91, 71, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.35);
  transform: translateY(-1px);
}

.image-card-download-button:focus-visible {
  outline: 2px solid var(--brand-main-default, #7c5cff);
  outline-offset: 2px;
}

.vertical-divider {
  background-color: var(--bg-body);
  height: 100%;
  position: absolute;
  top: 0;
  width: 2px;
}

/* 进度徽章 */
.progress-badge-RuihdC {
  align-items: center;
  background: var(--bg-block-primary-default, rgba(204, 221, 255, .08));
  border-radius: 6px;
  color: var(--text-primary);
  display: flex;
  font-family: PingFang SC, sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  padding: 2px 7px 2px 8px;
}

.image-record-content .progress-badge-RQDqWu {
  left: 8px;
  position: absolute;
  top: 8px;
}

/* 错误状态 */
.image-error-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 24px;
}

.image-error-content {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--functional-danger, #f53f3f);
  font-size: 14px;
}


.image-stage-process-group {
  margin-top: 10px;
  margin-bottom: 18px;
}

.image-stage-reasoning-message {
  margin-bottom: 10px;
}

.image-stage-process-group :deep(.content-wrapper-WwWXWE .content-e0iN2u:before) {
  padding-top: 2px;
}

.image-stage-conversation-item__dot {
  background: var(--brand-main-default, #4c8dff);
  border-radius: 999px;
  display: inline-flex;
  height: 6px;
  width: 6px;
}

.image-stage-conversation-item__dot--active {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand-main-default, #4c8dff) 16%, transparent);
}

.image-stage-title {
  color: var(--text-primary);
}

.image-stage-content {
  color: var(--text-secondary, #83929d);
}

.image-stage-conversation-item__text {
  font-size: 14px;
  line-height: 22px;
  word-break: break-word;
}
</style>
