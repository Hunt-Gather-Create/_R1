ALTER TABLE `knowledge_documents` ADD `preview_storage_key` text;
ALTER TABLE `knowledge_documents` ADD `preview_mime_type` text;
ALTER TABLE `knowledge_documents` ADD `preview_status` text DEFAULT 'ready' NOT NULL;
ALTER TABLE `knowledge_documents` ADD `preview_error` text;
