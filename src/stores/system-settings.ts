import { computed, ref, watch } from 'vue'
import {
  createDefaultConversationSettings,
  createDefaultGlobalThemeSettings,
  createDefaultHomeLayoutSettings,
  createDefaultHomeSideMenuSettings,
  getPublicSystemConfig,
  type SystemConfigPayload,
} from '@/api/system-config'
import { applySystemThemeRuntime, refreshSystemThemeRuntime } from '@/utils/theme-runtime'
import { useThemePreferenceStore } from '@/stores/theme-preference'

const createDefaultSettings = (): SystemConfigPayload => ({
  siteInfo: {
    siteName: 'Canana',
    siteDescription: '',
    icpText: '',
    icpLink: '',
    copyrightText: '',
  },
  policySettings: {
    agreementRequired: true,
    agreementTextPrefix: '已阅读并同意',
    userAgreementTitle: '用户服务协议',
    userAgreementUrl: '',
    userAgreementContent: '',
    privacyPolicyTitle: '隐私政策',
    privacyPolicyUrl: '',
    privacyPolicyContent: '',
    aiNoticeTitle: 'AI功能使用须知',
    aiNoticeUrl: '',
    aiNoticeContent: '',
  },
  loginSettings: {
    welcomeTitle: '欢迎登录',
    welcomeSubtitle: '',
  },
  generationProgressSettings: {
    enabled: true,
    stages: [
      { key: 'queued', label: '排队中', percent: 5, showPercent: true, description: '任务已创建，等待服务端执行' },
      { key: 'resolved_provider', label: '准备中', percent: 12, showPercent: true, description: '已解析厂商与模型配置' },
      { key: 'requesting_upstream', label: '生成中', percent: 35, showPercent: true, description: '已开始请求上游图片模型' },
      { key: 'receiving_upstream_result', label: '解析中', percent: 72, showPercent: true, description: '上游已返回结果，正在解析图片内容' },
      { key: 'syncing_record', label: '同步中', percent: 92, showPercent: true, description: '图片结果已解析，正在同步记录与资源信息' },
      { key: 'completed', label: '已完成', percent: 100, showPercent: false, description: '任务执行完成' },
      { key: 'failing', label: '收尾中', percent: 96, showPercent: true, description: '任务执行异常，正在写入失败状态' },
      { key: 'failed', label: '生成失败', percent: 100, showPercent: false, description: '任务执行失败' },
      { key: 'stopping', label: '停止中', percent: 98, showPercent: true, description: '任务已收到停止指令，正在收口状态' },
      { key: 'stopped', label: '已停止', percent: 100, showPercent: false, description: '任务已停止' },
    ],
  },
  conversationSettings: createDefaultConversationSettings(),
  globalThemeSettings: createDefaultGlobalThemeSettings(),
  homeSideMenuSettings: createDefaultHomeSideMenuSettings(),
  homeLayoutSettings: createDefaultHomeLayoutSettings(),
})

const publicSystemSettings = ref<SystemConfigPayload>(createDefaultSettings())
const settingsLoading = ref(false)
let loadSettingsPromise: Promise<SystemConfigPayload> | null = null
// 内存 TTL：站点公共配置随导航被反复请求，60s 内非 force 复用内存值。
let settingsLoadedAt = 0
const SETTINGS_TTL_MS = 60_000

const syncSiteRuntime = (settings: SystemConfigPayload) => {
  if (typeof document === 'undefined') {
    return
  }

  const siteName = String(settings.siteInfo.siteName || '').trim()
  if (siteName) {
    document.title = siteName
  }

  const description = String(settings.siteInfo.siteDescription || '').trim()
  let descriptionMeta = document.querySelector('meta[name="description"]')
  if (!descriptionMeta) {
    descriptionMeta = document.createElement('meta')
    descriptionMeta.setAttribute('name', 'description')
    document.head.appendChild(descriptionMeta)
  }
  descriptionMeta.setAttribute('content', description)
  // favicon 已在 index.html 写死为固定品牌图标，不再随后台配置动态设置。
}

const syncThemeRuntime = (settings: SystemConfigPayload) => {
  applySystemThemeRuntime(settings)
}

const applyPublicSystemSettings = (settings?: SystemConfigPayload | null) => {
  publicSystemSettings.value = settings || createDefaultSettings()
  syncSiteRuntime(publicSystemSettings.value)
  syncThemeRuntime(publicSystemSettings.value)
  return publicSystemSettings.value
}

if (typeof document !== 'undefined') {
  syncSiteRuntime(publicSystemSettings.value)
  syncThemeRuntime(publicSystemSettings.value)

  const themeStore = useThemePreferenceStore()
  watch(
    () => themeStore.currentTheme.value,
    () => {
      refreshSystemThemeRuntime(publicSystemSettings.value)
    },
  )
}

export const useSystemSettingsStore = () => {
  const siteName = computed(() => publicSystemSettings.value.siteInfo.siteName)

  const loadPublicSettings = async (force = false) => {
    if (loadSettingsPromise && !force) {
      return loadSettingsPromise
    }
    // TTL 命中：未过期直接复用内存配置。
    if (!force && settingsLoadedAt && Date.now() - settingsLoadedAt < SETTINGS_TTL_MS) {
      return publicSystemSettings.value
    }

    settingsLoading.value = true
    loadSettingsPromise = getPublicSystemConfig()
      .then((result) => {
        settingsLoadedAt = Date.now()
        return applyPublicSystemSettings(result || createDefaultSettings())
      })
      .catch(() => applyPublicSystemSettings(createDefaultSettings()))
      .finally(() => {
        settingsLoading.value = false
        loadSettingsPromise = null
      })

    return loadSettingsPromise
  }

  return {
    publicSystemSettings,
    siteName,
    settingsLoading,
    loadPublicSettings,
    applyPublicSystemSettings,
  }
}
