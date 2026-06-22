CREATE TABLE `model_configs` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`thinking_level` text DEFAULT 'off' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_model_configs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`cwd` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_entries` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`parent_id` text,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_session_entries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`parent_session_id` text,
	`title` text,
	`model_id` text NOT NULL,
	`thinking_level` text DEFAULT 'off' NOT NULL,
	`leaf_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_sessions_parent_session_id_sessions_id_fk` FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_configs_project_id_idx` ON `model_configs` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_entries_session_id_sequence_idx` ON `session_entries` (`session_id`,`sequence`);