-- 内置厂商的「按管理员」配置表：取代原 ai_providers / ai_models 的密钥与定价承载。
-- 厂商与模型清单写死在 server/vendor/builtin-catalog.ts；此表只存每个管理员作用域各自的
-- API 密钥与每模型定价/启停覆盖。owner_admin_id NULL = 超管/平台直属全局桶。
-- 本次仅「新增」表（Phase A，非破坏）；老的 ai_providers/ai_models 数据迁移与删表在后续迁移里做。
CREATE TABLE `vendor_settings` (
  `id` VARCHAR(36) NOT NULL COMMENT '主键 ID',
  `owner_admin_id` VARCHAR(36) NULL COMMENT '归属管理员 ID；NULL = 超管/平台直属全局桶',
  `vendor_code` VARCHAR(50) NOT NULL COMMENT '内置厂商 code（cometapi / chengmeng）',
  `api_key_encrypted` LONGTEXT NULL COMMENT '加密后的 API Key（AES-256-GCM，复用 PROVIDER_CONFIG_SECRET）',
  `api_key_hint` VARCHAR(64) NULL COMMENT 'API Key 掩码（前 4 后 4）',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '该厂商在此作用域是否启用',
  `pricing_json` JSON NULL COMMENT '每模型定价/启停/会员门槛覆盖：{ [modelKey]: { enabled?, billingRule?, membershipLevels? } }',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vendor_settings_owner_vendor` (`owner_admin_id`, `vendor_code`),
  KEY `idx_vendor_settings_owner_admin_id` (`owner_admin_id`),
  CONSTRAINT `fk_vendor_settings_owner_admin_id` FOREIGN KEY (`owner_admin_id`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内置厂商按管理员配置（密钥+定价）';
