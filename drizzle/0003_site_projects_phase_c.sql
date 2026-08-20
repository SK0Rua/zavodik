-- Phase C (SPEC §4 stages 9-12): the site build pipeline records what it built
-- from, how the design was chosen, how many QA iterations it took, and where the
-- private demo lives.
ALTER TABLE "site_projects" ADD COLUMN IF NOT EXISTS "snapshot_key" text;--> statement-breakpoint
ALTER TABLE "site_projects" ADD COLUMN IF NOT EXISTS "design_score" real;--> statement-breakpoint
ALTER TABLE "site_projects" ADD COLUMN IF NOT EXISTS "build_seconds" integer;--> statement-breakpoint
ALTER TABLE "site_projects" ADD COLUMN IF NOT EXISTS "qa_report_keys" jsonb;--> statement-breakpoint
ALTER TABLE "site_projects" ADD COLUMN IF NOT EXISTS "open_issues" jsonb;--> statement-breakpoint
ALTER TABLE "site_projects" ADD COLUMN IF NOT EXISTS "deploy_token" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_project_biz_idx" ON "site_projects" ("business_id");
