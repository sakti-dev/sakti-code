-- Links a mission session to its SDD change. Nullable — set when a mission is
-- created from a plan graduation. Used by the runtime to resolve the change dir
-- for progress-aware reminders.
ALTER TABLE `sessions` ADD COLUMN `change_name` text;