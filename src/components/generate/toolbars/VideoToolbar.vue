<script setup lang="ts">
// 视频生成工具栏（即梦新版布局）
// 控件：模型(VIP) / 功能(全能参考·首尾帧·智能多帧) / 比例+分辨率(合并) / 时长(4-12s)

import { ref, computed, watch, onMounted } from 'vue'
import SelectPopup from '../common/SelectPopup.vue'
import { getAllVideoModels, getDefaultVideoModelKey, loadPublicModelCatalog } from '@/config/models'

type Placement = 'top' | 'bottom' | 'auto'

const VIDEO_TOOLBAR_STORAGE_KEY = 'canana:generator:video-toolbar'

interface Props {
  placement?: Placement
  iconOnly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placement: 'auto',
  iconOnly: false,
})

// 把当前「功能」反应式通知父级，用于切换上传区与占位文案。
const emit = defineEmits<{ (e: 'feature-change', feature: string): void }>()

// 模型版本（内置 + 后台自定义）。VIP 徽标由 label 含「VIP」推导。
const modelVersions = computed(() =>
  getAllVideoModels().map((m: any) => ({
    value: m.key,
    label: m.label,
    vip: /vip/i.test(String(m.label || '')),
    // 携带计费配置,供"按分辨率"派生支持的分辨率与单价。
    defaultParams: m.defaultParams || {},
  })),
)

// 视频分辨率档位顺序(与后端规范键一致)。
const VIDEO_RESOLUTION_ORDER = ['480P', '720P', '1080P']

// 功能（即梦新版三选一）。badge 用于「全能参考」的 New 标。
const featureOptions = [
  { value: 'omni-reference', label: '全能参考', icon: 'omni', badge: 'New' },
  { value: 'first-last-frame', label: '首尾帧', icon: 'frame', badge: '' },
  { value: 'multi-frame', label: '智能多帧', icon: 'multi', badge: '' },
]

// 比例（即梦新版六选一），ico 宽高用于绘制比例缩略图标。
const ratioOptions = [
  { value: '21:9', icoW: 21, icoH: 9 },
  { value: '16:9', icoW: 16, icoH: 9 },
  { value: '4:3', icoW: 4, icoH: 3 },
  { value: '1:1', icoW: 1, icoH: 1 },
  { value: '3:4', icoW: 3, icoH: 4 },
  { value: '9:16', icoW: 9, icoH: 16 },
]

// 分辨率选项改为"随所选模型同步":见下方 supportedResolutions / resolutionOptions computed。

// 时长 4s~15s。
const durationOptions = Array.from({ length: 12 }, (_, i) => ({ value: `${i + 4}s`, label: `${i + 4}s` }))

const readStoredVideoToolbarState = () => {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(VIDEO_TOOLBAR_STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

const storedVideoToolbarState = readStoredVideoToolbarState()
const validVideoModelValues = modelVersions.value.map(item => item.value)
const validVideoFeatureValues = featureOptions.map(item => item.value)
const validVideoRatioValues = ratioOptions.map(item => item.value)
const validVideoDurationValues = durationOptions.map(item => item.value)

const currentModelVersion = ref(
  validVideoModelValues.includes(storedVideoToolbarState?.model) ? storedVideoToolbarState.model : getDefaultVideoModelKey(),
)
const currentFeature = ref(
  validVideoFeatureValues.includes(storedVideoToolbarState?.feature) ? storedVideoToolbarState.feature : 'omni-reference',
)
const currentSize = ref(
  validVideoRatioValues.includes(storedVideoToolbarState?.size) ? storedVideoToolbarState.size : '16:9',
)
// 初值取本地存储或 720P;实际是否在所选模型的支持列表里,由下方 supportedResolutions 的 watch 校正。
const currentResolution = ref(String(storedVideoToolbarState?.resolution || '720P'))
const currentDuration = ref(
  validVideoDurationValues.includes(storedVideoToolbarState?.duration) ? storedVideoToolbarState.duration : '5s',
)

watch(
  modelVersions,
  (options) => {
    const values = options.map(item => item.value)
    if (!values.length) return
    if (!values.includes(currentModelVersion.value)) {
      currentModelVersion.value = getDefaultVideoModelKey() || values[0]
    }
  },
  { immediate: true },
)

onMounted(() => {
  void loadPublicModelCatalog()
})

const isModelSelectOpen = ref(false)
const isFeatureSelectOpen = ref(false)
const isSizeSelectOpen = ref(false)
const isDurationSelectOpen = ref(false)

const modelTriggerRef = ref<HTMLElement | null>(null)
const featureTriggerRef = ref<HTMLElement | null>(null)
const sizeTriggerRef = ref<HTMLElement | null>(null)
const durationTriggerRef = ref<HTMLElement | null>(null)

const closeAllPopups = () => {
  isModelSelectOpen.value = false
  isFeatureSelectOpen.value = false
  isSizeSelectOpen.value = false
  isDurationSelectOpen.value = false
}

const makeToggle = (state: typeof isModelSelectOpen) => (e: Event) => {
  e.stopPropagation()
  const wasOpen = state.value
  closeAllPopups()
  state.value = !wasOpen
}
const toggleModelSelect = makeToggle(isModelSelectOpen)
const toggleFeatureSelect = makeToggle(isFeatureSelectOpen)
const toggleSizeSelect = makeToggle(isSizeSelectOpen)
const toggleDurationSelect = makeToggle(isDurationSelectOpen)

const selectModelVersion = (version: string) => {
  currentModelVersion.value = version
  isModelSelectOpen.value = false
}
const selectFeature = (feature: string) => {
  currentFeature.value = feature
  isFeatureSelectOpen.value = false
}
const selectRatio = (ratio: string) => {
  currentSize.value = ratio
}
const selectResolution = (resolution: string) => {
  currentResolution.value = resolution
}
const selectDuration = (duration: string) => {
  currentDuration.value = duration
  isDurationSelectOpen.value = false
}

const currentModel = computed(() => modelVersions.value.find((m: any) => m.value === currentModelVersion.value) || null)
const getCurrentModelLabel = () => currentModel.value?.label || currentModelVersion.value || ''
const isCurrentModelVip = computed(() => Boolean(currentModel.value?.vip))

// 当前模型支持的分辨率(来自后台按分辨率定价配置 billingRule.videoResolutionPrices 的键)。
// 未配置时回退默认 [720P,1080P],兼容旧模型。
const supportedResolutions = computed<string[]>(() => {
  const prices = (currentModel.value?.defaultParams as any)?.billingRule?.videoResolutionPrices
  const keys = prices && typeof prices === 'object' && !Array.isArray(prices)
    ? Object.keys(prices).map(k => String(k).trim().toUpperCase())
    : []
  return keys.length ? VIDEO_RESOLUTION_ORDER.filter(r => keys.includes(r)) : ['720P', '1080P']
})

// 分辨率选项随模型同步;1080P 标记 VIP 徽标。
const resolutionOptions = computed(() => supportedResolutions.value.map(value => ({ value, vip: value === '1080P' })))

// 当前选中分辨率若不在所选模型的支持列表,自动切到第一个支持项。
watch(supportedResolutions, (list) => {
  if (list.length && !list.includes(currentResolution.value)) {
    currentResolution.value = list[0]
  }
}, { immediate: true })
const getCurrentFeatureLabel = () => featureOptions.find(f => f.value === currentFeature.value)?.label || '全能参考'

watch(
  [currentModelVersion, currentFeature, currentSize, currentResolution, currentDuration],
  ([model, feature, size, resolution, duration]) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      VIDEO_TOOLBAR_STORAGE_KEY,
      JSON.stringify({ model, feature, size, resolution, duration }),
    )
  },
  { immediate: true },
)

// 功能变化时通知父级（含初始值）。
watch(currentFeature, (value) => emit('feature-change', value), { immediate: true })

// 兼容旧调用：返回 { value: 比例, quality: 分辨率 }。
const getCurrentSizeConfig = () => ({ value: currentSize.value, quality: currentResolution.value })

defineExpose({
  currentModelVersion,
  currentSize,
  currentResolution,
  currentDuration,
  currentFeature,
  getCurrentModelLabel,
  getCurrentFeatureLabel,
  getCurrentSizeConfig,
})
</script>

<template>
  <div class="video-toolbar">
    <!-- 模型版本 -->
    <div ref="modelTriggerRef"
         :class="['lv-select', 'lv-select-single', 'lv-select-size-default', 'toolbar-select', 'select-joF5y7', 'select-NNOj5P', { 'compact': iconOnly }]"
         role="combobox" tabindex="0" :aria-expanded="isModelSelectOpen"
         :title="iconOnly ? getCurrentModelLabel() : undefined" @click.stop="toggleModelSelect">
      <div class="lv-select-view">
        <span class="lv-select-view-selector">
          <span class="lv-select-view-value">
            <svg fill="none" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
              <path clip-rule="evenodd" d="M13.25 2.682a2.5 2.5 0 0 0-2.5 0L4.556 6.258a2.5 2.5 0 0 0-1.25 2.165v7.153a2.5 2.5 0 0 0 1.25 2.165l6.194 3.576a2.5 2.5 0 0 0 2.5 0l6.194-3.576a2.5 2.5 0 0 0 1.25-2.165V8.423a2.5 2.5 0 0 0-1.25-2.165L13.25 2.682Zm-1.6 1.559a.7.7 0 0 1 .7 0L17.995 7.5 12 10.96 6.005 7.5l5.645-3.26Zm1.25 8.279v6.92l5.644-3.258a.7.7 0 0 0 .35-.606V9.059l-5.994 3.46ZM5.106 9.059l5.994 3.46v6.922l-5.644-3.259a.7.7 0 0 1-.35-.606V9.059Z" fill="currentColor" fill-rule="evenodd"></path>
            </svg>
            <span v-if="!iconOnly">{{ getCurrentModelLabel() }}</span>
            <span v-if="!iconOnly && isCurrentModelVip" class="video-vip-badge">✦</span>
          </span>
        </span>
        <div v-if="!iconOnly" aria-hidden="true" class="lv-select-suffix">
          <div class="lv-select-arrow-icon">
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" fill="currentColor"></path>
            </svg>
          </div>
        </div>
        <div v-else aria-hidden="true" class="lv-select-suffix sf-hidden"></div>
      </div>
    </div>
    <SelectPopup v-model:visible="isModelSelectOpen" :trigger-ref="modelTriggerRef" :placement="placement" title="模型版本">
      <ul class="lv-select-popup-inner">
        <li v-for="version in modelVersions" :key="version.value"
            :class="['lv-select-option', { 'lv-select-option-wrapper-selected': currentModelVersion === version.value }]"
            @click.stop="selectModelVersion(version.value)">
          <div class="select-option-label">
            <div class="select-option-label-content">
              <span>{{ version.label }}</span>
              <span v-if="version.vip" class="video-vip-badge">✦</span>
            </div>
            <span v-if="currentModelVersion === version.value" class="select-option-check-icon">
              <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M20.774 6.289a1 1 0 0 1 .1 1.41l-9.666 11a1 1 0 0 1-1.447.063l-5.334-5a1 1 0 0 1 1.368-1.458l4.572 4.286 9.002-10.2a1 1 0 0 1 1.405-.101Z" fill="currentColor"></path></svg>
            </span>
          </div>
        </li>
      </ul>
    </SelectPopup>

    <!-- 功能：全能参考 / 首尾帧 / 智能多帧 -->
    <div class="feature-select">
      <div ref="featureTriggerRef"
           :class="['lv-select', 'lv-select-single', 'lv-select-size-default', 'toolbar-select', 'select-joF5y7', 'select-NNOj5P', { 'compact': iconOnly }]"
           role="combobox" tabindex="0" :aria-expanded="isFeatureSelectOpen"
           :title="iconOnly ? getCurrentFeatureLabel() : undefined" @click.stop="toggleFeatureSelect">
        <div class="lv-select-view">
          <span class="lv-select-view-selector">
            <span class="lv-select-view-value">
              <span class="select-option-icon-LQHnJG">
                <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 3a1 1 0 1 1 2 0v.01h8.66V3h3.519A3.82 3.82 0 0 1 21 6.821V17.18A3.82 3.82 0 0 1 17.179 21H13.66v-.01H5V21a1 1 0 1 1-2 0V3Zm16 14.22a1.982 1.982 0 0 1-1.972 1.79H15.66v-3.33H19v1.54ZM17.22 5c.941.091 1.69.84 1.78 1.78v1.56h-3.34V5h1.56Zm-3.56-.01v14.02H5V4.99h8.66ZM19 10.34h-3.34v3.34H19v-3.34Z" fill="currentColor"></path></svg>
              </span>
              <span v-if="!iconOnly">{{ getCurrentFeatureLabel() }}</span>
            </span>
          </span>
          <div v-if="!iconOnly" aria-hidden="true" class="lv-select-suffix">
            <div class="lv-select-arrow-icon">
              <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" fill="currentColor"></path></svg>
            </div>
          </div>
          <div v-else aria-hidden="true" class="lv-select-suffix sf-hidden"></div>
        </div>
      </div>
    </div>
    <SelectPopup v-model:visible="isFeatureSelectOpen" :trigger-ref="featureTriggerRef" :placement="placement" title="功能">
      <ul class="lv-select-popup-inner">
        <li v-for="feature in featureOptions" :key="feature.value"
            :class="['lv-select-option', { 'lv-select-option-wrapper-selected': currentFeature === feature.value }]"
            @click.stop="selectFeature(feature.value)">
          <div class="select-option-label">
            <div class="select-option-label-content">
              <span>{{ feature.label }}</span>
              <span v-if="feature.badge" class="video-feature-badge">{{ feature.badge }}</span>
            </div>
            <span v-if="currentFeature === feature.value" class="select-option-check-icon">
              <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M20.774 6.289a1 1 0 0 1 .1 1.41l-9.666 11a1 1 0 0 1-1.447.063l-5.334-5a1 1 0 0 1 1.368-1.458l4.572 4.286 9.002-10.2a1 1 0 0 1 1.405-.101Z" fill="currentColor"></path></svg>
            </span>
          </div>
        </li>
      </ul>
    </SelectPopup>

    <!-- 比例 + 分辨率（合并） -->
    <button ref="sizeTriggerRef"
            :class="['lv-btn', 'lv-btn-secondary', 'lv-btn-size-default', 'lv-btn-shape-square', 'button-lc3WzE', 'toolbar-button-FhFnQ_', 'toolbar-button-pEFNv9', { 'lv-btn-icon-only': iconOnly }]"
            type="button" :title="iconOnly ? currentSize + ' ' + currentResolution : undefined" @click.stop="toggleSizeSelect">
      <svg fill="none" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M1.924 9.706a4 4 0 0 1 4-4h12.15a4 4 0 0 1 4 4v4.588a4 4 0 0 1-4 4H5.924a4 4 0 0 1-4-4V9.706Zm4-2a2 2 0 0 0-2 2v4.588a2 2 0 0 0 2 2h12.15a2 2 0 0 0 2-2V9.706a2 2 0 0 0-2-2H5.924Z" clip-rule="evenodd" fill-rule="evenodd" fill="currentColor"></path></svg>
      <span v-if="!iconOnly" class="button-text-gwJnq9">{{ currentSize }}<span class="divider-ObM8Ek"></span><span class="commercial-content-QAReHq">{{ currentResolution }}</span></span>
    </button>
    <SelectPopup v-model:visible="isSizeSelectOpen" :trigger-ref="sizeTriggerRef" :placement="placement" title="比例与分辨率">
      <div class="video-ratio-popup">
        <div class="video-ratio-popup__section-title">选择比例</div>
        <div class="video-ratio-grid">
          <button v-for="ratio in ratioOptions" :key="ratio.value" type="button"
                  :class="['video-ratio-cell', { 'video-ratio-cell--active': currentSize === ratio.value }]"
                  @click.stop="selectRatio(ratio.value)">
            <span class="video-ratio-ico"
                  :style="{ width: (16 * ratio.icoW / Math.max(ratio.icoW, ratio.icoH)) + 'px', height: (16 * ratio.icoH / Math.max(ratio.icoW, ratio.icoH)) + 'px' }"></span>
            <span class="video-ratio-label">{{ ratio.value }}</span>
          </button>
        </div>
        <div class="video-ratio-popup__section-title">选择分辨率</div>
        <div class="video-resolution-row">
          <button v-for="resolution in resolutionOptions" :key="resolution.value" type="button"
                  :class="['video-resolution-cell', { 'video-resolution-cell--active': currentResolution === resolution.value }]"
                  @click.stop="selectResolution(resolution.value)">
            {{ resolution.value }}<span v-if="resolution.vip" class="video-vip-badge">✦</span>
          </button>
        </div>
      </div>
    </SelectPopup>

    <!-- 时长 -->
    <div ref="durationTriggerRef"
         :class="['lv-select', 'lv-select-single', 'lv-select-size-default', 'toolbar-select', 'select-joF5y7', 'select-NNOj5P', { 'compact': iconOnly }]"
         role="combobox" tabindex="0" :aria-expanded="isDurationSelectOpen"
         :title="iconOnly ? currentDuration : undefined" @click.stop="toggleDurationSelect">
      <div class="lv-select-view">
        <span class="lv-select-view-selector">
          <span class="lv-select-view-value">
            <span class="select-option-icon-LQHnJG">
              <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(30deg);"><path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0V8a1 1 0 0 1 1-1Z" fill="currentColor"></path></svg>
            </span>
            <span v-if="!iconOnly">{{ currentDuration }}</span>
          </span>
        </span>
        <div v-if="!iconOnly" aria-hidden="true" class="lv-select-suffix">
          <div class="lv-select-arrow-icon">
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M21.01 7.982A1.2 1.2 0 0 1 21 9.679l-8.156 8.06a1.2 1.2 0 0 1-1.688 0L3 9.68a1.2 1.2 0 0 1 1.687-1.707L12 15.199l7.313-7.227a1.2 1.2 0 0 1 1.697.01Z" fill="currentColor"></path></svg>
          </div>
        </div>
        <div v-else aria-hidden="true" class="lv-select-suffix sf-hidden"></div>
      </div>
    </div>
    <SelectPopup v-model:visible="isDurationSelectOpen" :trigger-ref="durationTriggerRef" :placement="placement" title="选择视频生成时长">
      <ul class="lv-select-popup-inner video-duration-list">
        <li v-for="duration in durationOptions" :key="duration.value"
            :class="['lv-select-option', { 'lv-select-option-wrapper-selected': currentDuration === duration.value }]"
            @click.stop="selectDuration(duration.value)">
          <div class="select-option-label">
            <div class="select-option-label-content">
              <span>{{ duration.label }}</span>
            </div>
            <span v-if="currentDuration === duration.value" class="select-option-check-icon">
              <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M20.774 6.289a1 1 0 0 1 .1 1.41l-9.666 11a1 1 0 0 1-1.447.063l-5.334-5a1 1 0 0 1 1.368-1.458l4.572 4.286 9.002-10.2a1 1 0 0 1 1.405-.101Z" fill="currentColor"></path></svg>
            </span>
          </div>
        </li>
      </ul>
    </SelectPopup>
  </div>
</template>

<style>
/* 样式主体在 generate.css 中定义；此处仅补即梦新版的比例网格 / 徽标。 */
.video-toolbar {
  display: contents;
}

.video-vip-badge {
  margin-left: 4px;
  color: var(--brand-main-default, #4c8dff);
  font-size: 11px;
}

.video-feature-badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--brand-main-default, #4c8dff);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  font-weight: 600;
}

/* 比例 + 分辨率合并弹窗 */
.video-ratio-popup {
  padding: 8px 10px 10px;
  min-width: 280px;
}

.video-ratio-popup__section-title {
  color: var(--text-tertiary, #6b7785);
  font-size: 12px;
  line-height: 20px;
  margin: 6px 2px;
}

.video-ratio-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}

.video-ratio-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 56px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg-block-primary-default, rgba(204, 221, 255, .06));
  color: var(--text-secondary, #83929d);
  cursor: pointer;
}

.video-ratio-cell:hover {
  background: var(--bg-block-primary-hover, rgba(204, 221, 255, .12));
}

.video-ratio-cell--active {
  border-color: var(--brand-main-default, #4c8dff);
  color: var(--text-primary);
}

.video-ratio-ico {
  display: block;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}

.video-ratio-label {
  font-size: 12px;
  line-height: 16px;
}

.video-resolution-row {
  display: flex;
  gap: 8px;
}

.video-resolution-cell {
  flex: 1;
  height: 36px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg-block-primary-default, rgba(204, 221, 255, .06));
  color: var(--text-secondary, #83929d);
  font-size: 13px;
  cursor: pointer;
}

.video-resolution-cell:hover {
  background: var(--bg-block-primary-hover, rgba(204, 221, 255, .12));
}

.video-resolution-cell--active {
  border-color: var(--brand-main-default, #4c8dff);
  color: var(--text-primary);
}

.video-duration-list {
  max-height: 280px;
  overflow-y: auto;
}
</style>
