-- 为 point_account_logs.association_no 补索引。
-- 任务创建绑定(attachGenerationPointRecordId)、续询补扣、后台补偿三条高频路径都按 association_no 过滤，
-- 此前无索引 → 全表扫；随流水表增长会越来越慢。
CREATE INDEX IF NOT EXISTS `idx_point_account_logs_association_no` ON `point_account_logs`(`association_no`);
