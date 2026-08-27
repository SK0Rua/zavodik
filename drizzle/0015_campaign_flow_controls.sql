-- Campaign flow controls (Roman's workflow, 2026-08-27): the operator wants to
-- launch a campaign, review the discovered list FIRST, hand-pick the promising
-- leads, and only then command data-collection / demo prep — instead of the
-- pipeline running all the way to the build gate for everyone automatically.
--
-- Two orthogonal knobs, both decided in src/orchestrator/campaignFlow.ts. Neither
-- moves a business between statuses; they only gate the router's auto-advance.
--
--   auto_stage — the stop-point ladder:
--     discover — collect + fast-qualify only, then stop (no photos/facts/audit)
--     enrich   — collect data + audit + score, stop at production_ready (no build)
--     build    — full auto; auto_build then decides WHO gets built (default, so
--                existing campaigns keep their exact previous behaviour)
--
--   discovery_filter — cheap keep/drop rules at stage 3 (fast-qualify), applied
--     BEFORE any data is collected: { websiteNone, minRating, minReviews,
--     requireContact }. Default {} = no extra filtering = previous behaviour.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "auto_stage" text DEFAULT 'build' NOT NULL;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "discovery_filter" jsonb DEFAULT '{}'::jsonb NOT NULL;
