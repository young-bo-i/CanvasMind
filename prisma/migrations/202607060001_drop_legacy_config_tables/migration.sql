-- Phase D/E：删除已废弃的「厂商 / 模型 / 技能 / 工作流」配置表 + generation_records 的死列 provider_config_id。
-- 背景：厂商与模型清单已内置(server/vendor/builtin-catalog.ts)，密钥/定价改存 vendor_settings；这些表运行时不再被任何代码引用(已全仓核实)。
-- 安全：只删配置/技能/工作流表；账号/积分/会员/卡密/生成记录/输出/资产/AgentRun 等生产数据表完全不动。
--
-- 健壮性：先按「确切约束名」逐个 DROP 外键(IF EXISTS)，再 DROP 表 —— 不依赖 FOREIGN_KEY_CHECKS 在
-- prisma migrate 多语句执行中的持久化，也天然解开 workflow_definitions ↔ versions 的循环外键。
-- 约束名均已对生产库 information_schema 核实。

SET FOREIGN_KEY_CHECKS = 0;

-- 1) generation_records 上指向 ai_provider_configs 的死外键 + 索引 + 列（该列无代码读写）。
ALTER TABLE `generation_records` DROP FOREIGN KEY IF EXISTS `fk_generation_records_provider_config_id`;
ALTER TABLE `generation_records` DROP INDEX IF EXISTS `idx_generation_records_provider_created_at`;
ALTER TABLE `generation_records` DROP COLUMN IF EXISTS `provider_config_id`;

-- 2) 逐个删除配置表之间(及指向 app_users)的外键，解开所有依赖与循环。
ALTER TABLE `ai_models` DROP FOREIGN KEY IF EXISTS `fk_ai_models_provider_id`;
ALTER TABLE `ai_providers` DROP FOREIGN KEY IF EXISTS `ai_providers_owner_admin_id_fkey`;
ALTER TABLE `ai_provider_configs` DROP FOREIGN KEY IF EXISTS `fk_ai_provider_configs_user_id`;
ALTER TABLE `ai_provider_custom_models` DROP FOREIGN KEY IF EXISTS `fk_ai_provider_custom_models_config_id`;
ALTER TABLE `ai_skills` DROP FOREIGN KEY IF EXISTS `fk_ai_skills_provider_id`;
ALTER TABLE `ai_skill_dependencies` DROP FOREIGN KEY IF EXISTS `fk_ai_skill_dependencies_dependency_skill_id`;
ALTER TABLE `ai_skill_dependencies` DROP FOREIGN KEY IF EXISTS `fk_ai_skill_dependencies_skill_id`;
ALTER TABLE `ai_skill_plan_templates` DROP FOREIGN KEY IF EXISTS `fk_ai_skill_plan_templates_skill_id`;
ALTER TABLE `ai_skill_prompt_templates` DROP FOREIGN KEY IF EXISTS `fk_ai_skill_prompt_templates_skill_id`;
ALTER TABLE `ai_skill_stage_templates` DROP FOREIGN KEY IF EXISTS `fk_ai_skill_stage_templates_skill_id`;
ALTER TABLE `ai_skill_workflow_templates` DROP FOREIGN KEY IF EXISTS `fk_ai_skill_workflow_templates_skill_id`;
ALTER TABLE `workflow_definitions` DROP FOREIGN KEY IF EXISTS `fk_workflow_definitions_current_version_id`;
ALTER TABLE `workflow_definitions` DROP FOREIGN KEY IF EXISTS `fk_workflow_definitions_user_id`;
ALTER TABLE `workflow_definition_versions` DROP FOREIGN KEY IF EXISTS `fk_workflow_definition_versions_created_by`;
ALTER TABLE `workflow_definition_versions` DROP FOREIGN KEY IF EXISTS `fk_workflow_definition_versions_workflow_id`;

-- 3) 删表（外键已全部解除，顺序不再敏感）。
DROP TABLE IF EXISTS `ai_skill_dependencies`;
DROP TABLE IF EXISTS `ai_skill_prompt_templates`;
DROP TABLE IF EXISTS `ai_skill_workflow_templates`;
DROP TABLE IF EXISTS `ai_skill_plan_templates`;
DROP TABLE IF EXISTS `ai_skill_stage_templates`;
DROP TABLE IF EXISTS `ai_skills`;
DROP TABLE IF EXISTS `ai_models`;
DROP TABLE IF EXISTS `ai_provider_custom_models`;
DROP TABLE IF EXISTS `ai_providers`;
DROP TABLE IF EXISTS `ai_provider_configs`;
DROP TABLE IF EXISTS `workflow_definition_versions`;
DROP TABLE IF EXISTS `workflow_definitions`;

SET FOREIGN_KEY_CHECKS = 1;
