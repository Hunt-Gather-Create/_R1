CREATE TABLE `ad_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`chat_id` text,
	`message_id` text,
	`platform` text NOT NULL,
	`template_type` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`media_assets` text,
	`issue_attachment_id` text,
	`brand_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `workspace_chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null
);
