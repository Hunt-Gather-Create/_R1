CREATE TABLE `_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`status` text,
	`owner` text,
	`resources` text,
	`start_date` text,
	`end_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sections_project_id_sort_order` ON `sections` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `sheet_registry` (
	`engagement_key` text PRIMARY KEY NOT NULL,
	`current_sheet_id` text NOT NULL,
	`previous_sheet_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sheet_sync_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_key` text NOT NULL,
	`entity_type` text NOT NULL,
	`sheet_key` text NOT NULL,
	`runway_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`last_sync_run_id` text,
	`last_seen_title` text,
	`last_seen_content_hash` text,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sheet_sync_ledger_engagement_entity_sheet_key` ON `sheet_sync_ledger` (`engagement_key`,`entity_type`,`sheet_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sheet_sync_ledger_runway_id` ON `sheet_sync_ledger` (`runway_id`);--> statement-breakpoint
CREATE INDEX `idx_sheet_sync_ledger_engagement_entity` ON `sheet_sync_ledger` (`engagement_key`,`entity_type`);--> statement-breakpoint
ALTER TABLE `week_items` ADD `section_id` text;--> statement-breakpoint
ALTER TABLE `week_items` ADD `task_no` text;