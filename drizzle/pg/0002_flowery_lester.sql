CREATE TABLE "handoff_codes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"created_at" varchar(40) NOT NULL,
	"expires_at" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_code_uq" ON "handoff_codes" USING btree ("code");