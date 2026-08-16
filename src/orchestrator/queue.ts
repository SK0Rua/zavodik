import PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';
import { notifyTelegram } from '../telegram/notify.js';

export type JobName =
  | 'discover' | 'normalize' | 'fast-qualify' | 'enrich' | 'collect-assets'
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

const RETRY: Partial<Record<JobName, { limit: number; delay: number }>> = {
  'discover': { limit: 2, delay: 60 },
  'enrich': { limit: 3, delay: 120 },
  'audit-website': { limit: 3, delay: 60 },
  'build-site': { limit: 1, delay: 0 },
  'send-outreach': { limit: 0, delay: 0 }, // NEVER auto-retry sends
};

export async function enqueue(name: JobName, payload: JobPayload): Promise<string | null> {
  const b = await getBoss();
  const retry = RETRY[name] ?? { limit: 3, delay: 60 };
  const singletonKey = payload.idempotencyKey
    ?? (payload.businessId ? `${name}:${payload.businessId}` : `${name}:${payload.campaignId ?? 'global'}`);
  const jobId = await b.send(name, payload, {
    retryLimit: retry.limit,
    retryDelay: retry.delay,
    retryBackoff: true,
    expireInSeconds: 60 * 30,
    singletonKey, // idempotency: same key won't double-queue while active
  });
  await db.insert(schema.workflowJobs).values({
    bossJobId: jobId, jobType: name,
    businessId: payload.businessId ?? null, campaignId: payload.campaignId ?? null,
    idempotencyKey: singletonKey, status: 'queued',
  });
  log.info('job enqueued', { name, jobId, ...payload });
  return jobId;
}

/** Wrap a handler with job-journal + error routing. One business failing never stops the campaign. */
export async function register(name: JobName, handler: Handler): Promise<void> {
  const b = await getBoss();
  await b.createQueue(name).catch(() => { /* exists */ });
  await b.work(name, { batchSize: 1 }, async (jobs) => {
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
          await notifyTelegram(
            `⚠️ Job ${name} ${needsHuman ? 'needs human' : 'failed after retries'}\n` +
            `business: ${payload.businessId ?? '-'}\ncampaign: ${payload.campaignId ?? '-'}\n` +
            `error: ${String(err?.message ?? err).slice(0, 300)}`,
          ).catch(() => {});
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
