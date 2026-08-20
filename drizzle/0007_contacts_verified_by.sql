-- Who confirmed an unverified social candidate, and why.
--
-- Social discovery writes `verified=false` contacts for MEDIUM matches: a
-- profile it found and captured but could not prove belongs to the business.
-- Roman confirms or rejects those from the business card. A bare `verified=true`
-- would lose the fact that a HUMAN decided it — indistinguishable from a strong
-- automatic match. These two columns keep that distinction auditable, which is
-- the same reason status changes carry `actor` (SPEC §5).
--
-- Nullable on purpose: every existing row was decided by the matcher, not a
-- person, and NULL is the honest value for that.
ALTER TABLE "business_contacts" ADD COLUMN IF NOT EXISTS "verified_by" text;
ALTER TABLE "business_contacts" ADD COLUMN IF NOT EXISTS "verified_note" text;
