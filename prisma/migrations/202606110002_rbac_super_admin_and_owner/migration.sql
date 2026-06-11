-- 三层角色 + 用户归属隔离。

-- 1) role 枚举增加 SUPER_ADMIN。
ALTER TABLE `app_users`
  MODIFY COLUMN `role` ENUM('USER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER' COMMENT '用户角色：普通用户、管理员、超级管理员';

-- 2) 新增归属管理员字段（NULL = 平台直属，仅超管可见）+ 自关联外键 + 索引。
ALTER TABLE `app_users`
  ADD COLUMN `owner_admin_id` VARCHAR(36) NULL COMMENT '归属管理员：该用户由哪个管理员创建';

CREATE INDEX `idx_app_users_owner_admin_id` ON `app_users`(`owner_admin_id`);

ALTER TABLE `app_users`
  ADD CONSTRAINT `fk_app_users_owner_admin_id` FOREIGN KEY (`owner_admin_id`) REFERENCES `app_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) 回填 bootstrap 超管：用系统初始化记录的 adminUserId 升为超级管理员。
--    （全新安装时此表尚无用户、no-op；首个超管由 system-init 直接以 SUPER_ADMIN 创建。）
UPDATE `app_users` u
JOIN `system_settings` s ON s.`code` = 'SYSTEM_INIT_STATUS'
SET u.`role` = 'SUPER_ADMIN'
WHERE u.`id` = JSON_UNQUOTE(JSON_EXTRACT(s.`config_json`, '$.adminUserId'));
