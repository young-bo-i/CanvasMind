import type { AuthStrategy } from '../types'
import { createUserSession, getUserByUsername, isValidAdminPassword, isValidAdminUsername, toAuthUserProfile, verifyUserPassword } from '../service'

// 管理员账号密码登录策略。
export const adminPasswordStrategy: AuthStrategy = {
  methodType: 'ADMIN_PASSWORD',
  category: 'PASSWORD',
  canLoginWithCode: true,
  async login(context) {
    const username = String(context.target || '').trim()
    const password = String(context.password || '')

    if (!isValidAdminUsername(username)) {
      throw new Error('请输入 4-32 位账号，只能包含字母、数字、下划线或中划线')
    }

    if (!isValidAdminPassword(password)) {
      throw new Error('请输入 8-64 位登录密码')
    }

    // 账号密码登录对所有角色开放：任何有 username + passwordHash 的用户都能登录，
    // 登录后的权限仍由各自 role 决定（USER 登录后进不了后台）。验证码用户无 username/passwordHash，不受影响。
    const user = await getUserByUsername(username)
    if (!user) {
      throw new Error('账号或密码错误')
    }
    if (user.status === 'DISABLED') {
      throw new Error('该账号已被禁用')
    }

    const passwordMatched = await verifyUserPassword(password, user.passwordHash)
    if (!passwordMatched) {
      throw new Error('账号或密码错误')
    }

    const session = await createUserSession({
      userId: user.id,
      methodType: 'ADMIN_PASSWORD',
      identifierSnapshot: username,
      requesterIp: context.requesterIp,
      userAgent: context.userAgent,
    })

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: toAuthUserProfile(user, 'ADMIN_PASSWORD'),
    }
  },
}
