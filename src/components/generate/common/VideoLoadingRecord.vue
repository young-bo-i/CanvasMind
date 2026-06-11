<template>
  <div class="responsive-container-msS_cP responsive-container-NBoaUU">
    <div class="content-DPogfx ai-generated-record-content-hg5EL8">
      <div v-if="time" class="group-title">{{ time }}</div>
      <div class="image-record">
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
        <div class="record-box-wrapper">
          <!-- 错误状态 -->
          <div v-if="error" class="image-error-container">
            <div class="image-error-content">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{{ error }}</span>
            </div>
            <!-- 仅超时才给：可能只是上游排队慢，让用户主动再查一次上游结果 -->
            <button v-if="isTimeoutError" type="button" class="video-requery-button" :disabled="requerying" @click="$emit('requery')">
              {{ requerying ? '查询中…' : '重新查询' }}
            </button>
          </div>
          <!-- 已停止 -->
          <div v-else-if="stopped" class="image-error-container">
            <div class="image-error-content">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M8 8h8v8H8zM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>已停止生成</span>
            </div>
          </div>
          <!-- 生成完成：播放视频 + 快捷动作 -->
          <div v-else-if="done && videos.length" class="image-record-content">
            <div class="video-record-grid">
              <div v-for="(url, i) in videos" :key="i" class="video-record-item">
                <video :src="url" class="video-result-player" controls preload="metadata" playsinline></video>
              </div>
            </div>
            <div class="record-quick-actions">
              <button type="button" class="record-quick-action" @click="$emit('make-same')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14.9-2M4 15a8 8 0 0 0 14.9 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                做同款
              </button>
              <button type="button" class="record-quick-action" @click="$emit('download', videos[0])">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                下载
              </button>
              <button type="button" class="record-quick-action record-quick-action--danger" @click="$emit('delete')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m1 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                删除
              </button>
            </div>
          </div>
          <!-- 加载中 -->
          <div v-else class="image-record-content">
            <div class="video-record-grid">
              <div class="video-record-item video-record-item--loading">
                <div class="loading-container-VeCJoq">
                  <div class="animation-wrapper">
                    <video class="loading-animation" autoplay loop muted preload="auto" :src="loadingVideoUrl"></video>
                  </div>
                </div>
              </div>
            </div>
            <div class="progress-badge-RuihdC progress-badge-RQDqWu">
              {{ currentProgress }}% {{ currentProgressText || '造梦中' }}
            </div>
            <button class="stop-generate-button-canana" type="button" @click="$emit('stop')">
              停止生成
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, type PropType } from 'vue'
import loadingVideoUrl from '@/assets/animations/record-loading-animation.mp4'
import RecordPromptReferenceHeader from './RecordPromptReferenceHeader.vue'

const props = defineProps({
  time: { type: String, default: '' },
  prompt: { type: String, default: '' },
  model: { type: String, default: '视频生成' },
  ratio: { type: String, default: '16:9' },
  resolution: { type: String, default: '720P' },
  duration: { type: String, default: '' },
  feature: { type: String, default: '' },
  referenceImages: { type: Array as PropType<string[]>, default: () => [] },
  progress: { type: Number, default: 0 },
  progressText: { type: String, default: '' },
  done: { type: Boolean, default: false },
  stopped: { type: Boolean, default: false },
  /** 生成的视频 URL 列表 */
  videos: { type: Array as PropType<string[]>, default: () => [] },
  error: { type: String, default: '' },
  /** 正在重新查询上游结果 */
  requerying: { type: Boolean, default: false },
})

defineEmits(['stop', 'make-same', 'download', 'delete', 'requery'])

// 仅「超时」失败才提供重新查询（上游可能只是排队慢）；明确失败(如 file_download_error)不给该按钮。
const isTimeoutError = computed(() => /超时|timeout/i.test(String(props.error || '')))

const currentProgress = ref(props.progress)
const currentProgressText = ref(props.progressText)
let timer: ReturnType<typeof setInterval> | null = null

// 当父级已经通过 SSE 提供明确进度时，不再使用本地假进度动画。
const hasControlledProgress = () => Number(props.progress) > 0 || Boolean(String(props.progressText || '').trim())

const startTimer = () => {
  if (hasControlledProgress()) {
    return
  }
  timer = setInterval(() => {
    if (currentProgress.value < 99) {
      const remaining = 99 - currentProgress.value
      const step = Math.max(1, Math.floor(remaining * 0.05))
      currentProgress.value = Math.min(99, currentProgress.value + step)
    }
  }, 1000)
}

const stopTimer = () => {
  if (timer) { clearInterval(timer); timer = null }
}

watch(() => props.done, (val) => { if (val) stopTimer() })
watch(() => props.error, (val) => { if (val) stopTimer() })
watch(() => props.stopped, (val) => { if (val) stopTimer() })

watch(() => props.progress, (val) => {
  currentProgress.value = Number.isFinite(Number(val)) ? Number(val) : 0
  if (hasControlledProgress()) {
    stopTimer()
  } else if (!props.done && !props.error && !props.stopped && !timer) {
    startTimer()
  }
})

watch(() => props.progressText, (val) => {
  currentProgressText.value = val || ''
  if (hasControlledProgress()) {
    stopTimer()
  } else if (!props.done && !props.error && !props.stopped && !timer) {
    startTimer()
  }
})

onMounted(() => {
  if (!props.done && !props.error && !props.stopped) startTimer()
})

onUnmounted(() => {
  stopTimer()
})
</script>

<style scoped>
@import "@/views/generate/components/generate-agent-record.css";

.video-record-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  width: 100%;
}

.video-record-item {
  position: relative;
  width: 100%;
  min-height: 220px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-block-primary-default, rgba(204, 221, 255, .06));
}

.video-record-item--loading {
  min-height: 260px;
}

.video-result-player {
  display: block;
  width: 100%;
  max-height: 480px;
  border-radius: 8px;
  background: #000;
}

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

.loading-animation {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
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

.video-requery-button {
  border: 1px solid var(--stroke-secondary, rgba(255, 255, 255, 0.18));
  background: var(--bg-block-primary-default, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #fff);
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.video-requery-button:hover:not(:disabled) {
  background: var(--bg-block-primary-hover, rgba(255, 255, 255, 0.12));
}

.video-requery-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.stop-generate-button-canana {
  align-items: center;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  bottom: 16px;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  font-weight: 600;
  height: 32px;
  justify-content: center;
  left: 50%;
  padding: 0 14px;
  position: absolute;
  transform: translateX(-50%);
  z-index: 6;
}

.stop-generate-button-canana:hover {
  background: rgba(0, 0, 0, 0.58);
}

/* 结果卡片快捷动作（做同款 / 下载 / 删除） */
.record-quick-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.record-quick-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
  background: var(--fill-secondary, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #e8e8e8);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.record-quick-action:hover {
  background: var(--fill-hover, rgba(255, 255, 255, 0.12));
}

.record-quick-action--danger:hover {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.4);
}
</style>
