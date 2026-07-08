-- Pending transition tool-call awaiting resolution. Set when an agent's
-- `transition` tool-call starts; the runner resolves gate/auto and either
-- chains (auto) or leaves it pending for the confirm route (gate).
ALTER TABLE `sessions` ADD COLUMN `pending_transition_to` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `pending_transition_body` text;