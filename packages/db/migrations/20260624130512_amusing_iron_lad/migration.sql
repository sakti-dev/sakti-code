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
CREATE UNIQUE INDEX `turns_session_id_sequence_idx` ON `turns` (`session_id`,`sequence`);