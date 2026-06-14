CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token` text,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_uq` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `comment_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`owner_handle` text NOT NULL,
	`slug` text NOT NULL,
	`page_path` text NOT NULL,
	`version_id` text NOT NULL,
	`selector` text NOT NULL,
	`rx` real NOT NULL,
	`ry` real NOT NULL,
	`rw` real,
	`rh` real,
	`kind` text,
	`anchor_text` text,
	`resolved` integer DEFAULT false NOT NULL,
	`comments` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `threads_page_idx` ON `comment_threads` (`owner_handle`,`slug`,`page_path`);--> statement-breakpoint
CREATE INDEX `threads_site_idx` ON `comment_threads` (`site_id`);--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_hash_uq` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`owner_handle` text NOT NULL,
	`slug` text NOT NULL,
	`title` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`public_expires_at` text,
	`spa_fallback` integer DEFAULT false NOT NULL,
	`comments_enabled` integer DEFAULT true NOT NULL,
	`current_version_id` text,
	`versions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_handle_slug_uq` ON `sites` (`owner_handle`,`slug`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `sites_owner_idx` ON `sites` (`owner_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`oidc_sub` text,
	`handle` text,
	`display_name` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`) WHERE email IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_sub_uq` ON `users` (`oidc_sub`) WHERE oidc_sub IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_uq` ON `users` (`handle`) WHERE handle IS NOT NULL;