ALTER TABLE `sites` ADD `share_key_version` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `guest_comments` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `expires_at` varchar(40);--> statement-breakpoint
CREATE INDEX `sites_expires_idx` ON `sites` (`expires_at`);