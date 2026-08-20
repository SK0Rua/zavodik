-- Build policy per campaign (Roman's decision, 2026-08-16): the factory must NOT
-- burn subscription hours building demos for businesses that already have a good
-- site. `production_ready` no longer implies "start the build" — the campaign's
-- policy decides, and the operator can always start one build by hand from the UI.
--
--   no_site_only (default) — enqueue content-and-design only when the latest
--                            website_audits verdict is no_website | social_only | broken
--   all                    — enqueue for every production_ready business
--   manual                 — never enqueue automatically; the UI button is the only way
--
-- Default is `no_site_only` for existing campaigns too: that is the behaviour
-- Roman asked for, and widening it later is one UPDATE.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "auto_build" text DEFAULT 'no_site_only' NOT NULL;

-- The build policy reads "the latest audit for this business" on every
-- production_ready transition and on every funnel page render.
CREATE INDEX IF NOT EXISTS "audit_biz_latest_idx" ON "website_audits" ("business_id","audited_at" DESC);
