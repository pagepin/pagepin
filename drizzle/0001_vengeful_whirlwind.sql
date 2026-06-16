CREATE TABLE `device_auths` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` text,
	`token` text,
	`token_name` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`approved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_uq` ON `device_auths` (`device_code`);--> statement-breakpoint
CREATE INDEX `device_user_code_idx` ON `device_auths` (`user_code`);