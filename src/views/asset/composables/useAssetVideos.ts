import { computed, ref } from 'vue'
import { listAssetItems, type PersistedAssetItem } from '@/api/asset-items'
import { buildAssetUrl } from '@/api/http'
import type { VideoGroup, VideoItem } from '@/views/asset/types'

const formatGroupDate = (value: string | Date) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知日期'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const buildVideoGroups = (items: Array<VideoItem & { createdAt?: string }>): VideoGroup[] => {
  const groups = new Map<string, VideoItem[]>()

  items.forEach((item) => {
    const groupKey = formatGroupDate(item.createdAt || new Date().toISOString())
    const current = groups.get(groupKey) || []
    current.push(item)
    groups.set(groupKey, current)
  })

  return Array.from(groups.entries()).map(([date, videos], index) => ({
    date,
    isFirst: index === 0,
    videos,
  }))
}

const formatDurationLabel = (item: PersistedAssetItem) => {
  const seconds = Number(item.durationSeconds || 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  return `${Math.round(seconds)}s`
}

const buildVideoGroupsFromAssets = (items: PersistedAssetItem[]) => buildVideoGroups(
  items.map(item => ({
    id: item.id,
    // 与首页一致:src 带 #t=0.1 媒体片段,让浏览器在无封面时也原生渲染首帧作为预览(纯 JS seek 在生产/无 Range 时不可靠)。
    src: item.fileUrl ? `${buildAssetUrl(item.fileUrl)}#t=0.1` : '',
    // 海报只用真实封面/缩略图;没有就留空(绝不用 mp4 当海报,否则黑块)。
    poster: (item.coverUrl || item.thumbnailUrl) ? buildAssetUrl(item.coverUrl || item.thumbnailUrl) : undefined,
    promptText: item.promptText,
    modelLabel: item.modelLabel || '视频',
    durationLabel: formatDurationLabel(item),
    createDate: item.createdAt,
    createdAt: item.createdAt,
  })),
)

export const useAssetVideos = () => {
  const videoGroups = ref<VideoGroup[]>([])

  const allVideos = computed(() => videoGroups.value.flatMap(group => group.videos))

  const loadVideoAssets = async () => {
    try {
      const assets = await listAssetItems({
        scope: 'mine',
        assetType: 'video',
        take: 120,
      })

      videoGroups.value = assets.length ? buildVideoGroupsFromAssets(assets) : []
    } catch (error) {
      // 401(未登录)由 readApiData 统一拉起登录弹窗;其它错误已由其默认 toast 提示。这里仅置空避免崩页。
      console.warn('读取视频资产列表失败。', error)
      videoGroups.value = []
    }
  }

  const resolvePreviewIndexByItemId = (itemId: string) => {
    return allVideos.value.findIndex(video => video.id === itemId)
  }

  return {
    allVideos,
    videoGroups,
    loadVideoAssets,
    resolvePreviewIndexByItemId,
  }
}
