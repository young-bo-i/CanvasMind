-- 按生成记录反查预扣流水改用独立列 + 索引，替代 metaJson JSON 路径全表扫描(O(n))。
ALTER TABLE `point_account_logs`
  ADD COLUMN `generation_record_id` VARCHAR(36) NULL COMMENT '关联的生成记录ID(从 metaJson 抽出，便于按记录反查退款)';

-- 既有数据回填：从 metaJson.$.generationRecordId 抽出。
UPDATE `point_account_logs`
  SET `generation_record_id` = JSON_UNQUOTE(JSON_EXTRACT(`meta_json`, '$.generationRecordId'))
  WHERE `meta_json` IS NOT NULL
    AND JSON_EXTRACT(`meta_json`, '$.generationRecordId') IS NOT NULL;

CREATE INDEX `idx_point_account_logs_generation_record_id` ON `point_account_logs`(`generation_record_id`, `created_at`);
