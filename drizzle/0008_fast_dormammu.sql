ALTER TABLE `sites` ADD `share_key_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `guest_comments` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `expires_at` text;--> statement-breakpoint
CREATE INDEX `sites_expires_idx` ON `sites` (`expires_at`);