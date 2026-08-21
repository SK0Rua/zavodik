-- Retry from the UI used to REBUILD a job's payload from the mirror row, which
-- stores only businessId/campaignId/idempotencyKey. Any richer field —
-- projectId for build-site/visual-qa/deploy-demo, iteration, issues — was
-- silently lost, and the retried job crashed with "site project not found:
-- undefined". Persist the full payload so a retry re-runs the job as it was.
ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS payload jsonb;
