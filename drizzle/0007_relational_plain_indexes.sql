-- 存量回填:把已软删行的 slug 改成墓碑名(与 util.tombstoneSlug 同格式),让它们退出活
-- (owner_handle, slug) 命名空间。必须在下面把部分索引换成【普通】唯一索引【之前】跑,
-- 否则老库里存在「墓碑与活行同名」或「多个同名墓碑」时 CREATE UNIQUE INDEX 会失败。
UPDATE `sites` SET `slug` = `slug` || ':deleted:' || `id` WHERE `deleted_at` IS NOT NULL;--> statement-breakpoint
DROP INDEX `identities_email_idx`;--> statement-breakpoint
CREATE INDEX `identities_email_idx` ON `identities` (`email`);--> statement-breakpoint
DROP INDEX `sites_handle_slug_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `sites_handle_slug_uq` ON `sites` (`owner_handle`,`slug`);--> statement-breakpoint
DROP INDEX `users_canonical_email_uq`;--> statement-breakpoint
DROP INDEX `users_oidc_sub_uq`;--> statement-breakpoint
DROP INDEX `users_handle_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_canonical_email_uq` ON `users` (`canonical_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_sub_uq` ON `users` (`oidc_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_uq` ON `users` (`handle`);