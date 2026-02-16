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
CREATE UNIQUE INDEX `observational_memory_lookup_key` ON `observational_memory` (`lookup_key`);
