CREATE TABLE `ad_artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`media_assets` text,
	`message_id` text,
	`created_at` integer,
	FOREIGN KEY (`artifact_id`) REFERENCES `ad_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `ad_artifacts` ADD `current_version` integer DEFAULT 0;