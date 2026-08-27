-- City assessments (Roman, 2026-08-27): a quick, throwaway gosom probe that
-- answers "is this city+niche worth a campaign?" WITHOUT creating one. Stores
-- only aggregate counts + a verdict (go | maybe | skip) — never businesses,
-- never evidence. The row is the background job's own status tracker: the
-- assess-city worker flips status running -> done | failed. Verdict formula in
-- src/lib/cityAssessment.ts; no_site scored with the same extractDomain skip-list
-- the pipeline uses.
CREATE TABLE IF NOT EXISTS "city_assessments" (
  "id" serial PRIMARY KEY NOT NULL,
  "country" text NOT NULL,
  "city" text NOT NULL,
  "niche" text NOT NULL,
  "language" text NOT NULL,
  "lat" real,
  "lng" real,
  "radius_km" real,
  "depth" integer DEFAULT 2 NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "found" integer,
  "no_site" integer,
  "has_site" integer,
  "social_only" integer,
  "avg_rating" real,
  "sample" jsonb,
  "verdict" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp
);
CREATE INDEX IF NOT EXISTS "city_assess_created_idx" ON "city_assessments" ("created_at" DESC);
