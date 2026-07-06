import { sendJson, readJsonBody } from '../ai-gateway/shared'
import { isPrismaConfigured } from '../db/prisma'
import { readCurrentSessionUser, requireAdminSessionUser } from '../auth/session'
import { recordAdminAuditLog } from '../shared/admin-audit'
import {
  getAdminVendorSettings,
  getPublicVendorCatalog,
  resolveVendorScope,
  upsertVendorSetting,
  type VendorSettingUpdatePayload,
} from './service'
import { VENDOR_CATALOG_PATH, VENDOR_SETTINGS_PATH } from './constants'

const matchSettingDetail = (requestPath: string) => {
  const matched = requestPath.match(/^\/api\/vendor\/settings\/([^/]+)$/)
  return matched ? { vendorCode: decodeURIComponent(matched[1]) } : null
}

// 处理内置厂商相关请求：公开模型目录 + 后台「填 key / 调价」。
export const handleVendorRequest = async (req: any, res: any) => {
  try {
    const requestPath = String(req.url || '').split('?')[0]

    // 公开：按请求者所属管理员作用域返回模型目录（未登录→全局）。
    if (req.method === 'GET' && requestPath === VENDOR_CATALOG_PATH) {
      const currentUser = await readCurrentSessionUser(req)
      const scope = await resolveVendorScope(currentUser?.id)
      const data = await getPublicVendorCatalog(scope)
      sendJson(res, 200, { data })
      return
    }

    if (!isPrismaConfigured()) {
      sendJson(res, 500, { error: '缺少 DATABASE_URL，暂时无法使用后端配置存储。' })
      return
    }

    // 后台：读取当前管理员作用域的厂商 key 掩码 + 定价。
    if (req.method === 'GET' && requestPath === VENDOR_SETTINGS_PATH) {
      const currentUser = await requireAdminSessionUser(req, res)
      if (!currentUser) return
      const scope = await resolveVendorScope(currentUser.id)
      const data = await getAdminVendorSettings(scope)
      sendJson(res, 200, { data })
      return
    }

    // 后台：写入当前管理员作用域某厂商的 key/启停/定价。
    const detail = matchSettingDetail(requestPath)
    if (req.method === 'PUT' && detail) {
      const currentUser = await requireAdminSessionUser(req, res)
      if (!currentUser) return
      const scope = await resolveVendorScope(currentUser.id)
      const payload = (await readJsonBody(req)) as VendorSettingUpdatePayload | null

      await upsertVendorSetting(scope, detail.vendorCode, payload || {})

      await recordAdminAuditLog({
        req,
        operatorUserId: currentUser.id,
        action: 'vendor.settings.update',
        targetType: 'vendor',
        targetId: detail.vendorCode,
        afterJson: {
          // 明文 key 不入审计，只记「是否变更了 key」。
          apiKeyChanged: payload?.apiKey !== undefined,
          isEnabled: payload?.isEnabled,
          pricingModels: payload?.pricing ? Object.keys(payload.pricing) : undefined,
        },
      })

      const data = await getAdminVendorSettings(scope)
      sendJson(res, 200, { data })
      return
    }

    sendJson(res, 404, { error: '未找到接口' })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : '服务器错误' })
  }
}
