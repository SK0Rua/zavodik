ALTER TABLE "businesses"
  ADD COLUMN "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN "archived_reason" text;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN "archived_reason" text;
--> statement-breakpoint
-- Every list view filters archived rows out by default, so the common query is
-- "the live ones". A partial index keeps that lookup on the small set rather
-- than scanning archived history that only grows.
CREATE INDEX "biz_live_idx"
  ON "businesses" USING btree ("campaign_id", "status")
  WHERE "archived_at" is null;
--> statement-breakpoint
CREATE INDEX "campaign_live_idx"
  ON "campaigns" USING btree ("created_at")
  WHERE "archived_at" is null;
