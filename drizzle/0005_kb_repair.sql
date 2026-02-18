CREATE TABLE IF NOT EXISTS `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_hash` text,
	`summary` text,
	`created_by` text,
	`updated_by` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `knowledge_folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `knowledge_document_tags` (
	`document_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`document_id`, `tag`),
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `knowledge_document_links` (
	`source_document_id` text NOT NULL,
	`target_document_id` text NOT NULL,
	`link_type` text DEFAULT 'wiki' NOT NULL,
	`created_at` integer,
	PRIMARY KEY(`source_document_id`, `target_document_id`, `link_type`),
	FOREIGN KEY (`source_document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `issue_knowledge_documents` (
	`issue_id` text NOT NULL,
	`document_id` text NOT NULL,
	`linked_by` text,
	`linked_at` integer,
	PRIMARY KEY(`issue_id`, `document_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `knowledge_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`created_by` text,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
