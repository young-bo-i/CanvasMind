<template>
  <div class="discover-masonry-viewport">
    <!-- 空状态提示（无作品或搜索无结果） -->
    <div v-if="!displayedFeedItems.length" class="discover-empty">
      <p class="discover-empty__text">{{ emptyText }}</p>
    </div>
    <div
      class="masonry-layout-ynW6QL masonry-layout discover-masonry-shell"
      :style="{ height: `${scrollHeight}px` }"
    >
      <div
        ref="trackRef"
        class="masonry-layout-scroll-content-clXJoF discover-masonry-track"
        :style="{ height: `${scrollHeight}px`, maxHeight: 'none' }"
      >
      <!-- 顶部 banner 已移除（只展示用户作品瀑布流） -->
      <div
        v-if="false"
        class="masonry-layout-item-J63wqA masonry-layout-item discover-masonry-hero"
        data-index="0"
        data-col="0"
        :style="heroInlineStyle"
      >
        <div class="carousel">
          <div class="list-container">
            <div
              v-for="(item, index) in carouselItems"
              :key="index"
              :class="['list-item', 'animated', getCarouselItemClass(index)]"
            >
              <div
                class="carousel-item"
                :data-index="index"
                role="button"
                tabindex="0"
                @click="openWorkDetailFromCarousel(item, index)"
                @keydown.enter.prevent="openWorkDetailFromCarousel(item, index)"
                @keydown.space.prevent="openWorkDetailFromCarousel(item, index)"
              >
                <div class="container-bG3PQ9">
                  <div style="transition:opacity 300ms;opacity:1">
                    <img
                      data-apm-action="feed-item-video"
                      fetchpriority="high"
                      loading="lazy"
                      class="image-dDSP59 discover-masonry-cover"
                      :src="item.image"
                      :alt="item.title"
                    >
                  </div>
                </div>
                <div class="gradient"></div>
                <div class="description-LBLc4Y">
                  <p class="title-rWMvWE">{{ item.title }}</p>
                  <p v-if="item.participants" class="subtitle-gSQDQC">
                    已有<span class="number">{{ item.participants }}</span>人参与
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Carousel Arrows -->
          <div class="arrow-container-LaBgq_">
            <div class="arrow-button" role="button" tabindex="0" aria-label="上一个" @click="prevSlide">
              <svg width="1em" height="1em" viewBox="0 0 24 24"
                   preserveAspectRatio="xMidYMid meet" fill="none" role="presentation"
                   xmlns="http://www.w3.org/2000/svg" class="icon-XIKnET">
                <g>
                  <path data-follow-fill="currentColor" fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M6.26 12.844a1.2 1.2 0 0 1 0-1.688L14.321 3a1.2 1.2 0 0 1 1.707 1.687L8.801 12l7.227 7.313A1.2 1.2 0 0 1 14.321 21l-8.06-8.156Z"
                        fill="currentColor"></path>
                </g>
              </svg>
            </div>
            <div class="arrow-button" role="button" tabindex="0" aria-label="下一个" @click="nextSlide">
              <svg width="1em" height="1em" viewBox="0 0 24 24"
                   preserveAspectRatio="xMidYMid meet" fill="none" role="presentation"
                   xmlns="http://www.w3.org/2000/svg" class="icon-XIKnET">
                <g>
                  <path data-follow-fill="currentColor"
                        d="M17.74 12.844a1.2 1.2 0 0 0 0-1.688L9.678 3A1.2 1.2 0 1 0 7.97 4.687L15.2 12l-7.23 7.313A1.2 1.2 0 1 0 9.68 21l8.06-8.156Z"
                        fill="currentColor"></path>
                </g>
              </svg>
            </div>
          </div>
          
          <!-- Carousel Dots -->
          <div class="dots-container">
            <div
              v-for="(item, index) in carouselItems"
              :key="index"
              :data-index="index"
              :class="['dot', { 'curr': currentSlide === index }]"
              @click="goToSlide(index)"
            ></div>
          </div>
        </div>
      </div>

      <!-- Feed：位置由图片 natural 尺寸换算高度 + 最短列堆叠 -->
      <div
        v-for="({ item, originalIndex }, index) in displayedFeedItems"
        :key="item.id || item.src"
        class="masonry-layout-item-J63wqA masonry-layout-item"
        :data-index="index + 1"
        :style="feedTileStyle(index)"
      >
        <div
          class="feed-item-IXsc39 feed-item-image-NrtAVV cover-container-zfPgao"
          role="button"
          tabindex="0"
          @click="openWorkDetailFromFeed(item, index)"
          @keydown.enter.prevent="openWorkDetailFromFeed(item, index)"
          @keydown.space.prevent="openWorkDetailFromFeed(item, index)"
        >
          <div class="content-TIH4aR">
            <div class="container-bG3PQ9">
              <div style="transition:opacity 300ms;opacity:1">
                <video
                  v-if="item.isVideo"
                  class="cover-W9HnBB discover-masonry-cover"
                  :src="item.videoUrl"
                  :poster="item.src || undefined"
                  muted
                  playsinline
                  preload="metadata"
                  @loadedmetadata="onFeedVideoLoad($event, originalIndex)"
                ></video>
                <img
                  v-else
                  data-apm-action="feed-item-image"
                  elementtiming
                  :fetchpriority="index < 4 ? 'high' : 'low'"
                  loading="lazy"
                  class="cover-W9HnBB discover-masonry-cover"
                  ccfmp-element="true"
                  :src="item.src"
                  :alt="item.alt"
                  @load="onFeedImgLoad($event, originalIndex)"
                  @error="onFeedImgError(originalIndex)"
                >
                <!-- 视频角标 -->
                <span v-if="item.isVideo" class="discover-feed-video-badge" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5v14l11-7L8 5Z" fill="currentColor"></path>
                  </svg>
                </span>
              </div>
            </div>
            <!-- 鼠标移入时显示的作品信息层 -->
            <div class="overlay-WWIpyU discover-feed-overlay" aria-hidden="true">
              <div class="tail discover-feed-overlay-tail">
                <div class="author-g6lhbl concealable-card-element discover-feed-author">
                  <div class="dreamina-component-avatar-container avatar-LRSR55 discover-feed-avatar-shell">
                    <img
                      :src="item.user.avatarSrc"
                      class="dreamina-component-avatar discover-feed-avatar"

                      draggable="false"
                      :alt="item.user.name"
                    >
                  </div>
                  <span class="username discover-feed-author-name">{{ item.user.name }}</span>
                </div>
                <div class="discover-feed-actions">
                <div class="operation discover-feed-operation" title="工作流">
                  <svg width="1em" height="1em" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg" class="icon-yH97ZW">
                    <g>
                      <path data-follow-fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.92 3.537a4 4 0 0 0-2.83 4.899l2.585 9.645a4 4 0 0 0 4.899 2.829l2.737-.733a3.403 3.403 0 0 1-.874-1.837l-2.381.638a2 2 0 0 1-2.45-1.414L4.023 7.918a2 2 0 0 1 1.414-2.45l3.288-.88a2 2 0 0 1 2.45 1.414l2.318 8.654.553-.246a.683.683 0 0 0 .345-.368l.214-.516a3.56 3.56 0 0 1 .445-.784l-1.944-7.257a4 4 0 0 0-4.899-2.829l-3.287.881ZM21.6 9.766l-.885 3.303a3.332 3.332 0 0 0-1.687-1.433l.64-2.388a1.5 1.5 0 0 0-1.061-1.837l-2.437-.653a1.492 1.492 0 0 0-.659-.026l-.473-1.765c-.01-.039-.022-.077-.034-.115l-.016-.055a3.485 3.485 0 0 1 1.7.03l2.436.652A3.5 3.5 0 0 1 21.6 9.766Zm-3.433 11.127.208-.477a3.68 3.68 0 0 1 1.871-1.899l.64-.285a.447.447 0 0 0 0-.812l-.604-.269a3.682 3.682 0 0 1-1.898-1.961l-.214-.516a.427.427 0 0 0-.794 0l-.213.516a3.681 3.681 0 0 1-1.898 1.961l-.605.27a.447.447 0 0 0 0 .811l.64.285a3.68 3.68 0 0 1 1.872 1.899l.207.477a.427.427 0 0 0 .788 0Z" fill="currentColor"></path>
                    </g>
                  </svg>
                </div>
                <div class="operation discover-feed-operation" title="图片">
                  <svg width="1em" height="1em" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg" class="icon-yH97ZW">
                    <g>
                      <path data-follow-fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M16.326 4.72H7.674A2.954 2.954 0 0 0 4.72 7.674v8.652c0 .054.001.108.004.162l3.509-3.508a2.954 2.954 0 0 1 4.03-.138l6.262 5.457c.47-.523.755-1.215.755-1.973V7.674a2.954 2.954 0 0 0-2.954-2.954Zm2.798 15.658a4.919 4.919 0 0 0 2.126-4.052V7.674a4.924 4.924 0 0 0-4.924-4.924H7.674A4.924 4.924 0 0 0 2.75 7.674v8.652a4.924 4.924 0 0 0 4.924 4.924h8.652a4.901 4.901 0 0 0 2.798-.872Zm-2.489-1.114-5.666-4.937a.985.985 0 0 0-1.344.046l-4.041 4.04a2.945 2.945 0 0 0 2.09.867h8.652c.104 0 .208-.005.31-.016ZM14.078 8.401a1.532 1.532 0 1 1 3.064 0 1.532 1.532 0 0 1-3.064 0Z" fill="currentColor"></path>
                    </g>
                  </svg>
                </div>
                <div class="favorite-RlC8dW discover-feed-favorite">
                  <div class="lottie-icon-container icon-QlNaEG discover-feed-operation">
                    <div class="lottie-icon-content">
                      <svg width="1em" height="1em" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" role="presentation" xmlns="http://www.w3.org/2000/svg" class="icon-QlNaEG">
                        <g>
                          <path data-follow-fill="currentColor" d="M8.538 3.513a6.077 6.077 0 0 0-6.085 6.07c0 2.819 1.639 5.278 3.37 7.025 1.75 1.764 3.914 3.13 5.588 3.685a1.87 1.87 0 0 0 1.174 0c1.675-.556 3.84-1.92 5.588-3.685 1.732-1.747 3.37-4.206 3.37-7.025a6.077 6.077 0 0 0-6.084-6.07c-1.381 0-2.572.717-3.46 1.432-.889-.715-2.08-1.432-3.461-1.432Zm0 2a4.077 4.077 0 0 0-4.085 4.07c0 2.05 1.215 4.028 2.79 5.617 1.557 1.57 3.436 2.73 4.755 3.18 1.32-.45 3.2-1.61 4.755-3.18 1.575-1.59 2.79-3.568 2.79-5.617 0-2.24-1.82-4.07-4.084-4.07-.929 0-1.877.652-2.78 1.49a1 1 0 0 1-1.36 0c-.904-.838-1.853-1.49-2.781-1.49Z" clip-rule="evenodd" fill-rule="evenodd" fill="currentColor"></path>
                        </g>
                      </svg>
                    </div>
                  </div>
                  <span class="count-GysjBc discover-feed-favorite-count">{{ formatFavoriteCount(item.favoriteCount) }}</span>
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
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildFeedLayoutsFromSizes,
  computeMasonryMetrics,
  masonryScrollHeight,
} from '@/components/home/discoverMasonryLayout'
import { listAssetItems } from '@/api/asset-items'
import { AUTH_LOGIN_SUCCESS_EVENT, useAuthStore } from '@/stores/auth'
import { buildAssetUrl } from '@/api/http'
import discoverContent from '@/data/homeDiscoverContent.json'

const emit = defineEmits(['open-work-detail'])

// filterType：all=全部 / image=仅图片 / video=仅视频（由 TabsSection 的当前 tab 决定）
// searchKeyword：首页搜索框关键词，按标题/提示词在已加载作品中本地过滤
const props = defineProps({
  filterType: { type: String, default: 'all' },
  searchKeyword: { type: String, default: '' },
})

const authStore = useAuthStore()

// 解析类似 9:16、2/3、1x1 的比例字符串，转换成布局可用的宽高比。
const parseAspectRatioSize = (value) => {
  const text = String(value || '').trim()
  if (!text) return null

  const matched = text.match(/^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/)
  if (!matched) return null

  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { w: width, h: height }
}

// 优先使用后端返回的真实宽高；没有时再退回到比例标签。
const resolveLayoutSize = ({ width, height, aspectRatio }) => {
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { w: width, h: height }
  }

  return parseAspectRatioSize(aspectRatio)
}

const buildFeedItemFromAsset = (item) => {
  const isVideo = item.assetType === 'video'
  return {
    id: item.id,
    isVideo,
    // 图片用预览图；视频海报只用真实封面/缩略图（没有就留空，避免把 mp4 当海报导致黑块）
    src: buildAssetUrl(isVideo ? (item.coverUrl || item.thumbnailUrl || '') : (item.previewUrl || item.fileUrl)),
    // 视频地址带 #t=0.1 媒体片段，让浏览器在无封面时也渲染出首帧作为预览
    videoUrl: isVideo && item.fileUrl ? `${buildAssetUrl(item.fileUrl)}#t=0.1` : '',
    createdAt: item.createdAt,
    alt: item.title || item.promptText || item.id,
    promptText: item.promptText,
    user: {
      id: item.owner?.id || '',
      name: item.owner?.name || '创作者',
      avatarSrc: buildAssetUrl(item.owner?.avatarSrc || ''),
    },
    favoriteCount: item.favoriteCount || 0,
    layoutSize: resolveLayoutSize({
      width: item.width,
      height: item.height,
      aspectRatio: item.aspectRatio,
    }),
    detail: {
      createDate: item.createdAt,
      aiGeneratedText: '内容由 AI 生成',
      promptTipLabel: isVideo ? '视频提示词' : '图片提示词',
      modelLabel: item.modelLabel || (isVideo ? '视频模型' : '图片模型'),
      aspectRatioLabel: item.aspectRatio || '1:1',
    },
  }
}

const buildFallbackFeedItems = () => (
  discoverContent.feedItems.map((item) => ({
    id: item.id,
    src: item.imageSrc,
    alt: item.alt,
    promptText: item.promptText,
    user: item.user || {
      id: '',
      name: '创作者',
      avatarSrc: '',
    },
    favoriteCount: item.favoriteCount || 0,
    layoutSize: resolveLayoutSize({
      aspectRatio: item.detail?.aspectRatioLabel,
    }),
    detail: item.detail,
  }))
)

/**
 * @param {{
 *   gallery: Array<{ imageSrc: string, promptText?: string, user?: { name?: string, avatarSrc?: string }, favoriteCount?: number|string, detail?: { createDate?: string, aiGeneratedText?: string, promptTipLabel?: string, modelLabel?: string, aspectRatioLabel?: string } }>
 *   index: number
 * } | { imageSrc: string, promptText?: string, user?: { name?: string, avatarSrc?: string }, favoriteCount?: number|string, detail?: { createDate?: string, aiGeneratedText?: string, promptTipLabel?: string, modelLabel?: string, aspectRatioLabel?: string } }} payload
 */
function emitOpenWorkDetail(payload) {
  emit('open-work-detail', payload)
}

// 使用 Fisher–Yates 打乱数组顺序，返回新数组，不修改原始数据。
function shuffleArray(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

function formatFavoriteCount(count) {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
  return String(count)
}

const feedItems = ref([])

// 按搜索关键词在已加载作品中本地过滤（匹配标题/alt 或提示词，忽略大小写）；
// 保留 originalIndex 以便复用按 feedItems 下标缓存的自然尺寸。
const displayedFeedItems = computed(() => {
  const keyword = String(props.searchKeyword || '').trim().toLowerCase()
  const withIndex = feedItems.value.map((item, originalIndex) => ({ item, originalIndex }))
  if (!keyword) return withIndex
  return withIndex.filter(({ item }) => {
    const title = String(item.alt || '').toLowerCase()
    const prompt = String(item.promptText || '').toLowerCase()
    return title.includes(keyword) || prompt.includes(keyword)
  })
})

// 空状态文案（按当前筛选类型，搜索无结果时单独提示）
const emptyText = computed(() => {
  if (feedItems.value.length && String(props.searchKeyword || '').trim()) {
    return '没有找到匹配的作品，换个关键词试试～'
  }
  if (props.filterType === 'image') return '还没有图片作品，去生成你的第一张图片吧～'
  if (props.filterType === 'video') return '还没有视频作品，去生成你的第一个视频吧～'
  return '还没有作品，去创作你的第一个作品吧～'
})

/** 每张图 natural 尺寸；未拿到真实尺寸时回退到接口/配置提供的比例提示 */
const feedNaturalSizes = ref(
  /** @type {Array<{ w: number; h: number } | null>} */
  ([]),
)

// 瀑布流布局优先使用真实尺寸，失败或未加载时再回退到数据自带的比例提示。
// 自然尺寸缓存按 feedItems 原始下标存取，过滤后用 originalIndex 取回。
const feedDisplaySizes = computed(() =>
  displayedFeedItems.value.map(({ item, originalIndex }) => (
    feedNaturalSizes.value[originalIndex] || item.layoutSize || null
  )),
)

watch(
  () => feedItems.value.map((x) => x.src),
  (urls) => {
    feedNaturalSizes.value = urls.map(() => null)
  },
  { immediate: true },
)

function onFeedImgLoad(ev, index) {
  const el = ev.target
  if (!el || !el.naturalWidth || !el.naturalHeight) return
  const next = feedNaturalSizes.value.slice()
  next[index] = { w: el.naturalWidth, h: el.naturalHeight }
  feedNaturalSizes.value = next
}

function onFeedVideoLoad(ev, index) {
  const el = ev.target
  if (!el || !el.videoWidth || !el.videoHeight) return
  // 无封面图时 seek 到首帧，强制浏览器渲染出预览画面（否则是黑块）。
  try {
    if (!el.currentTime) el.currentTime = 0.1
  } catch {}
  const next = feedNaturalSizes.value.slice()
  next[index] = { w: el.videoWidth, h: el.videoHeight }
  feedNaturalSizes.value = next
}

function onFeedImgError(index) {
  if (feedNaturalSizes.value[index]) return
  const fallbackSize = feedItems.value[index]?.layoutSize
  if (!fallbackSize) return
  // 图片请求失败时，保留接口或配置里已有的比例，避免退化成 1:1 方图。
  const next = feedNaturalSizes.value.slice()
  next[index] = fallbackSize
  feedNaturalSizes.value = next
}

/** 瀑布流轨道宽度，用于按屏宽重算列；ResizeObserver 更新 */
const trackRef = ref(null)
const trackWidth = ref(1653)

let trackResizeObserver = null
/** @type {(() => void) | null} */
let trackWinResize = null
/** @type {((event: Event) => void) | null} */
let assetDeletedListener = null

/** @type {((event: Event) => void) | null} */
let authLoginSuccessListener = null

onMounted(() => {
  const el = trackRef.value
  if (!el) return
  const apply = () => {
    const w = el.getBoundingClientRect().width
    if (w > 0) trackWidth.value = w
  }
  apply()
  if (typeof ResizeObserver !== 'undefined') {
    trackResizeObserver = new ResizeObserver(() => apply())
    trackResizeObserver.observe(el)
  } else {
    trackWinResize = apply
    window.addEventListener('resize', trackWinResize)
  }
})

// 首页展示「当前登录用户」自己生成的图片 + 视频，按时间倒序。未登录则清空（区域由 home 隐藏）。
const loadDiscoverFeedItems = async () => {
  if (!authStore.isLoggedIn.value) {
    feedItems.value = []
    return
  }

  try {
    // 按当前 tab 过滤类型加载。接口一次只返回一种类型，全部=图片/视频各拉一次合并。
    let assets = []
    if (props.filterType === 'image') {
      assets = await listAssetItems({ scope: 'mine', assetType: 'image', take: 80 })
    } else if (props.filterType === 'video') {
      assets = await listAssetItems({ scope: 'mine', assetType: 'video', take: 80 })
    } else {
      const [images, videos] = await Promise.all([
        listAssetItems({ scope: 'mine', assetType: 'image', take: 60 }),
        listAssetItems({ scope: 'mine', assetType: 'video', take: 60 }),
      ])
      assets = [...images, ...videos]
    }

    feedItems.value = assets
      .map(buildFeedItemFromAsset)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch (error) {
    console.warn('读取我的作品失败。', error)
    feedItems.value = []
  }
}

onMounted(async () => {
  await loadDiscoverFeedItems()
})

// 登录态变化（登入/登出）时重新加载或清空。
watch(() => authStore.isLoggedIn.value, () => {
  void loadDiscoverFeedItems()
})

// 切换 全部/图片/视频 tab 时重新加载。
watch(() => props.filterType, () => {
  void loadDiscoverFeedItems()
})

onMounted(() => {
  assetDeletedListener = (event) => {
    const deletedAssetId = event instanceof CustomEvent ? String(event.detail?.id || '').trim() : ''
    if (!deletedAssetId) return
    feedItems.value = feedItems.value.filter(item => item.id !== deletedAssetId)
  }

  document.addEventListener('asset-item-deleted', assetDeletedListener)

  authLoginSuccessListener = () => {
    void loadDiscoverFeedItems()
  }
  window.addEventListener(AUTH_LOGIN_SUCCESS_EVENT, authLoginSuccessListener)
})

onBeforeUnmount(() => {
  trackResizeObserver?.disconnect()
  trackResizeObserver = null
  if (trackWinResize) {
    window.removeEventListener('resize', trackWinResize)
    trackWinResize = null
  }
  if (assetDeletedListener) {
    document.removeEventListener('asset-item-deleted', assetDeletedListener)
    assetDeletedListener = null
  }
  if (authLoginSuccessListener) {
    window.removeEventListener(AUTH_LOGIN_SUCCESS_EVENT, authLoginSuccessListener)
    authLoginSuccessListener = null
  }
})

const masonryMetrics = computed(() => {
  // 顶部 banner 已移除：把 heroRect 置零，让瀑布流从顶部铺满、不留空位。
  const metrics = computeMasonryMetrics(trackWidth.value)
  return { ...metrics, heroRect: { left: 0, top: 0, width: 0, height: 0 } }
})

const feedLayouts = computed(() =>
  buildFeedLayoutsFromSizes(feedDisplaySizes.value, masonryMetrics.value),
)

const scrollHeight = computed(() =>
  masonryScrollHeight(feedLayouts.value, masonryMetrics.value.heroRect),
)

const heroInlineStyle = computed(() => {
  const h = masonryMetrics.value.heroRect
  return {
    left: `${h.left}px`,
    top: `${h.top}px`,
    width: `${h.width}px`,
    height: `${h.height}px`,
  }
})

function feedTileStyle(index) {
  const r = feedLayouts.value[index]
  if (!r) {
    return { left: '0', top: '0', width: '0', height: '0', visibility: 'hidden' }
  }
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  }
}

const currentSlide = ref(0)

const carouselItems = ref(
  discoverContent.heroItems.map((item) => ({
    id: item.id,
    title: item.title,
    participants: item.participants,
    image: item.imageSrc,
    promptText: item.promptText,
  })),
)

const getCarouselItemClass = (index) => {
  if (index === currentSlide.value) return 'curr'
  if (index === (currentSlide.value + 1) % carouselItems.value.length) return 'next-fFJk8u'
  if (index === (currentSlide.value - 1 + carouselItems.value.length) % carouselItems.value.length) {
    return 'prev'
  }
  return ''
}

const nextSlide = () => {
  currentSlide.value = (currentSlide.value + 1) % carouselItems.value.length
}

const prevSlide = () => {
  currentSlide.value = (currentSlide.value - 1 + carouselItems.value.length) % carouselItems.value.length
}

const goToSlide = (index) => {
  currentSlide.value = index
}

function openWorkDetailFromFeed(item, index) {
  // 画廊与 index 都基于当前展示（过滤后）列表，保证弹层上下切换停留在搜索结果内。
  emitOpenWorkDetail({
    gallery: displayedFeedItems.value.map(({ item: it }) => ({
      id: it.id,
      imageSrc: it.src,
      isVideo: Boolean(it.isVideo),
      // 详情播放用干净地址（去掉首帧预览的 #t 片段）
      videoSrc: it.isVideo ? String(it.videoUrl || '').split('#')[0] : '',
      promptText: it.promptText || it.alt,
      user: it.user,
      favoriteCount: it.favoriteCount,
      detail: it.detail,
    })),
    index,
  })
}

function openWorkDetailFromCarousel(item, index) {
  emitOpenWorkDetail({
    gallery: carouselItems.value.map((it) => ({
      id: it.id,
      imageSrc: it.image,
      promptText: it.promptText || it.title,
      user: it.user,
      favoriteCount: it.favoriteCount,
    })),
    index,
  })
}
</script>

<style scoped>
.discover-masonry-viewport {
  border-radius: 16px;
  overflow: hidden;
  width: 100%;
  min-width: 0;
  /* 避免子层圆角裁切抗锯齿问题 */
  isolation: isolate;
}

.discover-masonry-shell {
  min-width: 0;
  overflow-x: auto;
  position: relative;
  width: 100%;
  -webkit-overflow-scrolling: touch;
}

.discover-masonry-track {
  box-sizing: border-box;
  min-width: 0;
  position: relative;
  width: 100%;
}

.discover-masonry-cover {
  object-fit: cover;
}

.discover-feed-video-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  pointer-events: none;
}

.discover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 60px 16px;
  text-align: center;
}

.discover-empty__text {
  color: var(--text-tertiary, #6b7785);
  font-size: 14px;
  line-height: 22px;
}

.cover-container-zfPgao {
  position: relative;
  overflow: hidden;
}

.discover-feed-overlay {
  position: absolute;
  inset: 0;
  display: block;
  color: #fff;
  background: linear-gradient(
    180deg,
    rgba(10, 10, 12, 0) 42%,
    rgba(10, 10, 12, 0.12) 64%,
    rgba(10, 10, 12, 0.56) 100%
  );
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.feed-item-IXsc39:hover .discover-feed-overlay,
.feed-item-IXsc39:focus-visible .discover-feed-overlay,
.feed-item-IXsc39:focus-within .discover-feed-overlay {
  opacity: 1;
}

.discover-feed-overlay-tail {
  position: absolute;
  right: 12px;
  bottom: 10px;
  left: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.discover-feed-author {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}

.discover-feed-avatar-shell {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  overflow: hidden;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.14);
}

.discover-feed-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.discover-feed-author-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
}

.discover-feed-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: 0 0 auto;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}

.discover-feed-operation,
.discover-feed-favorite {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.discover-feed-operation {
  justify-content: center;
  width: 18px;
  height: 18px;
  color: rgba(255, 255, 255, 0.92);
  font-size: 18px;
}

.discover-feed-favorite-count {
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.92);
}
</style>
