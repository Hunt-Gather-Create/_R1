-- v4 convention (PR #86 Chunks 4 + 5, 2026-04-21)
--
-- Adds timing fields, engagement metadata, dependency tracking, and cascade
-- audit linkage, PLUS the earlier unlogged additions (clients.nicknames,
-- team_members.full_name / nicknames / updated_at, updates.batch_id) so that
-- the snapshot JSON and the SQL file agree.
--
-- Prod has already applied this migration under its previous (trimmed) form;
-- drizzle-kit tracks applied migrations by `tag` (filename), not file hash,
-- so re-running `runway:push` against prod will not attempt to re-run this.
-- A fresh-DB replay via `drizzle-kit migrate` from empty will now produce a
-- schema that matches the snapshot exactly.
ALTER TABLE `clients` ADD `nicknames` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `contract_start` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `contract_end` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `engagement_type` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `full_name` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `nicknames` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `updates` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `updates` ADD `triggered_by_update_id` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `blocked_by` text;
