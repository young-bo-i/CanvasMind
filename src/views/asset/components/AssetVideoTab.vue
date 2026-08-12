<template>
  <div class="content-1rx" :class="{ 'hidden-w3p': !active }">
    <div class="tab-entry-mxq">
      <div class="video-c49">
        <div class="header-2ov">
          <div class="container-c5d">
            <div class="header-2wr">
              <div class="filter-wxj">
                <div
                  v-for="option in videoFilterOptions"
                  :key="option.value"
                  class="filter-qxo"
                  :class="{ [option.activeClass]: videoFilter === option.value }"
                  @click="emit('set-video-filter', option.value)"
                >
                  {{ option.label }}
                </div>
              </div>
              <div v-if="isBatchMode" class="operationWrap-oqo">
                <div class="select-zkx text-5vo">已选择 {{ selectedCount }} 项内容</div>
                <div class="style-ctWQJ"></div>
                <button
                  class="btn-7n1 btn-secondary-y4e btn-rec btn-3qb"
                  type="button"
                  :disabled="selectedCount === 0"
                  @click="emit('batch-download')"
                >
                  <div class="button-flt">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="text-5vo">下载原视频</span>
                  </div>
                </button>
                <div class="divider-4o4"></div>
                <button class="asset-video-cancel-selection" type="button" @click="emit('exit-batch-mode')">取消选择</button>
              </div>
              <div v-else class="select-ald">
                <div class="select-cff"></div>
                <div class="operateArea-aqq">
                  <div class="search-7ey">
                    <div class="container-cpr mini-bsk search-krp">
                      <div class="container-dbs">
                        <div class="btn-v6i">
                          <svg width="16" height="16" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg" class="back-icon">
                            <g>
                              <path data-follow-fill="currentColor" d="M4.533 12.844a1.2 1.2 0 0 1 0-1.687l7.655-7.747a1.2 1.2 0 0 1 1.708 1.687l-6.822 6.904 6.822 6.903a1.2 1.2 0 1 1-1.708 1.686l-7.655-7.746Z" clip-rule="evenodd" fill-rule="evenodd" fill="currentColor" />
                            </g>
                          </svg>
                        </div>
                      </div>
                      <div class="container-7bd">
                        <div class="wrapper-kw3 search-fzo button-kin input-gji disabled-bod mini-irl col-zom">
                          <span class="input-ffs">
                            <span class="wrapper-8e3 wrapper-vc5 wrapper-9ij">
                              <span class="input-idr">
                                <svg width="1em" height="1em" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg">
                                  <g>
                                    <path data-follow-fill="currentColor" d="M4.563 10.75a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm6.5-8.5a8.5 8.5 0 1 0 5.261 15.176l3.406 3.406a1 1 0 0 0 1.415-1.414l-3.407-3.406A8.5 8.5 0 0 0 11.062 2.25Z" clip-rule="evenodd" fill-rule="evenodd" fill="currentColor" />
                                  </g>
                                </svg>
                              </span>
                              <input placeholder="搜索" class="input-z1m" value>
                            </span>
                            <span class="input-xd8">
                              <button class="btn-4ac btn-primary-exr btn-j99 btn-a2l loading-9av search-wvd" type="button">
                                <div class="container-29w disabled-mib">
                                  <span class="search-as4">搜索</span>
                                </div>
                              </button>
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="divider-hb7"></div>
                  <div class="btn-g4h" @click="emit('enter-batch-mode')">批量操作</div>
                  <div class="divider-hb7"></div>
                  <div class="edit-in-capcut-54s" @click="emit('edit-in-capcut')">
                    <svg width="1em" height="1em" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg" class="capcut-icon">
                      <g>
                        <path data-follow-fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M22.002 7.646V4.61l-3.749 1.917v-.115c0-1.21-.892-1.94-2.181-1.94H4.183c-1.36 0-2.181.73-2.181 1.94v3.066l5.252 2.642-5.252 2.67v3.059c0 1.186.825 1.917 2.181 1.917H16.07c1.29 0 2.182-.73 2.182-1.917v-.16L22 19.63v-3.081l-8.72-4.429 8.722-4.474Zm-11.747 5.98 6.448 3.287H3.784l6.47-3.286Zm6.4-6.3-6.4 3.265-6.47-3.265h12.87Z" fill="currentColor" />
                      </g>
                    </svg>去剪映编辑
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- 首批加载：骨架屏，避免闪空状态 -->
        <div v-if="loading && !videoGroups.length" class="image-s9z">
          <div class="row-zep">
            <div class="container-c5d">
              <div class="image-qvw">
                <div v-for="n in 18" :key="n" class="image-bqm asset-skeleton-tile"></div>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="videoGroups.length" class="image-s9z">
          <div class="vList-q9n style-FG29L">
            <div class="style-MK2n3">
              <div class="style-TK4rG">
                <template v-for="group in videoGroups" :key="group.date">
                  <div>
                    <div class="container-c5d">
                      <div class="time-gcp" :class="{ 'first-fo4': group.isFirst }">{{ group.date }}</div>
                    </div>
                  </div>
                  <div class="row-zep">
                    <div class="container-c5d">
                      <div class="image-qvw">
                        <div
                          v-for="video in group.videos"
                          :key="video.id"
                          v-observe-video
                          :data-video-id="video.id"
                          class="image-bqm"
                          :class="{ 'select-1kz': isBatchMode && isSelected(video.id) }"
                          @click="isBatchMode && emit('asset-click', video.id)"
                        >
                          <div>
                            <div class="container-pm3">
                              <!-- 性能(P0-1/P2-4/P2-8)：只给进入视口(±400px)的视频挂载 <video>，离开即卸载释放解码管线。
                                   避免一次性挂 120 个 <video> + 强制首帧解码把媒体解码器打满、Tab 卡死。
                                   离屏时显示 poster 占位(无 poster 则灰底)，不再每个视频独立预加载。 -->
                              <video
                                v-if="!observerSupported || visibleVideoIds.has(video.id)"
                                class="image-w9g"
                                :src="video.src"
                                :poster="video.poster"
                                :controls="!isBatchMode"
                                playsinline
                                preload="metadata"
                                @loadedmetadata="renderVideoFirstFrame"
                              ></video>
                              <div
                                v-else
                                class="image-w9g video-poster-placeholder"
                                :style="video.poster ? { backgroundImage: `url(${video.poster})` } : undefined"
                              ></div>
                              <button
                                v-if="!isBatchMode"
                                type="button"
                                class="asset-video-download-button"
                                :aria-label="`下载视频 ${video.id}`"
                                title="下载原视频"
                                @click.stop="emit('download', video.id)"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <span>下载原视频</span>
                              </button>
                              <button
                                v-else
                                type="button"
                                class="asset-video-batch-overlay"
                                :aria-label="isSelected(video.id) ? `取消选择视频 ${video.id}` : `选择视频 ${video.id}`"
                                @click.stop="emit('asset-click', video.id)"
                              >
                                <span class="asset-video-selection-indicator">
                                  <svg v-if="isSelected(video.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                                  </svg>
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div ref="loadMoreSentinel" class="load-more-detector-c4r"></div>
                <div v-if="loadingMore" class="asset-loading-more">加载中…</div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="video-cv8">
          <div class="empty-page-ij3">
            <img src="/placeholder.svg" class="image-eyv">
            <div class="description-96w">暂无相关资产</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount, type Directive } from 'vue'
import type { FilterOption, VideoFilterType, VideoGroup } from '@/views/asset/types'

const props = withDefaults(defineProps<{
  active: boolean
  videoFilterOptions: FilterOption<VideoFilterType>[]
  videoFilter: VideoFilterType
  videoGroups: VideoGroup[]
  isBatchMode: boolean
  selectedCount: number
  isSelected: (itemId: string) => boolean
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
}>(), {
  loading: false,
  loadingMore: false,
  hasMore: false,
})

const emit = defineEmits<{
  'set-video-filter': [filter: VideoFilterType]
  'enter-batch-mode': []
  'exit-batch-mode': []
  'batch-download': []
  'asset-click': [itemId: string]
  'edit-in-capcut': []
  'download': [itemId: string]
  'load-more': []
}>()

// 底部 sentinel：进入视口即触发增量加载（父级有守卫，重复触发安全）。
const loadMoreSentinel = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null
watch(loadMoreSentinel, (el) => {
  if (loadMoreObserver) {
    loadMoreObserver.disconnect()
    loadMoreObserver = null
  }
  if (!el || !observerSupported) {
    return
  }
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting) && props.hasMore && !props.loadingMore) {
      emit('load-more')
    }
  }, { rootMargin: '400px 0px' })
  loadMoreObserver.observe(el)
})

// 性能(P0-1/P2-4/P2-8)：视频网格按视口窗口化挂载。
// 仅当 tile 进入视口(含 ±400px 缓冲)时把它的 id 放进集合，模板据此挂载真正的 <video>；
// 离开视口即移除 → <video> 卸载 → 解码管线释放。把同时存在的 <video> 数量从“全部”降到“一屏”。
const observerSupported = typeof IntersectionObserver !== 'undefined'
const visibleVideoIds = ref(new Set<string>())

let videoObserver: IntersectionObserver | null = null
const ensureObserver = () => {
  if (videoObserver || !observerSupported) return videoObserver
  videoObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.videoId
      if (!id) continue
      if (entry.isIntersecting) {
        visibleVideoIds.value.add(id)
      } else {
        visibleVideoIds.value.delete(id)
      }
    }
  }, { rootMargin: '400px 0px' })
  return videoObserver
}

// 自定义指令：挂载时观察 tile，卸载时取消观察并清理可见集合，避免列表变化(切筛选/翻页)后残留。
const vObserveVideo: Directive<HTMLElement> = {
  mounted(el) {
    ensureObserver()?.observe(el)
  },
  unmounted(el) {
    videoObserver?.unobserve(el)
    const id = el.dataset.videoId
    if (id) visibleVideoIds.value.delete(id)
  },
}

onBeforeUnmount(() => {
  videoObserver?.disconnect()
  videoObserver = null
  visibleVideoIds.value.clear()
  if (loadMoreObserver) {
    loadMoreObserver.disconnect()
    loadMoreObserver = null
  }
})

// 无封面图时:metadata 预加载只拿到时长不会绘制画面(显示纯黑)。
// 跳到 ~0.1s 触发浏览器解码并绘制首帧,作为视频缩略图。
const renderVideoFirstFrame = (event: Event) => {
  const el = event.target as HTMLVideoElement | null
  if (!el || el.poster) return
  if (el.currentTime > 0) return
  const seekTo = Math.min(0.1, (Number.isFinite(el.duration) ? el.duration : 1) / 2)
  try {
    el.currentTime = seekTo
  } catch {
    // 忽略:个别浏览器/格式不支持精确 seek 时维持原样。
  }
}
</script>

<style scoped>
/* 离屏视频占位：有封面则铺封面，无封面用灰底，避免空白且无需挂载 <video>。 */
.video-poster-placeholder {
  background-color: rgba(255, 255, 255, 0.04);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

.asset-video-download-button {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(15, 18, 25, 0.78);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  opacity: 0;
  backdrop-filter: blur(8px);
  transition: opacity .18s ease, background-color .18s ease;
}

.container-pm3 {
  container-type: inline-size;
}

@container (max-width: 130px) {
  .asset-video-download-button span {
    display: none;
  }

  .asset-video-download-button {
    width: 34px;
    padding: 0;
    justify-content: center;
  }
}

.asset-video-batch-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.asset-video-selection-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  background: rgba(12, 15, 22, 0.42);
  color: #fff;
}

.select-1kz .asset-video-selection-indicator {
  background: var(--brand-main-default, #635bff);
}

.asset-video-cancel-selection {
  min-height: 34px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.image-bqm:hover .asset-video-download-button,
.asset-video-download-button:focus-visible {
  opacity: 1;
}

.asset-video-download-button:hover {
  background: rgba(15, 18, 25, 0.94);
}

@media (hover: none) {
  .asset-video-download-button {
    opacity: 1;
  }
}

/* 骨架屏瓦片 + 增量加载提示 */
.asset-skeleton-tile {
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(204, 221, 255, 0.06) 25%, rgba(204, 221, 255, 0.12) 37%, rgba(204, 221, 255, 0.06) 63%);
  background-size: 400% 100%;
  animation: asset-skeleton-shimmer 1.4s ease infinite;
}
@keyframes asset-skeleton-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}
.asset-loading-more {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary, rgba(204, 221, 255, 0.4));
}
</style>
