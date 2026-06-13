import type { AuthStrategy } from '../types'
import { grantLoginReward } from '../../marketing-center/service'
import { attachVerificationCodeUser, consumeVerificationCodeRecord, createUserSession, createVerificationCodeRecord, getAuthMethodConfig, isValidEmail, resolveUserByIdentifier, toAuthUserProfile } from '../service'

// 邮箱验证码登录策略。
export const emailCodeStrategy: AuthStrategy = {
  methodType: 'EMAIL_CODE',
  category: 'CODE',
  canSendCode: true,
  canLoginWithCode: true,
  async sendCode(context) {
    const email = context.target.trim().toLowerCase()
    if (!isValidEmail(email)) {
      throw new Error('请输入正确的邮箱地址')
    }

    const record = await createVerificationCodeRecord({
      methodType: 'EMAIL_CODE',
      channel: 'EMAIL',
      target: email,
      requesterIp: context.requesterIp,
      userAgent: context.userAgent,
    })


    return {
      id: record.id,
      target: email,
      channel: 'EMAIL',
      expiresAt: record.expiresAt,
      // 安全：仅非生产环境且后台显式开启自动填充时才回传验证码。
      // 生产环境绝不下发明文验证码，避免"任何人读 sendCode 响应即可登录"的越权。
      debugCode: context.methodConfig.allowAutoFill && process.env.NODE_ENV !== 'production'
        ? record.code
        : undefined,
    }
  },
  async login(context) {
    const email = String(context.target || '').trim().toLowerCase()
    const code = String(context.code || '').trim()

    if (!isValidEmail(email)) {
      throw new Error('请输入正确的邮箱地址')
    }

    if (!/^\d{6}$/.test(code)) {
      throw new Error('请输入 6 位验证码')
    }

    const verificationRecord = await consumeVerificationCodeRecord({
      methodType: 'EMAIL_CODE',
      target: email,
      code,
    })

    const currentMethodConfig = await getAuthMethodConfig('EMAIL_CODE')
    const resolvedUser = await resolveUserByIdentifier({
      methodType: 'EMAIL_CODE',
      identifier: email,
      allowSignUp: currentMethodConfig.allowSignUp,
    })

    const user = resolvedUser.user

    await attachVerificationCodeUser(verificationRecord.id, user.id)

    const session = await createUserSession({
      userId: user.id,
      methodType: 'EMAIL_CODE',
      identifierSnapshot: email,
      requesterIp: context.requesterIp,
      userAgent: context.userAgent,
    })

    await grantLoginReward(user.id)

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: toAuthUserProfile(user, 'EMAIL_CODE'),
    }
  },
}
