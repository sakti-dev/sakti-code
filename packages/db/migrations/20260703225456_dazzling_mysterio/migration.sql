ALTER TABLE `sessions` ADD `status` text DEFAULT 'planning' NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `status` = 'building' WHERE `kind` = 'task';