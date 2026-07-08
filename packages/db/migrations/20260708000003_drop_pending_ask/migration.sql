-- The `ask` tool is removed; its pending-ask columns are no longer used.
-- Replaced by pending_transition_to / pending_transition_body.
ALTER TABLE `sessions` DROP COLUMN `pending_ask_kind`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `pending_ask_body`;