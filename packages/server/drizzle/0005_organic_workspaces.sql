CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`base_branch` text,
	`repo_path` text,
	`is_merged` integer DEFAULT 0,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`last_opened_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_path_unique` ON `workspaces` (`path`);--> statement-breakpoint
CREATE INDEX `workspaces_status_idx` ON `workspaces` (`status`);--> statement-breakpoint
CREATE INDEX `workspaces_last_opened_idx` ON `workspaces` (`last_opened_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `sessions_workspace_id_idx` ON `sessions` (`workspace_id`);
