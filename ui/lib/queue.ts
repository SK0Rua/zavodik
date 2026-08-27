/**
 * Enqueue into the SAME pg-boss instance the workers consume from.
 *
 * We use the pg-boss client rather than hand-written INSERTs: `pgboss.job` is
 * LIST-partitioned by queue name with hash-named partitions that `createQueue`
 * owns, so writing SQL by hand would break the first time pg-boss changes its
 * internals. The UI runs the client in send-only mode — `start()` without any
 * `work()` — so it never becomes a second job supervisor.
 */
import PgBoss from 'pg-boss';
import { db, schema } from './db';

export type JobName =
  | 'discover' | 'normalize' | 'fast-qualify' | 'enrich' | 'enrich-socials'
  | 'refresh-brand'
  | 'collect-assets'
  | 'audit-website' | 'score-and-qa' | 'readiness-gate' | 'content-and-design'
  | 'build-site' | 'visual-qa' | 'deploy-demo' | 'request-approval'
  | 'send-outreach' | 'send-followup' | 'poll-replies' | 'daily-summary'
  | 'assess-city';

/** Mirrors src/orchestrator/queue.ts. Sends are NEVER auto-retried (SPEC §7). */
const RETRY: Partial<Record<JobName, { limit: number; delay: number }>> = {
  'discover': { limit: 2, delay: 60 },
  'enrich': { limit: 3, delay: 120 },
  'enrich-socials': { limit: 1, delay: 120 },
  'refresh-brand': { limit: 2, delay: 30 },
  'audit-website': { limit: 3, delay: 60 },
  'build-site': { limit: 1, delay: 0 },
  'send-outreach': { limit: 0, delay: 0 },
};

const AGENT_JOBS: ReadonlySet<JobName> = new Set<JobName>([
  'enrich', 'score-and-qa', 'content-and-design', 'build-site', 'visual-qa', 'request-approval',
]);

const globalForBoss = globalThis as unknown as { factoryBoss?: Promise<PgBoss> };

async function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.factoryBoss) {
    globalForBoss.factoryBoss = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DATABASE_URL ?? 'postgres://factory:factory@localhost:5432/factory',
        schema: 'pgboss',
        max: 2,
        // Send-only: the workers own maintenance and scheduling.
        supervise: false,
        schedule: false,
      });
      boss.on('error', (err) => console.error('[ui] pg-boss error', err));
      await boss.start();
      return boss;
    })();
  }
  return globalForBoss.factoryBoss;
}

export interface EnqueueInput {
  name: JobName;
  businessId?: string | null;
  campaignId?: string | null;
  /** Doubles as the pg-boss singleton key: the same key never double-queues. */
  idempotencyKey: string;
  data?: Record<string, unknown>;
  startAfterSeconds?: number;
  /** Higher runs first. Build jobs use it so "no site at all" leads go first. */
  priority?: number;
}

/**
 * Returns the pg-boss job id, or null when a job with this singleton key is
 * already active — which is exactly the "second Approve click does nothing"
 * case the approval flow relies on.
 */
export async function enqueueJob(input: EnqueueInput): Promise<string | null> {
  const boss = await getBoss();
  const retry = RETRY[input.name] ?? { limit: 3, delay: 60 };

  await boss.createQueue(input.name).catch(() => { /* already exists */ });

  const jobId = await boss.send(
    input.name,
    {
      businessId: input.businessId ?? undefined,
      campaignId: input.campaignId ?? undefined,
      idempotencyKey: input.idempotencyKey,
      ...(input.data ?? {}),
    },
    {
      retryLimit: retry.limit,
      retryDelay: retry.delay,
      retryBackoff: true,
      expireInSeconds: AGENT_JOBS.has(input.name) ? 60 * 90 : 60 * 30,
      singletonKey: input.idempotencyKey,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.startAfterSeconds ? { startAfter: input.startAfterSeconds } : {}),
    },
  );

  // pg-boss returns null when a job with this singleton key is already active.
  // Writing a mirror row for it would create a permanently `queued` phantom
  // that no worker ever picks up — and the build button reads exactly this
  // table to decide "a build is already in flight", so the phantom would block
  // the business forever. No job, no row.
  if (!jobId) return null;

  // Mirror row for the Jobs page — the workers do the same in
  // src/orchestrator/queue.ts, so a UI-triggered job is visible there too.
  await db.insert(schema.workflowJobs).values({
    bossJobId: jobId,
    jobType: input.name,
    businessId: input.businessId ?? null,
    campaignId: input.campaignId ?? null,
    idempotencyKey: input.idempotencyKey,
    payload: {
      businessId: input.businessId ?? undefined,
      campaignId: input.campaignId ?? undefined,
      idempotencyKey: input.idempotencyKey,
      ...(input.data ?? {}),
    },
    status: 'queued',
  });

  return jobId;
}
