ALTER TABLE `knowledge_documents` ADD `preview_storage_key` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `preview_mime_type` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `preview_status` text DEFAULT 'ready' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `preview_error` text;
