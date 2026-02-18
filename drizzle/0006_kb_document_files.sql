ALTER TABLE `knowledge_documents` ADD `mime_type` text DEFAULT 'text/markdown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `file_extension` text DEFAULT 'md' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `size` integer DEFAULT 0 NOT NULL;
