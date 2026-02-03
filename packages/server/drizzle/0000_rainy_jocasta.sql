CREATE TABLE IF NOT EXISTS `repo_cache` (
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
CREATE TABLE IF NOT EXISTS `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_accessed` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_sessions` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `tool_sessions_session_tool_key` ON `tool_sessions` (`session_id`,`tool_name`,`tool_key`);