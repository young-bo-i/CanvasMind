export const ACCOUNT_USERNAME_MIN_LENGTH = 4
export const ACCOUNT_USERNAME_MAX_LENGTH = 32
export const NEW_ACCOUNT_PASSWORD_MIN_LENGTH = 8
export const ACCOUNT_PASSWORD_MAX_LENGTH = 64

const ACCOUNT_USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{3,31}$/

// 登录账号规则在创建账号和登录时保持一致。
export const isValidAccountUsername = (username: string) => {
  return ACCOUNT_USERNAME_PATTERN.test(String(username || '').trim())
}

// 新建或重置密码时执行强度限制。
export const isValidNewAccountPassword = (password: string) => {
  const length = String(password || '').length
  return length >= NEW_ACCOUNT_PASSWORD_MIN_LENGTH && length <= ACCOUNT_PASSWORD_MAX_LENGTH
}

// 登录只校验输入边界，不再套用新密码强度规则，兼容历史短密码。
export const isValidAccountLoginPassword = (password: string) => {
  const length = String(password || '').length
  return length > 0 && length <= ACCOUNT_PASSWORD_MAX_LENGTH
}

export const getAccountUsernameValidationMessage = (username: string) => {
  return isValidAccountUsername(username)
    ? ''
    : '请输入 4-32 位登录账号，字母开头，只能包含字母、数字、下划线或中划线'
}

export const getNewAccountPasswordValidationMessage = (password: string) => {
  return isValidNewAccountPassword(password)
    ? ''
    : '请输入 8-64 位登录密码'
}

export const getAccountLoginPasswordValidationMessage = (password: string) => {
  if (!String(password || '').length) {
    return '请输入登录密码'
  }
  if (String(password || '').length > ACCOUNT_PASSWORD_MAX_LENGTH) {
    return `登录密码不能超过 ${ACCOUNT_PASSWORD_MAX_LENGTH} 位`
  }
  return ''
}
