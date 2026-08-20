-- Ukrainian translations of the free-text notes agents write (Roman, 2026-08-20).
--
-- Roman reads this console in Ukrainian. Two fields held prose in whatever
-- language the SOURCE evidence was in — a Patras salon's evidence is Greek, so
-- the enrichment agent honestly reported its gaps in Greek («Δεν εντοπίστηκε
-- επίσημος ιστότοπος…»), and the independent QA critic writes English. Both are
-- unreadable to the person the console is for.
--
-- The translation is stored ALONGSIDE the original, never over it. The original
-- is the evidence — what the agent actually said about what it actually saw —
-- and the invariant that we never rewrite evidence in place holds for the
-- agent's own words as much as for a business's. The UI shows the Ukrainian and
-- keeps the original one fold away.
--
-- NULL means "not translated": either the source was already Ukrainian, or the
-- translation step failed (it is non-fatal by design) and the reader falls back
-- to the original. It never means "no note".
--
-- `website_audits.notes` gets NO column here on purpose: every string in it is
-- built from a code-side template (`slow render (6.4s to settle)`,
-- `generator=WordPress 6.9.4`), so it is ours to write in Ukrainian directly and
-- to re-render for old rows — an LLM has no business translating our own format.

ALTER TABLE production_gaps
  ADD COLUMN IF NOT EXISTS gap_uk text;

ALTER TABLE qualifications
  ADD COLUMN IF NOT EXISTS qa_notes_uk text;
