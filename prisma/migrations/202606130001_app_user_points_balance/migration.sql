-- AppUser 增加"权威积分余额"列：去规范化镜像账本余额。
-- 解决：此前余额靠每次扫描 point_account_logs 取最新 balance_after 计算，既有 O(n) 读，
-- 又因"读-改-写"在并发(消费 vs 入账)下丢更新。改为在该列上做原子 UPDATE(行锁自串行化)。
--
-- 本迁移为"加列 + 回填"的无损迁移：
--   1) 新增列默认 0；
--   2) 用每个用户"最新一条账本流水"的 balance_after 回填当前余额。
ALTER TABLE `app_users` ADD COLUMN `points_balance` INT NOT NULL DEFAULT 0;

-- 无损回填：相关子查询取每个用户按 (created_at DESC, id DESC) 的最新流水余额，
-- 与应用层 readCurrentPointBalance 的排序口径完全一致；无流水的用户保持 0。
UPDATE `app_users` u
SET u.`points_balance` = COALESCE((
  SELECT pal.`balance_after`
  FROM `point_account_logs` pal
  WHERE pal.`user_id` = u.`id`
  ORDER BY pal.`created_at` DESC, pal.`id` DESC
  LIMIT 1
), 0);
