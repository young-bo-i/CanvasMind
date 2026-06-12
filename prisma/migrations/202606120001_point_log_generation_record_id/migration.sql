-- 按生成记录反查预扣流水改用独立列 + 索引，替代 metaJson JSON 路径全表扫描(O(n))。
--
-- 仅做 ADD COLUMN + CREATE INDEX（可空列 + 全 NULL 新列建索引，均为快速操作，
-- 不阻塞 migrate deploy / 容器就绪）。刻意不在迁移内做全表回填 UPDATE：
--   * 该 UPDATE 用 JSON_EXTRACT(meta_json) 必然全表扫描，随表增长会拖长部署期
--     migrate deploy(位于 app 容器启动关键路径 start-production.mjs)，使 healthcheck 失败。
--   * 历史/部署过渡期的旧行(列为 NULL)由应用侧反查 findConsumeByRecordId 的
--     metaJson 兜底分支覆盖；新写入由 attachGenerationPointRecordId 双写列保证命中索引。
ALTER TABLE `point_account_logs`
  ADD COLUMN `generation_record_id` VARCHAR(36) NULL COMMENT '关联的生成记录ID(便于按记录反查退款/补扣)';

CREATE INDEX `idx_point_account_logs_generation_record_id` ON `point_account_logs`(`generation_record_id`, `created_at`);
