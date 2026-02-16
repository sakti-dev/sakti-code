CREATE TABLE `working_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`scope` text DEFAULT 'resource' NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
