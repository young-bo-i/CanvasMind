import { sendJson } from '../ai-gateway/shared'
import { readPaginationQuery } from '../shared/pagination'

export interface ListAdminAuditLogsOptions {
  action?: string
  targetType?: string
  targetId?: string
  operatorKeyword?: string
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
  // 归属隔离：普通管理员仅见自己的操作日志；超管全量。
  viewerId?: string
  viewerRole?: string
}

const readStringQuery = (searchParams: URLSearchParams, key: string) => String(searchParams.get(key) || '').trim()

export const readAdminAuditLogsQuery = (rawUrl: string): ListAdminAuditLogsOptions => {
  const requestUrl = new URL(rawUrl || '/', 'http://localhost')
  const pagination = readPaginationQuery(requestUrl.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  })

  return {
    action: readStringQuery(requestUrl.searchParams, 'action'),
    targetType: readStringQuery(requestUrl.searchParams, 'targetType'),
    targetId: readStringQuery(requestUrl.searchParams, 'targetId'),
    operatorKeyword: readStringQuery(requestUrl.searchParams, 'operatorKeyword'),
    createdFrom: readStringQuery(requestUrl.searchParams, 'createdFrom'),
    createdTo: readStringQuery(requestUrl.searchParams, 'createdTo'),
    page: pagination.page,
    pageSize: pagination.pageSize,
  }
}

export const sendAdminAuditLogsError = (res: any, statusCode: number, message: string) => {
  sendJson(res, statusCode, {
    message,
    error: {
      type: 'admin_audit_logs_error',
      message,
    },
  })
}
