CREATE TABLE `bot_modal_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_slack_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_ts` text,
	`tool_name` text NOT NULL,
	`kind` text NOT NULL,
	`target_entity_id` text,
	`target_entity_type` text,
	`args` text NOT NULL,
	`conversation_ref` text,
	`parent_proposal_id` text,
	`intent_group_id` text,
	`pending_project_name` text,
	`posted_message_ts` text,
	`posted_message_channel` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`resolved_project_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_bot_modal_proposals_status_expires_at` ON `bot_modal_proposals` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_bot_modal_proposals_user_slack_id_created_at` ON `bot_modal_proposals` (`user_slack_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bot_modal_proposals_intent_group_id_status` ON `bot_modal_proposals` (`intent_group_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bot_modal_proposals_parent_proposal_id_status` ON `bot_modal_proposals` (`parent_proposal_id`,`status`);--> statement-breakpoint
ALTER TABLE `updates` ADD `source` text;