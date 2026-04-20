-- v4 convention (PR #86 Chunk 4, 2026-04-21)
-- Adds timing fields, engagement metadata, dependency tracking, and cascade audit linkage.
-- Unrelated prior additions (clients.nicknames, team_members.full_name/nicknames/updated_at,
-- updates.batch_id) already exist in prod from earlier `runway:push` runs; excluded here
-- to keep this migration scoped to Chunk 4.
ALTER TABLE `projects` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `contract_start` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `contract_end` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `engagement_type` text;--> statement-breakpoint
ALTER TABLE `updates` ADD `triggered_by_update_id` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `blocked_by` text;
