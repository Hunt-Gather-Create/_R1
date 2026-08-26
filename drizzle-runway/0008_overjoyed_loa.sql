CREATE TABLE `apply_review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL
);
