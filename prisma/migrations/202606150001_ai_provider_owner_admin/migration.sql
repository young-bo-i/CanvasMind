-- 厂商按管理员归属隔离：每个普通管理员配置自己的 AI 厂商，其本人及名下用户的生成请求
-- 只走该管理员的厂商（租户级隔离）。
-- 新增 owner_admin_id：
--   NULL = 超管/平台全局（自助注册/历史数据与超管的用户共用；既有厂商默认归此，保持现状无损）；
--   非空 = 该普通管理员私有。
-- 删除管理员时级联删除其厂商（连同加密密钥），避免残留为全局导致密钥泄漏。
ALTER TABLE `ai_providers`
  ADD COLUMN `owner_admin_id` VARCHAR(36) NULL AFTER `extra_json`;

CREATE INDEX `idx_ai_providers_owner_admin_id` ON `ai_providers` (`owner_admin_id`);

ALTER TABLE `ai_providers`
  ADD CONSTRAINT `ai_providers_owner_admin_id_fkey`
  FOREIGN KEY (`owner_admin_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 厂商标识唯一性从「全局唯一」改为「按归属唯一」：同一管理员(或 NULL 全局桶)内 code 唯一，
-- 不同管理员可复用相同 code（多租户必需）。MySQL 复合唯一里 NULL 互不相等，全局桶 code 唯一性由应用层 + 受控 seed 保证。
DROP INDEX `uk_ai_providers_code` ON `ai_providers`;
CREATE UNIQUE INDEX `uk_ai_providers_owner_code` ON `ai_providers` (`owner_admin_id`, `code`);
