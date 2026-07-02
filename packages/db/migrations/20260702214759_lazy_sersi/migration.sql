CREATE TABLE `observational_memory` (
	`id` text PRIMARY KEY,
	`lookup_key` text NOT NULL,
	`scope` text NOT NULL,
	`resource_id` text,
	`thread_id` text,
	`active_observations` text NOT NULL,
	`active_observations_pending_update` text,
	`buffered_observation_chunks` text,
	`buffered_reflection` text,
	`buffered_reflection_tokens` integer,
	`buffered_reflection_input_tokens` integer,
	`reflected_observation_line_count` integer,
	`observed_message_ids` text,
	`observed_timezone` text,
	`origin_type` text NOT NULL,
	`generation_count` integer NOT NULL,
	`config` text NOT NULL,
	`pending_message_tokens` integer NOT NULL,
	`total_tokens_observed` integer NOT NULL,
	`observation_token_count` integer NOT NULL,
	`is_observing` integer DEFAULT false NOT NULL,
	`is_reflecting` integer DEFAULT false NOT NULL,
	`is_buffering_observation` integer DEFAULT false NOT NULL,
	`is_buffering_reflection` integer DEFAULT false NOT NULL,
	`last_buffered_at_tokens` integer DEFAULT 0 NOT NULL,
	`last_observed_at` integer,
	`last_reflection_at` integer,
	`last_buffered_at_time` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_observational_memory_resource_id_projects_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_observational_memory_thread_id_sessions_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
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
	`turn_id` text,
	`is_turn_summary` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_session_entries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_entries_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`parent_session_id` text,
	`title` text,
	`model_id` text,
	`profile_id` text,
	`kind` text DEFAULT 'task' NOT NULL,
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
CREATE TABLE `turns` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_turns_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `observational_memory_lookup_key_idx` ON `observational_memory` (`lookup_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_entries_session_id_sequence_idx` ON `session_entries` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `session_entries_session_id_kind_idx` ON `session_entries` (`session_id`,`kind`);--> statement-breakpoint
CREATE INDEX `session_entries_turn_id_idx` ON `session_entries` (`turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_entries_turn_id_summary_idx` ON `session_entries` (`turn_id`) WHERE is_turn_summary = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `turns_session_id_sequence_idx` ON `turns` (`session_id`,`sequence`);