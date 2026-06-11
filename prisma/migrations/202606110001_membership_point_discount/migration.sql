-- 会员等级新增「积分消耗减免百分比」字段，用于会员折扣计费。
ALTER TABLE `membership_levels`
  ADD COLUMN `point_discount_percent` DOUBLE NOT NULL DEFAULT 0 COMMENT '会员积分消耗减免百分比(0-100, 例如20表示按8折扣费)';
