import { AUTH_SESSION_COOKIE_NAME } from './service'
import { getUserBySessionToken } from './service'

const parseCookieMap = (cookieHeader: string) => {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, item) => {
      const separatorIndex = item.indexOf('=')
      if (separatorIndex <= 0) {
        return result
      }

      const key = item.slice(0, separatorIndex).trim()
      const value = item.slice(separatorIndex + 1).trim()
      result[key] = decodeURIComponent(value)
      return result
    }, {})
}

const sendUnauthorizedError = (res: any) => {
  res.statusCode = 401
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({
    message: '当前未登录或登录已失效',
    error: {
      type: 'unauthorized',
      message: '当前未登录或登录已失效',
    },
  }))
}

const sendForbiddenError = (res: any) => {
  res.statusCode = 403
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({
    message: '当前账号没有后台管理权限',
    error: {
      type: 'forbidden',
      message: '当前账号没有后台管理权限',
    },
  }))
}

export const readSessionTokenFromRequest = (req: any) => {
  const cookieHeader = String(req.headers?.cookie || '').trim()
  if (!cookieHeader) {
    return ''
  }

  return parseCookieMap(cookieHeader)[AUTH_SESSION_COOKIE_NAME] || ''
}

export const readCurrentSessionUser = async (req: any) => {
  const sessionToken = readSessionTokenFromRequest(req)
  if (!sessionToken) {
    return null
  }

  return getUserBySessionToken(sessionToken)
}

export const requireCurrentSessionUser = async (req: any, res: any) => {
  const currentUser = await readCurrentSessionUser(req)
  if (!currentUser?.id) {
    sendUnauthorizedError(res)
    return null
  }

  return currentUser
}

// 要求当前会话用户具备后台权限（管理员或超级管理员）。
export const requireAdminSessionUser = async (req: any, res: any) => {
  const currentUser = await requireCurrentSessionUser(req, res)
  if (!currentUser) {
    return null
  }

  if (currentUser.role !== 'ADMIN' && currentUser.role !== 'SUPER_ADMIN') {
    sendForbiddenError(res)
    return null
  }

  return currentUser
}

// 要求当前会话用户必须是超级管理员（新增管理员 / 改角色 / 删管理员等敏感操作）。
export const requireSuperAdminSessionUser = async (req: any, res: any) => {
  const currentUser = await requireCurrentSessionUser(req, res)
  if (!currentUser) {
    return null
  }

  if (currentUser.role !== 'SUPER_ADMIN') {
    sendForbiddenError(res)
    return null
  }

  return currentUser
}
