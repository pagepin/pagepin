CREATE TABLE "share_links" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"site_id" varchar(64) NOT NULL,
	"label" varchar(255),
	"created_at" varchar(40) NOT NULL,
	"expires_at" varchar(40),
	"revoked_at" varchar(40)
);
--> statement-breakpoint
CREATE INDEX "share_links_site_idx" ON "share_links" USING btree ("site_id");