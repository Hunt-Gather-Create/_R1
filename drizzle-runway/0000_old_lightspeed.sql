CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`contract_value` text,
	`contract_term` text,
	`contract_status` text,
	`team` text,
	`client_contacts` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_slug_unique` ON `clients` (`slug`);--> statement-breakpoint
CREATE TABLE `pipeline_items` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`name` text NOT NULL,
	`owner` text,
	`status` text,
	`estimated_value` text,
	`waiting_on` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`category` text,
	`owner` text,
	`resources` text,
	`waiting_on` text,
	`target` text,
	`due_date` text,
	`notes` text,
	`stale_days` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`first_name` text,
	`title` text,
	`slack_user_id` text,
	`role_category` text,
	`accounts_led` text,
	`channel_purpose` text,
	`is_active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_slack_user_id_unique` ON `team_members` (`slack_user_id`);--> statement-breakpoint
CREATE TABLE `updates` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text,
	`project_id` text,
	`client_id` text,
	`updated_by` text,
	`update_type` text,
	`previous_value` text,
	`new_value` text,
	`summary` text,
	`metadata` text,
	`slack_message_ts` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `updates_idempotency_key_unique` ON `updates` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `week_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`client_id` text,
	`day_of_week` text,
	`week_of` text,
	`date` text,
	`title` text NOT NULL,
	`status` text,
	`category` text,
	`owner` text,
	`resources` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
