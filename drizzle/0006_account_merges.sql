CREATE TABLE `account_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`loser_id` text NOT NULL,
	`survivor_id` text NOT NULL,
	`email_key` text NOT NULL,
	`status` text DEFAULT 'moving' NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_merges_loser_uq` ON `account_merges` (`loser_id`);