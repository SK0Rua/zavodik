import PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';
import { notifyJobProblem, notifySubscriptionPause } from '../telegram/notify.js';
import { isRateLimitedError } from '../agents/types.js';

export type JobName =
  | 'discover' | 'normalize' | 'fast-qualify' | 'enrich' | 'enrich-socials'
  | 'collect-assets' | 'refresh-brand'
  | 'audit-website' | 'score-and-qa' | 'readiness-gate' | 'content-and-design'
  | 'build-site' | 'visual-qa' | 'deploy-demo' | 'request-approval'
  | 'send-outreach' | 'send-followup' | 'poll-replies' | 'daily-summary';

export interface JobPayload {
  campaignId?: string;
  businessId?: string;
  idempotencyKey?: string;
  [k: string]: unknown;
}

export type Handler = (payload: JobPayload) => Promise<void>;

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'pgboss' });
  boss.on('error', (err) => log.error('pg-boss error', { err: String(err) }));
  await boss.start();
  return boss;
}

/**
 * Job types that consume the AI subscription. They run one-at-a-time
 * (teamSize/batchSize 1) so the 5-hour window is never burned in parallel;
 * `src/agents/semaphore.ts` enforces the same cap inside the process.
 */
const AGENT_JOBS: ReadonlySet<JobName> = new Set<JobName>([
  'enrich', 'score-and-qa', 'content-and-design', 'build-site', 'visual-qa', 'request-approval',
  // Since the agent-led social finder (SOCIAL_FINDER), this job can spend the
  // subscription window too: the engines are blocked on the server, so the
  // fallback fires routinely rather than rarely. Running it wide would park the
  // extra workers on the agent semaphore while their 30-minute expiry ran down.
  'enrich-socials',
]);

const RETRY: Partial<Record<JobName, { limit: number; delay: number }>> = {
  'discover': { limit: 2, delay: 60 },
  'enrich': { limit: 3, delay: 120 },
  // Browser + public SERPs: a second full pass costs minutes and hardens the
  // rate limits that caused the first failure. One retry, then it stays failed
  // and Roman re-runs it from the card when he wants to.
  'enrich-socials': { limit: 1, delay: 120 },
  // Mines stored evidence only — no page captures, no agent call. A retry is
  // cheap and the usual failure is a transient MinIO or CDN hiccup.
  'refresh-brand': { limit: 2, delay: 30 },
  'audit-website': { limit: 3, delay: 60 },
  'build-site': { limit: 1, delay: 0 },
  'send-outreach': { limit: 0, delay: 0 }, // NEVER auto-retry sends
};

export async function enqueue(
  name: JobName,
  payload: JobPayload,
  opts: { startAfterSeconds?: number; priority?: number } = {},
): Promise<string | null> {
  const b = await getBoss();
  const retry = RETRY[name] ?? { limit: 3, delay: 60 };
  const singletonKey = payload.idempotencyKey
    ?? (payload.businessId ? `${name}:${payload.businessId}` : `${name}:${payload.campaignId ?? 'global'}`);
  const jobId = await b.send(name, payload, {
    retryLimit: retry.limit,
    retryDelay: retry.delay,
    retryBackoff: true,
    // Agent jobs can legitimately run for an hour (site build + pnpm build).
    expireInSeconds: AGENT_JOBS.has(name) ? 60 * 90 : 60 * 30,
    singletonKey, // idempotency: same key won't double-queue while active
    // Higher runs first (pg-boss default 0). The build policy uses it so leads
    // with no site at all are built before ones that already have some presence.
    ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
    ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
  });
  await db.insert(schema.workflowJobs).values({
    bossJobId: jobId, jobType: name,
    businessId: payload.businessId ?? null, campaignId: payload.campaignId ?? null,
    payload: payload as Record<string, unknown>,
    idempotencyKey: singletonKey, status: 'queued',
  });
  log.info('job enqueued', { name, jobId, ...payload });
  return jobId;
}

/** Wrap a handler with job-journal + error routing. One business failing never stops the campaign. */
export async function register(name: JobName, handler: Handler): Promise<void> {
  const b = await getBoss();
  await b.createQueue(name).catch(() => { /* exists */ });
  // Agent jobs share one finite subscription window (SPEC §2.3а), so they are
  // capped rather than run wide. The cap follows AGENT_CONCURRENCY instead of
  // being pinned to 1: `src/agents/semaphore.ts` enforces the same number
  // in-process, so pulling more jobs than that would only park them on the
  // semaphore, while pulling fewer leaves configured capacity unused.
  const agentTeam = Math.max(1, config.agents.concurrency);
  const workOpts = AGENT_JOBS.has(name)
    ? { batchSize: 1, teamSize: agentTeam, teamConcurrency: agentTeam }
    : { batchSize: 1 };
  await b.work(name, workOpts, async (jobs) => {
    for (const job of jobs) {
      const payload = job.data as JobPayload;
      const [jobRow] = await db.select().from(schema.workflowJobs)
        .where(eq(schema.workflowJobs.bossJobId, job.id));
      const attempt = (jobRow?.attempts ?? 0) + 1;
      await db.update(schema.workflowJobs)
        .set({ status: 'running', attempts: attempt, startedAt: new Date() })
        .where(eq(schema.workflowJobs.bossJobId, job.id));
      try {
        await handler(payload);
        await db.update(schema.workflowJobs)
          .set({ status: 'succeeded', finishedAt: new Date() })
          .where(eq(schema.workflowJobs.bossJobId, job.id));
      } catch (err: any) {
        const detail = String(err?.stack ?? err).slice(0, 4000);

        // SPEC §2.3(б): an exhausted subscription window is NOT a failure.
        // The job parks in `retry_wait`, is re-enqueued under the SAME
        // idempotency key once the window resets, and burns no attempt.
        if (isRateLimitedError(err)) {
          const waitMs = err.retryAfterMs;
          const nextAttemptAt = new Date(Date.now() + waitMs);
          await db.update(schema.workflowJobs)
            .set({
              status: 'retry_wait',
              // do not count this against the failure limit
              attempts: Math.max(0, attempt - 1),
              nextAttemptAt,
              errorCode: 'RATE_LIMITED',
              errorDetail: `subscription limit (${err.rateLimitType ?? 'unknown'}); resumes ${nextAttemptAt.toISOString()}`,
              finishedAt: new Date(),
            })
            .where(eq(schema.workflowJobs.bossJobId, job.id));
          await enqueue(name, { ...payload, idempotencyKey: jobRow?.idempotencyKey ?? payload.idempotencyKey },
            { startAfterSeconds: Math.ceil(waitMs / 1000) });
          log.warn('job parked on subscription limit', {
            name, jobId: job.id, waitMinutes: Math.round(waitMs / 60_000),
            resumesAt: nextAttemptAt.toISOString(),
          });
          await notifySubscriptionPause({
            jobType: name, businessId: payload.businessId, resumesAt: nextAttemptAt,
            runtime: err.runtime,
          }).catch(() => {});
          continue; // resolved for pg-boss: no failure, no auto-retry storm
        }
        const isFinalAttempt = attempt > (RETRY[name]?.limit ?? 3);
        const needsHuman = err?.code === 'NEEDS_HUMAN';
        await db.update(schema.workflowJobs)
          .set({
            status: needsHuman ? 'needs_human' : (isFinalAttempt ? 'failed' : 'queued'),
            errorCode: err?.code ?? 'ERR',
            errorDetail: detail,
            finishedAt: new Date(),
          })
          .where(eq(schema.workflowJobs.bossJobId, job.id));
        log.error('job failed', { name, jobId: job.id, attempt, err: detail.slice(0, 500) });
        if (needsHuman || isFinalAttempt) {
          await notifyJobProblem({
            jobType: name,
            businessId: payload.businessId,
            campaignId: payload.campaignId,
            needsHuman,
            error: String(err?.message ?? err),
          }).catch(() => {});
        }
        if (!needsHuman) throw err; // let pg-boss retry
      }
    }
  });
}

export class NeedsHumanError extends Error {
  code = 'NEEDS_HUMAN';
  constructor(msg: string) { super(msg); }
}
