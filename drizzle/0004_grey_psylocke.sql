CREATE TABLE `deploy_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`storage_prefix` text NOT NULL,
	`title` text,
	`manifest` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deploy_sessions_owner_idx` ON `deploy_sessions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `deploy_sessions_expires_idx` ON `deploy_sessions` (`expires_at`);