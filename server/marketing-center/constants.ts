// 用户侧营销中心接口根路径。
export const MARKETING_CENTER_BASE_PATH = '/api/marketing'

// 营销中心总览接口。
export const MARKETING_CENTER_OVERVIEW_PATH = MARKETING_CENTER_BASE_PATH + '/overview'

// 卡密兑换接口。
export const MARKETING_CENTER_CARD_REDEEM_PATH = MARKETING_CENTER_BASE_PATH + '/card-redeem'

// 判断是否命中用户侧营销接口。
export const isMarketingCenterPath = (requestPath: string) => {
  return requestPath === MARKETING_CENTER_OVERVIEW_PATH
    || requestPath === MARKETING_CENTER_CARD_REDEEM_PATH
}
