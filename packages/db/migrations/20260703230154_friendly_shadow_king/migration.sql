PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`parent_session_id` text,
	`title` text,
	`model_id` text,
	`profile_id` text,
	`kind` text DEFAULT 'mission' NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`thinking_level` text DEFAULT 'off' NOT NULL,
	`leaf_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_sessions_parent_session_id_sessions_id_fk` FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_sessions`(`id`, `project_id`, `parent_session_id`, `title`, `model_id`, `profile_id`, `kind`, `status`, `thinking_level`, `leaf_id`, `created_at`, `updated_at`) SELECT `id`, `project_id`, `parent_session_id`, `title`, `model_id`, `profile_id`, `kind`, `status`, `thinking_level`, `leaf_id`, `created_at`, `updated_at` FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `sessions` SET `kind` = 'mission' WHERE `kind` = 'task';