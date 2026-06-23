ALTER TABLE `projects` ADD `profile_id` text;--> statement-breakpoint
DROP INDEX IF EXISTS `model_configs_project_id_idx`;--> statement-breakpoint
DROP TABLE `model_configs`;