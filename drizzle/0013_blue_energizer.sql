CREATE TABLE `group_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`group_name` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_grants_site_group_uq` ON `group_grants` (`site_id`,`group_name`);--> statement-breakpoint
CREATE TABLE `site_members` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_members_site_user_uq` ON `site_members` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `site_members_user_idx` ON `site_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_groups` (
	`user_id` text NOT NULL,
	`group_name` text NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `group_name`)
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `scopes` text;--> statement-breakpoint
ALTER TABLE `device_auths` ADD `scopes` text;