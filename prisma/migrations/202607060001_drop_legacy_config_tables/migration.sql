-- Phase D/E：删除已废弃的「厂商 / 模型 / 技能 / 工作流」配置表 + generation_records 的死列 provider_config_id。
-- 背景：厂商与模型清单已内置(server/vendor/builtin-catalog.ts)，密钥/定价改存 vendor_settings；
--       这些表运行时不再被任何代码引用(已全仓核实)。
-- 安全：只删配置/技能/工作流表；账号/积分/会员/卡密/生成记录/输出/资产/AgentRun 等生产数据表完全不动。
--       generation_records.provider_config_id 是无代码读写的死列(先删 FK 再删列)。

SET FOREIGN_KEY_CHECKS = 0;

-- 1) generation_records 上指向 ai_provider_configs 的死外键 + 索引 + 列。
ALTER TABLE `generation_records` DROP FOREIGN KEY IF EXISTS `fk_generation_records_provider_config_id`;
ALTER TABLE `generation_records` DROP INDEX IF EXISTS `idx_generation_records_provider_created_at`;
ALTER TABLE `generation_records` DROP COLUMN IF EXISTS `provider_config_id`;

-- 2) 技能子表 → 技能主表 → 模型 → 厂商 → 旧用户级配置 → 工作流（FK 检查已关，顺序不敏感，仍按依赖排列）。
DROP TABLE IF EXISTS `ai_skill_dependencies`;
DROP TABLE IF EXISTS `ai_skill_prompt_templates`;
DROP TABLE IF EXISTS `ai_skill_workflow_templates`;
DROP TABLE IF EXISTS `ai_skill_plan_templates`;
DROP TABLE IF EXISTS `ai_skill_stage_templates`;
DROP TABLE IF EXISTS `ai_skills`;
DROP TABLE IF EXISTS `ai_models`;
DROP TABLE IF EXISTS `ai_providers`;
DROP TABLE IF EXISTS `ai_provider_custom_models`;
DROP TABLE IF EXISTS `ai_provider_configs`;
DROP TABLE IF EXISTS `workflow_definition_versions`;
DROP TABLE IF EXISTS `workflow_definitions`;

SET FOREIGN_KEY_CHECKS = 1;
