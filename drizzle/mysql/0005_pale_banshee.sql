CREATE TABLE `share_links` (
	`id` varchar(16) NOT NULL,
	`site_id` varchar(64) NOT NULL,
	`label` varchar(255),
	`created_at` varchar(40) NOT NULL,
	`expires_at` varchar(40),
	`revoked_at` varchar(40),
	CONSTRAINT `share_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `share_links_site_idx` ON `share_links` (`site_id`);