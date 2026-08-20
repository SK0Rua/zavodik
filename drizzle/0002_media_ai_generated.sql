ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "ai_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "generator" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "generation_meta" jsonb;
