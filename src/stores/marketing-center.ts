import { computed, ref } from 'vue'
import {
  getMarketingCenterOverview,
  redeemMarketingCardCode,
  type MarketingCenterOverviewResponse,
} from '@/api/marketing-center'
import { AUTH_LOGIN_SUCCESS_EVENT } from '@/stores/auth'

export const MARKETING_POINTS_UPDATED_EVENT = 'marketing:points-updated'

const overview = ref<MarketingCenterOverviewResponse | null>(null)
const loading = ref(false)
const submitting = ref(false)
let loadPromise: Promise<MarketingCenterOverviewResponse | null> | null = null
let authEventBound = false
// 内存 TTL：概览随每次路由切换被 TopMenuBar/BottomMenu 重挂载重拉，加 60s TTL 去重；
// 积分变更 / 登录走 force=true 绕过（见 ensureAuthRefreshListener），不会读到陈旧余额。
let overviewLoadedAt = 0
const OVERVIEW_TTL_MS = 60_000

// 全局营销数据单例，统一承接积分余额与卡密兑换视图。
export const useMarketingCenterStore = () => {
  const pointsBalance = computed(() => overview.value?.points.balance || 0)
  const cardRedeemRecords = computed(() => overview.value?.cardRedeemRecords || [])

  const ensureAuthRefreshListener = () => {
    if (authEventBound || typeof window === 'undefined') {
      return
    }
    authEventBound = true
    window.addEventListener(AUTH_LOGIN_SUCCESS_EVENT, () => {
      void loadOverview(true)
    })
    window.addEventListener(MARKETING_POINTS_UPDATED_EVENT, () => {
      void loadOverview(true)
    })
  }

  const clearOverview = () => {
    overview.value = null
    overviewLoadedAt = 0 // 登出后清时间戳，下次登录立即真实重拉
  }

  const loadOverview = async (force = false) => {
    ensureAuthRefreshListener()

    if (loadPromise && !force) {
      return loadPromise
    }
    // TTL 命中：未过期直接复用内存概览。
    if (!force && overviewLoadedAt && Date.now() - overviewLoadedAt < OVERVIEW_TTL_MS) {
      return overview.value
    }

    loading.value = true
    loadPromise = getMarketingCenterOverview()
      .then((result) => {
        overview.value = result
        overviewLoadedAt = Date.now()
        return result
      })
      .finally(() => {
        loading.value = false
        loadPromise = null
      })

    return loadPromise
  }

  const runWithReload = async <T>(task: () => Promise<T>) => {
    submitting.value = true
    try {
      const result = await task()
      await loadOverview(true)
      return result
    } finally {
      submitting.value = false
    }
  }

  const redeemCode = async (code: string) => {
    return runWithReload(() => redeemMarketingCardCode(code))
  }

  return {
    overview,
    loading,
    submitting,
    pointsBalance,
    cardRedeemRecords,
    loadOverview,
    clearOverview,
    redeemCode,
  }
}
