CREATE TABLE `account_merges` (
	`id` varchar(64) NOT NULL,
	`loser_id` varchar(64) NOT NULL,
	`survivor_id` varchar(64) NOT NULL,
	`email_key` varchar(320) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'moving',
	`created_at` varchar(40) NOT NULL,
	`finished_at` varchar(40),
	CONSTRAINT `account_merges_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_merges_loser_uq` UNIQUE(`loser_id`)
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`token` text,
	`token_hash` varchar(64) NOT NULL,
	`prefix` varchar(32) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`last_used_at` varchar(40),
	`expires_at` varchar(40),
	`revoked_at` varchar(40),
	CONSTRAINT `api_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `comment_threads` (
	`id` varchar(64) NOT NULL,
	`site_id` varchar(64) NOT NULL,
	`owner_handle` varchar(64) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`page_path` varchar(512) NOT NULL,
	`version_id` varchar(64) NOT NULL,
	`selector` text NOT NULL,
	`rx` double NOT NULL,
	`ry` double NOT NULL,
	`rw` double,
	`rh` double,
	`kind` varchar(16),
	`anchor_text` text,
	`resolved` boolean NOT NULL DEFAULT false,
	`comments` json NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	`deleted_at` varchar(40),
	CONSTRAINT `comment_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deploy_sessions` (
	`id` varchar(64) NOT NULL,
	`site_id` varchar(64) NOT NULL,
	`owner_id` varchar(64) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`storage_prefix` text NOT NULL,
	`title` text,
	`manifest` json NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	`expires_at` varchar(40) NOT NULL,
	CONSTRAINT `deploy_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `device_auths` (
	`id` varchar(64) NOT NULL,
	`device_code` varchar(255) NOT NULL,
	`user_code` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`user_id` varchar(64),
	`token` text,
	`token_name` varchar(255),
	`created_at` varchar(40) NOT NULL,
	`expires_at` varchar(40) NOT NULL,
	`approved_at` varchar(40),
	CONSTRAINT `device_auths_id` PRIMARY KEY(`id`),
	CONSTRAINT `device_code_uq` UNIQUE(`device_code`)
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`sub` varchar(255) NOT NULL,
	`email` varchar(320),
	`email_verified` boolean NOT NULL DEFAULT false,
	`created_at` varchar(40) NOT NULL,
	`last_login_at` varchar(40),
	CONSTRAINT `identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `identities_provider_sub_uq` UNIQUE(`provider`,`sub`)
);
--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`key` varchar(255) NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `instance_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` varchar(64) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`email` varchar(320),
	`is_admin` boolean NOT NULL DEFAULT false,
	`created_by` varchar(64) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`expires_at` varchar(40) NOT NULL,
	`accepted_at` varchar(40),
	`accepted_user_id` varchar(64),
	CONSTRAINT `invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invites_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` varchar(64) NOT NULL,
	`owner_id` varchar(64) NOT NULL,
	`owner_handle` varchar(64) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`title` text,
	`visibility` varchar(16) NOT NULL DEFAULT 'private',
	`public_expires_at` varchar(40),
	`spa_fallback` boolean NOT NULL DEFAULT false,
	`comments_enabled` boolean NOT NULL DEFAULT true,
	`current_version_id` varchar(64),
	`versions` json NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	`deleted_at` varchar(40),
	`suspended_at` varchar(40),
	`suspended_reason` text,
	CONSTRAINT `sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `sites_handle_slug_uq` UNIQUE(`owner_handle`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(64) NOT NULL,
	`email` varchar(320),
	`canonical_email` varchar(320),
	`email_verified` boolean NOT NULL DEFAULT false,
	`password_hash` text,
	`oidc_sub` varchar(255),
	`session_epoch` int NOT NULL DEFAULT 0,
	`handle` varchar(64),
	`display_name` varchar(255),
	`is_admin` boolean NOT NULL DEFAULT false,
	`disabled` boolean NOT NULL DEFAULT false,
	`created_at` varchar(40) NOT NULL,
	`last_login_at` varchar(40),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_canonical_email_uq` UNIQUE(`canonical_email`),
	CONSTRAINT `users_oidc_sub_uq` UNIQUE(`oidc_sub`),
	CONSTRAINT `users_handle_uq` UNIQUE(`handle`)
);
--> statement-breakpoint
CREATE INDEX `tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `threads_page_idx` ON `comment_threads` (`owner_handle`,`slug`,`page_path`);--> statement-breakpoint
CREATE INDEX `threads_site_idx` ON `comment_threads` (`site_id`);--> statement-breakpoint
CREATE INDEX `deploy_sessions_owner_idx` ON `deploy_sessions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `deploy_sessions_expires_idx` ON `deploy_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `device_user_code_idx` ON `device_auths` (`user_code`);--> statement-breakpoint
CREATE INDEX `identities_user_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_email_idx` ON `identities` (`email`);--> statement-breakpoint
CREATE INDEX `sites_owner_idx` ON `sites` (`owner_id`);