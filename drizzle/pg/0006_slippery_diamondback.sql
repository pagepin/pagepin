CREATE TABLE "group_grants" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"site_id" varchar(64) NOT NULL,
	"group_name" varchar(255) NOT NULL,
	"role" varchar(16) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_members" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"site_id" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"role" varchar(16) NOT NULL,
	"created_at" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"user_id" varchar(64) NOT NULL,
	"group_name" varchar(255) NOT NULL,
	"synced_at" varchar(40) NOT NULL,
	CONSTRAINT "user_groups_user_id_group_name_pk" PRIMARY KEY("user_id","group_name")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "scopes" jsonb;--> statement-breakpoint
ALTER TABLE "device_auths" ADD COLUMN "scopes" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "group_grants_site_group_uq" ON "group_grants" USING btree ("site_id","group_name");--> statement-breakpoint
CREATE UNIQUE INDEX "site_members_site_user_uq" ON "site_members" USING btree ("site_id","user_id");--> statement-breakpoint
CREATE INDEX "site_members_user_idx" ON "site_members" USING btree ("user_id");