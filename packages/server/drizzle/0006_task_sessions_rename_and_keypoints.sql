-- Rename sessions table to task_sessions
ALTER TABLE `sessions` RENAME TO `task_sessions`;
--> statement-breakpoint
-- Add new columns to task_sessions table
ALTER TABLE `task_sessions` ADD `status` text DEFAULT 'researching' NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_sessions` ADD `spec_type` text;
--> statement-breakpoint
ALTER TABLE `task_sessions` ADD `session_kind` text DEFAULT 'task' NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_sessions` ADD `last_activity_at` integer NOT NULL DEFAULT (unixepoch() * 1000);
--> statement-breakpoint
-- Create indexes for task_sessions
CREATE INDEX `task_sessions_status_idx` ON `task_sessions` (`status`);
--> statement-breakpoint
CREATE INDEX `task_sessions_kind_idx` ON `task_sessions` (`session_kind`);
--> statement-breakpoint
CREATE INDEX `task_sessions_workspace_activity_idx` ON `task_sessions` (`workspace_id`,`last_activity_at`);
--> statement-breakpoint
CREATE INDEX `task_sessions_workspace_kind_activity_idx` ON `task_sessions` (`workspace_id`,`session_kind`,`last_activity_at`);
--> statement-breakpoint
-- Create project_keypoints table
CREATE TABLE `project_keypoints` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_session_id` text NOT NULL,
	`task_title` text NOT NULL,
	`milestone` text NOT NULL,
	`completed_at` integer NOT NULL,
	`summary` text NOT NULL,
	`artifacts` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_session_id`) REFERENCES `task_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Create indexes for project_keypoints
CREATE INDEX `project_keypoints_workspace_completed_idx` ON `project_keypoints` (`workspace_id`,`completed_at`);
--> statement-breakpoint
CREATE INDEX `project_keypoints_task_milestone_idx` ON `project_keypoints` (`task_session_id`,`milestone`);
