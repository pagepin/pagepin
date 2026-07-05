CREATE TABLE `handoff_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_code_uq` ON `handoff_codes` (`code`);