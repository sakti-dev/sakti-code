CREATE TABLE `task_session_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`task_session_id` text NOT NULL,
	`runtime_mode` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`client_request_key` text,
	`input` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_heartbeat_at` integer,
	`cancel_requested_at` integer,
	`canceled_at` integer,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`task_session_id`) REFERENCES `task_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_session_runs_session_created_idx` ON `task_session_runs` (`task_session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `task_session_runs_session_state_idx` ON `task_session_runs` (`task_session_id`,`state`);
--> statement-breakpoint
CREATE INDEX `task_session_runs_state_lease_idx` ON `task_session_runs` (`state`,`lease_expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_session_runs_session_request_key` ON `task_session_runs` (`task_session_id`,`client_request_key`);
--> statement-breakpoint
CREATE TABLE `task_run_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_session_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`dedupe_key` text,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `task_session_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_session_id`) REFERENCES `task_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_run_events_run_seq_unique` ON `task_run_events` (`run_id`,`event_seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_run_events_run_dedupe_unique` ON `task_run_events` (`run_id`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `task_run_events_run_event_seq_idx` ON `task_run_events` (`run_id`,`event_seq`);
--> statement-breakpoint
CREATE INDEX `task_run_events_session_event_seq_idx` ON `task_run_events` (`task_session_id`,`event_seq`);
