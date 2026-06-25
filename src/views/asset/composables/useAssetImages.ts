import { computed, ref } from 'vue'
import { listAssetItems, type PersistedAssetItem } from '@/api/asset-items'
import { buildAssetUrl } from '@/api/http'
import type { ImageGroup, ImageItem } from '@/views/asset/types'

const formatGroupDate = (value: string | Date) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知日期'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const buildImageGroups = (items: Array<ImageItem & { createdAt?: string }>) => {
  const groups = new Map<string, ImageItem[]>()

  items.forEach((item) => {
    const groupKey = formatGroupDate(item.createdAt || new Date().toISOString())
    const current = groups.get(groupKey) || []
    current.push(item)
    groups.set(groupKey, current)
  })

  return Array.from(groups.entries()).map(([date, images], index) => ({
    date,
    isFirst: index === 0,
    images,
  }))
}

const getAssetResolutionLabel = (item: PersistedAssetItem) => {
  const sourceMeta = (item.sourceMeta || {}) as Record<string, unknown>
  const explicitLabel = sourceMeta.resolutionLabel
  if (typeof explicitLabel === 'string' && explicitLabel.trim() !== '') {
    return explicitLabel
  }

  const width = item.width || 0
  const height = item.height || 0
  const maxSide = Math.max(width, height)

  if (maxSide >= 3840) return '4K'
  if (maxSide >= 2048) return '2K'
  if (maxSide >= 1280) return '高清'
  return '标清'
}

const buildImageGroupsFromAssets = (items: PersistedAssetItem[]) => buildImageGroups(
  items.map(item => ({
    id: item.id,
    src: buildAssetUrl(item.previewUrl || item.fileUrl),
    promptText: item.promptText,
    modelLabel: item.modelLabel || '图片 4.0',
    aspectRatioLabel: item.aspectRatio || '1:1',
    resolutionLabel: getAssetResolutionLabel(item),
    createDate: item.createdAt,
    createdAt: item.createdAt,
  })),
)

const IMAGE_PAGE_SIZE = 40

export const useAssetImages = () => {
  const imageGroups = ref<ImageGroup[]>([])
  // 性能：保留原始已加载项，增量加载时只追加并重建分组，避免一次性拉取 120 条。
  const rawItems = ref<PersistedAssetItem[]>([])
  const loading = ref(false) // 首批加载中（用于骨架屏）
  const loadingMore = ref(false) // 增量加载中（用于底部 loading）
  const hasMore = ref(true)
  const page = ref(0)

  const allImages = computed(() => imageGroups.value.flatMap(group => group.images))

  const fetchNextImagePage = async () => {
    const nextPage = page.value + 1
    const assets = await listAssetItems({
      scope: 'mine',
      assetType: 'image',
      page: nextPage,
      pageSize: IMAGE_PAGE_SIZE,
    })
    page.value = nextPage
    // 返回数不足一页即视为到底（精确性由再请求一次返回空兜底）。
    hasMore.value = assets.length === IMAGE_PAGE_SIZE
    rawItems.value = [...rawItems.value, ...assets]
    imageGroups.value = rawItems.value.length ? buildImageGroupsFromAssets(rawItems.value) : []
  }

  // 首批加载 / 刷新（筛选变化、增删后重载都走这里，重置到第一页）。
  const loadImageAssets = async () => {
    loading.value = true
    hasMore.value = true
    page.value = 0
    rawItems.value = []
    imageGroups.value = []
    try {
      await fetchNextImagePage()
    } catch (error) {
      console.warn('读取资产列表失败。', error)
      imageGroups.value = []
      rawItems.value = []
    } finally {
      loading.value = false
    }
  }

  // 滚动触底时的增量加载（追加下一页）。
  const loadMoreImageAssets = async () => {
    if (loading.value || loadingMore.value || !hasMore.value) {
      return
    }
    loadingMore.value = true
    try {
      await fetchNextImagePage()
    } catch (error) {
      console.warn('加载更多图片资产失败。', error)
    } finally {
      loadingMore.value = false
    }
  }

  const resolvePreviewIndexByItemId = (itemId: string) => {
    return allImages.value.findIndex(img => img.id === itemId)
  }

  return {
    allImages,
    imageGroups,
    loading,
    loadingMore,
    hasMore,
    loadImageAssets,
    loadMoreImageAssets,
    resolvePreviewIndexByItemId,
  }
}
