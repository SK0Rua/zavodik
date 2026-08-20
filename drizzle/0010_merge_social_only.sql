-- Merge the `social_only` audit verdict into `no_website`.
--
-- Roman's decision (2026-08-19): social discovery now fills contacts for every
-- business, so "has only an Instagram profile" no longer tells the factory
-- anything the contact rows do not. The verdict set drops to five values:
--   no_website | broken | outdated | working_with_https_issue | working_good
-- The social/booking profile itself stays where it belongs — `business_contacts`
-- plus the contact icons in the UI — not as a verdict of its own.
--
-- `website_audits.verdict` is a plain text column with no CHECK constraint and
-- no enum type, so nothing blocks the value change; only the rows move.

UPDATE website_audits
   SET verdict = 'no_website',
       notes = CASE
                 WHEN notes IS NULL OR notes = '' THEN '(merged from social_only)'
                 WHEN notes LIKE '%(merged from social_only)%' THEN notes
                 ELSE left(notes || ' | (merged from social_only)', 2000)
               END
 WHERE verdict = 'social_only';
