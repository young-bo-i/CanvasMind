import { sendJson } from '../shared/http'
import { requireAdminSessionUser, requireCurrentSessionUser } from '../auth/session'
import { isPrismaConfigured } from '../db/prisma'
import { readAssetActionBody, readAssetListQuery, sendAssetItemsError } from './shared'
import {
  applyAssetAction,
  getAssetItemForDownload,
  listAllAssetItems,
  listMineAssetItems,
  listPublicAssetItems,
  recordAssetItemDownload,
} from './service'
import { ASSET_ITEMS_BASE_PATH } from './constants'
import { resolveMediaDownloadStatus, sendMediaDownload } from '../generation-records/download'

// 处理资源列表请求。
export const handleAssetItemsRequest = async (req: any, res: any) => {
  const parsedRequestUrl = new URL(String(req.url || ''), 'http://localhost')
  const pathname = parsedRequestUrl.pathname
  const relativeRequestPath = pathname.startsWith(`${ASSET_ITEMS_BASE_PATH}/`)
    ? pathname.slice(ASSET_ITEMS_BASE_PATH.length + 1)
    : ''
  const requestPathSegments = relativeRequestPath
    .split('/')
    .map(segment => decodeURIComponent(segment))
    .filter(Boolean)
  const assetId = requestPathSegments[0] || ''
  const action = requestPathSegments[1] || ''

  try {
    if (!isPrismaConfigured()) {
      sendAssetItemsError(res, 500, '缺少 DATABASE_URL，暂时无法使用资源存储。')
      return
    }

    const requestUrl = String(req.url || '')

    if (req.method === 'GET' && pathname === ASSET_ITEMS_BASE_PATH) {
      const query = readAssetListQuery(requestUrl)
      if (query.scope === 'mine') {
        const currentUser = await requireCurrentSessionUser(req, res)
        if (!currentUser) {
          return
        }

        const data = await listMineAssetItems(query, currentUser.id)
        sendJson(res, 200, { data })
        return
      }

      if (query.scope === 'all') {
        const currentUser = await requireAdminSessionUser(req, res)
        if (!currentUser) {
          return
        }

        const data = await listAllAssetItems(query, { id: currentUser.id, role: currentUser.role })
        sendJson(res, 200, { data })
        return
      }

      const data = await listPublicAssetItems(query)
      sendJson(res, 200, { data })
      return
    }

    if (req.method === 'GET' && assetId && action === 'download') {
      const currentUser = await requireCurrentSessionUser(req, res)
      if (!currentUser) {
        return
      }

      const source = await getAssetItemForDownload(assetId, {
        id: currentUser.id,
        role: currentUser.role,
      })
      if (!source) {
        sendAssetItemsError(res, 404, '资源不存在或无权下载')
        return
      }

      await sendMediaDownload(res, source)
      try {
        await recordAssetItemDownload(source.assetId)
      } catch (error) {
        console.warn('记录资源下载次数失败', error)
      }
      return
    }

    if (req.method === 'POST' && pathname === `${ASSET_ITEMS_BASE_PATH}/actions`) {
      const currentUser = await requireCurrentSessionUser(req, res)
      if (!currentUser) {
        return
      }

      const payload = await readAssetActionBody(req)
      if (payload.scope === 'feed') {
        sendAssetItemsError(res, 400, '公开资源不支持直接执行后台动作')
        return
      }

      const isBackofficeRole = currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN'
      if (payload.scope === 'all' && !isBackofficeRole) {
        sendAssetItemsError(res, 403, '只有管理员可以操作全站资源')
        return
      }

      const data = await applyAssetAction(payload, currentUser.id, isBackofficeRole, { id: currentUser.id, role: currentUser.role })
      sendJson(res, 200, { data })
      return
    }

    sendAssetItemsError(res, 405, 'Method Not Allowed')
  } catch (error: any) {
    if (res.writableEnded) {
      return
    }
    if (res.headersSent) {
      try {
        res.destroy()
      } catch {
        // 下载流已经开始，无法再返回 JSON。
      }
      return
    }
    sendAssetItemsError(
      res,
      action === 'download' ? resolveMediaDownloadStatus(error) : 500,
      error?.message || (action === 'download' ? '资源下载失败' : '处理资源请求失败'),
    )
  }
}
