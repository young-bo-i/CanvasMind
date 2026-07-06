export const VENDOR_CATALOG_PATH = '/api/vendor/catalog'
export const VENDOR_SETTINGS_PATH = '/api/vendor/settings'

// 前缀匹配：catalog（公开目录）+ settings（后台填 key/调价，含 /settings/:vendorCode）。
export const VENDOR_MATCH_PATHS = [VENDOR_CATALOG_PATH, VENDOR_SETTINGS_PATH]
