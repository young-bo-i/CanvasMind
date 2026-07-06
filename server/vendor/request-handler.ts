import { sendJson, readJsonBody } from '../shared/http'
import { isPrismaConfigured } from '../db/prisma'
import { readCurrentSessionUser, requireAdminSessionUser } from '../auth/session'
import { recordAdminAuditLog } from '../shared/admin-audit'
import {
  getAdminVendorSettings,
  getPublicVendorCatalog,
  listConfigurableScopes,
  resolveManageScope,
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

    const query = new URL(req.url || '', 'http://localhost').searchParams

    // 后台：超管可管理的作用域清单（全局 + 各普通管理员）。普管拿到的是空清单(用不到选择器)。
    if (req.method === 'GET' && requestPath === `${VENDOR_SETTINGS_PATH}/scopes`) {
      const currentUser = await requireAdminSessionUser(req, res)
      if (!currentUser) return
      const data = currentUser.role === 'SUPER_ADMIN' ? await listConfigurableScopes() : []
      sendJson(res, 200, { data })
      return
    }

    // 后台：读取作用域的厂商 key 掩码 + 定价。
    // 超管可用 ?scope=<管理员id|global> 查看某个管理员的配置；普管锁定自己。
    if (req.method === 'GET' && requestPath === VENDOR_SETTINGS_PATH) {
      const currentUser = await requireAdminSessionUser(req, res)
      if (!currentUser) return
      const scope = await resolveManageScope(currentUser, query.get('scope'))
      const data = await getAdminVendorSettings(scope)
      sendJson(res, 200, { data })
      return
    }

    // 后台：写入某作用域某厂商的 key/启停/定价（超管可带 body.scope 指定管理员；普管锁定自己）。
    const detail = matchSettingDetail(requestPath)
    if (req.method === 'PUT' && detail) {
      const currentUser = await requireAdminSessionUser(req, res)
      if (!currentUser) return
      const payload = (await readJsonBody(req)) as (VendorSettingUpdatePayload & { scope?: string | null }) | null
      const scope = await resolveManageScope(currentUser, payload?.scope)

      await upsertVendorSetting(scope, detail.vendorCode, payload || {})

      await recordAdminAuditLog({
        req,
        operatorUserId: currentUser.id,
        action: 'vendor.settings.update',
        targetType: 'vendor',
        targetId: detail.vendorCode,
        afterJson: {
          // 明文 key 不入审计，只记「是否变更了 key」+ 目标作用域（超管代配时可追溯）。
          scope: scope || 'global',
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
