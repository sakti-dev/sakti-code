CREATE TABLE `events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`properties` text NOT NULL,
	`directory` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_session_sequence` ON `events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_session_created` ON `events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`resource_id` text,
	`role` text NOT NULL,
	`raw_content` text NOT NULL,
	`search_text` text NOT NULL,
	`injection_text` text NOT NULL,
	`task_id` text,
	`summary` text,
	`compaction_level` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`message_index` integer NOT NULL,
	`token_count` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `observational_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text,
	`resource_id` text,
	`scope` text DEFAULT 'thread' NOT NULL,
	`lookup_key` text NOT NULL,
	`active_observations` text,
	`buffered_observation_chunks` text,
	`is_observing` integer DEFAULT 0,
	`is_reflecting` integer DEFAULT 0,
	`is_buffering_observation` integer DEFAULT 0,
	`is_buffering_reflection` integer DEFAULT 0,
	`last_buffered_at_tokens` integer,
	`last_buffered_at_time` integer,
	`observed_message_ids` text,
	`lock_owner_id` text,
	`lock_expires_at` integer,
	`lock_operation_id` text,
	`last_heartbeat_at` integer,
	`config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_observed_at` integer,
	`generation_count` integer DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observational_memory_lookup_key_unique` ON `observational_memory` (`lookup_key`);--> statement-breakpoint
CREATE TABLE `reflections` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text,
	`thread_id` text,
	`content` text NOT NULL,
	`merged_from` text,
	`origin_type` text DEFAULT 'reflection',
	`generation_count` integer NOT NULL,
	`token_count` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repo_cache` (
	`resource_key` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`ref` text NOT NULL,
	`search_path` text NOT NULL,
	`local_path` text NOT NULL,
	`commit_hash` text,
	`cloned_at` integer NOT NULL,
	`last_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`parent_id` text,
	`title` text,
	`summary` text,
	`share_url` text,
	`created_at` integer NOT NULL,
	`last_accessed` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	`type` text DEFAULT 'blocks' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_id`, `type`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_messages` (
	`task_id` text NOT NULL,
	`message_id` text NOT NULL,
	`relation_type` text DEFAULT 'output',
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `message_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`type` text DEFAULT 'task' NOT NULL,
	`assignee` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer,
	`close_reason` text,
	`summary` text,
	`compaction_level` integer DEFAULT 0,
	`compacted_at` integer,
	`original_content` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`title` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_sessions` (
	`tool_session_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_key` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	`last_accessed` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_sessions_session_tool_key` ON `tool_sessions` (`session_id`,`tool_name`,`tool_key`);