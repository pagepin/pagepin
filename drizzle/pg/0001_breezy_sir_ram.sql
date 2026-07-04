ALTER TABLE "sites" ADD COLUMN "share_key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "guest_comments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "expires_at" varchar(40);--> statement-breakpoint
CREATE INDEX "sites_expires_idx" ON "sites" USING btree ("expires_at");