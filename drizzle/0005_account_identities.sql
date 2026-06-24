CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`sub` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_sub_uq` ON `identities` (`provider`,`sub`);--> statement-breakpoint
CREATE INDEX `identities_user_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_email_idx` ON `identities` (`email`) WHERE email IS NOT NULL;--> statement-breakpoint
DROP INDEX `users_email_uq`;--> statement-breakpoint
ALTER TABLE `users` ADD `canonical_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `session_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `users` SET `canonical_email` = lower(trim(`email`)) WHERE `email` IS NOT NULL;--> statement-breakpoint
UPDATE `users` SET `email_verified` = 1 WHERE `oidc_sub` IS NOT NULL AND `canonical_email` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `identities` (`id`, `user_id`, `provider`, `sub`, `email`, `email_verified`, `created_at`, `last_login_at`)
SELECT `id` || ':fed', `id`,
	CASE WHEN `oidc_sub` LIKE 'google:%' THEN 'google'
	     WHEN `oidc_sub` LIKE 'github:%' THEN 'github'
	     ELSE 'oidc' END,
	`oidc_sub`, `canonical_email`, CASE WHEN `canonical_email` IS NOT NULL THEN 1 ELSE 0 END, `created_at`, `last_login_at`
FROM `users` WHERE `oidc_sub` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `identities` (`id`, `user_id`, `provider`, `sub`, `email`, `email_verified`, `created_at`, `last_login_at`)
SELECT `id` || ':pw', `id`, 'password', `canonical_email`, `canonical_email`, 0, `created_at`, `last_login_at`
FROM `users` WHERE `password_hash` IS NOT NULL AND `canonical_email` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_canonical_email_uq` ON `users` (`canonical_email`) WHERE canonical_email IS NOT NULL;
