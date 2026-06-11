-- 积分流水退款幂等：新增可空去重键 + 唯一索引（NULL 多值合法，既有数据不受影响）。
ALTER TABLE `point_account_logs`
  ADD COLUMN `dedupe_key` VARCHAR(120) NULL COMMENT '幂等去重键：同一逻辑动作(如某次生成退款)只能写一次';

CREATE UNIQUE INDEX `uk_point_account_logs_dedupe_key` ON `point_account_logs`(`dedupe_key`);
