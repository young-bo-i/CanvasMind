-- 积分支持小数:模型可按小数计价(对话/图片/视频),扣费与余额因此可能为小数。
-- 将余额列与账本金额列从 INT 改为 DECIMAL(12,2)。
-- 这是"加宽"型无损迁移:既有整数值原样保留为 x.00,不丢数据。
-- 权威加减仍在 DB 侧(points_balance = points_balance + ?)进行,JS 仅四舍五入到 2 位后传参,规避浮点误差。
ALTER TABLE `app_users`
  MODIFY COLUMN `points_balance` DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE `point_account_logs`
  MODIFY COLUMN `change_amount` DECIMAL(12,2) NOT NULL,
  MODIFY COLUMN `balance_after` DECIMAL(12,2) NOT NULL,
  MODIFY COLUMN `available_amount` DECIMAL(12,2) NOT NULL DEFAULT 0;
