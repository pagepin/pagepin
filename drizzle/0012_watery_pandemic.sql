CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	`expires_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `share_links_site_idx` ON `share_links` (`site_id`);