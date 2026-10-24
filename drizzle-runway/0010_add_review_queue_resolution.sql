ALTER TABLE `apply_review_queue` ADD `status` text;--> statement-breakpoint
ALTER TABLE `apply_review_queue` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `apply_review_queue` ADD `resolved_by` text;