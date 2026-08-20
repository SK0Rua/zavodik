-- Full-page desktop screenshot for the website audit (stage 6).
--
-- Why: Roman's TRENDY HAIR case (2026-08-20). The audit rendered
-- https://trendyhair.gr/ with `domcontentloaded` + a fixed 2.5s wait, measured
-- 54 characters of text, and called a live WordPress shop `broken`. `broken`
-- counts as "no site" for the build policy, so a business WITH a good site
-- appeared under «Без сайту» and a demo build was started for it.
--
-- The viewport screenshot alone could not have caught that either: it shows the
-- top 900px, which on a slow JS-heavy site is a cookie banner over an empty
-- hero. The full-page capture is what makes the verdict auditable by eye — it
-- is stored as EXTRA evidence, the viewport shot stays the primary one so
-- nothing that reads `desktop_screenshot_key` changes.

ALTER TABLE website_audits
  ADD COLUMN IF NOT EXISTS desktop_full_screenshot_key text;
