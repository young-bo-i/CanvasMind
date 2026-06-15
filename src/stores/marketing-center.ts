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
  }

  const loadOverview = async (force = false) => {
    ensureAuthRefreshListener()

    if (loadPromise && !force) {
      return loadPromise
    }

    loading.value = true
    loadPromise = getMarketingCenterOverview()
      .then((result) => {
        overview.value = result
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
