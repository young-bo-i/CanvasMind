import { sendJson } from '../ai-gateway/shared'
import { requireAdminSessionUser } from '../auth/session'
import { isPrismaConfigured } from '../db/prisma'
import { ADMIN_GENERATION_RECORDS_BASE_PATH } from './constants'
import { listAdminGenerationRecords } from './service'
import { readAdminGenerationRecordsQuery, sendAdminGenerationRecordsError } from './shared'

// 处理后台生成记录管理请求。
export const handleAdminGenerationRecordsRequest = async (req: any, res: any) => {
  try {
    if (!isPrismaConfigured()) {
      sendAdminGenerationRecordsError(res, 500, '缺少 DATABASE_URL，暂时无法使用后台生成记录管理。')
      return
    }

    const currentUser = await requireAdminSessionUser(req, res)
    if (!currentUser) {
      return
    }

    // 归属隔离：超管看全部，普通管理员仅能访问自己名下用户的生成记录。
    const viewer = { id: currentUser.id, role: currentUser.role }

    const requestPath = String(req.url || '').split('?')[0]

    if (req.method === 'GET' && requestPath === ADMIN_GENERATION_RECORDS_BASE_PATH) {
      const query = readAdminGenerationRecordsQuery(String(req.url || ''))
      const data = await listAdminGenerationRecords(query, viewer)
      sendJson(res, 200, { data })
      return
    }

    sendAdminGenerationRecordsError(res, 405, 'Method Not Allowed')
  } catch (error: any) {
    sendAdminGenerationRecordsError(res, 500, error?.message || '处理后台生成记录管理请求失败')
  }
}
