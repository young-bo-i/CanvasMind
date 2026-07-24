import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAccountLoginPasswordValidationMessage,
  getAccountUsernameValidationMessage,
  getNewAccountPasswordValidationMessage,
  isValidAccountLoginPassword,
  isValidAccountUsername,
  isValidNewAccountPassword,
} from '../src/shared/account-credentials'

test('新账号仍要求 8-64 位密码', () => {
  assert.equal(isValidNewAccountPassword('1234567'), false)
  assert.equal(isValidNewAccountPassword('12345678'), true)
  assert.equal(isValidNewAccountPassword('x'.repeat(64)), true)
  assert.equal(isValidNewAccountPassword('x'.repeat(65)), false)
  assert.equal(getNewAccountPasswordValidationMessage('1234567'), '请输入 8-64 位登录密码')
})

test('登录允许历史短密码参与哈希校验', () => {
  assert.equal(isValidAccountLoginPassword('1'), true)
  assert.equal(isValidAccountLoginPassword('1234567'), true)
  assert.equal(isValidAccountLoginPassword('12345678'), true)
  assert.equal(isValidAccountLoginPassword(''), false)
  assert.equal(isValidAccountLoginPassword('x'.repeat(65)), false)
})

test('登录密码边界提示明确', () => {
  assert.equal(getAccountLoginPasswordValidationMessage(''), '请输入登录密码')
  assert.equal(
    getAccountLoginPasswordValidationMessage('x'.repeat(65)),
    '登录密码不能超过 64 位',
  )
  assert.equal(getAccountLoginPasswordValidationMessage('123456'), '')
})

test('账号规则在创建和登录间保持一致', () => {
  assert.equal(isValidAccountUsername('user_01'), true)
  assert.equal(isValidAccountUsername('1user'), false)
  assert.equal(isValidAccountUsername('abc'), false)
  assert.equal(
    getAccountUsernameValidationMessage('abc'),
    '请输入 4-32 位登录账号，字母开头，只能包含字母、数字、下划线或中划线',
  )
})
