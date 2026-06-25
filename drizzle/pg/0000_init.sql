CREATE TABLE "account_merges" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"loser_id" varchar(64) NOT NULL,
	"survivor_id" varchar(64) NOT NULL,
	"email_key" varchar(320) NOT NULL,
	"status" varchar(16) DEFAULT 'moving' NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"finished_at" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"token" text,
	"token_hash" varchar(64) NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"last_used_at" varchar(40),
	"expires_at" varchar(40),
	"revoked_at" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "comment_threads" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"site_id" varchar(64) NOT NULL,
	"owner_handle" varchar(64) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"page_path" varchar(512) NOT NULL,
	"version_id" varchar(64) NOT NULL,
	"selector" text NOT NULL,
	"rx" double precision NOT NULL,
	"ry" double precision NOT NULL,
	"rw" double precision,
	"rh" double precision,
	"kind" varchar(16),
	"anchor_text" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"comments" jsonb NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"updated_at" varchar(40) NOT NULL,
	"deleted_at" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "deploy_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"site_id" varchar(64) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"storage_prefix" text NOT NULL,
	"title" text,
	"manifest" jsonb NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"updated_at" varchar(40) NOT NULL,
	"expires_at" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_auths" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"device_code" varchar(255) NOT NULL,
	"user_code" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"user_id" varchar(64),
	"token" text,
	"token_name" varchar(255),
	"created_at" varchar(40) NOT NULL,
	"expires_at" varchar(40) NOT NULL,
	"approved_at" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"sub" varchar(255) NOT NULL,
	"email" varchar(320),
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"last_login_at" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"email" varchar(320),
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"expires_at" varchar(40) NOT NULL,
	"accepted_at" varchar(40),
	"accepted_user_id" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"owner_handle" varchar(64) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" text,
	"visibility" varchar(16) DEFAULT 'private' NOT NULL,
	"public_expires_at" varchar(40),
	"spa_fallback" boolean DEFAULT false NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"current_version_id" varchar(64),
	"versions" jsonb NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"updated_at" varchar(40) NOT NULL,
	"deleted_at" varchar(40),
	"suspended_at" varchar(40),
	"suspended_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" varchar(320),
	"canonical_email" varchar(320),
	"email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"oidc_sub" varchar(255),
	"session_epoch" integer DEFAULT 0 NOT NULL,
	"handle" varchar(64),
	"display_name" varchar(255),
	"is_admin" boolean DEFAULT false NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"last_login_at" varchar(40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_merges_loser_uq" ON "account_merges" USING btree ("loser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "threads_page_idx" ON "comment_threads" USING btree ("owner_handle","slug","page_path");--> statement-breakpoint
CREATE INDEX "threads_site_idx" ON "comment_threads" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "deploy_sessions_owner_idx" ON "deploy_sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deploy_sessions_expires_idx" ON "deploy_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_uq" ON "device_auths" USING btree ("device_code");--> statement-breakpoint
CREATE INDEX "device_user_code_idx" ON "device_auths" USING btree ("user_code");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_sub_uq" ON "identities" USING btree ("provider","sub");--> statement-breakpoint
CREATE INDEX "identities_user_idx" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identities_email_idx" ON "identities" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_hash_uq" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_handle_slug_uq" ON "sites" USING btree ("owner_handle","slug");--> statement-breakpoint
CREATE INDEX "sites_owner_idx" ON "sites" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_canonical_email_uq" ON "users" USING btree ("canonical_email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_sub_uq" ON "users" USING btree ("oidc_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_uq" ON "users" USING btree ("handle");