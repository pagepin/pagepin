CREATE TABLE `group_grants` (
	`id` varchar(64) NOT NULL,
	`site_id` varchar(64) NOT NULL,
	`group_name` varchar(255) NOT NULL,
	`role` varchar(16) NOT NULL,
	`created_by` varchar(64) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `group_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_grants_site_group_uq` UNIQUE(`site_id`,`group_name`)
);
--> statement-breakpoint
CREATE TABLE `site_members` (
	`id` varchar(64) NOT NULL,
	`site_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`role` varchar(16) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `site_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_members_site_user_uq` UNIQUE(`site_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_groups` (
	`user_id` varchar(64) NOT NULL,
	`group_name` varchar(255) NOT NULL,
	`synced_at` varchar(40) NOT NULL,
	CONSTRAINT `user_groups_user_id_group_name_pk` PRIMARY KEY(`user_id`,`group_name`)
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `scopes` json;--> statement-breakpoint
ALTER TABLE `device_auths` ADD `scopes` json;--> statement-breakpoint
CREATE INDEX `site_members_user_idx` ON `site_members` (`user_id`);