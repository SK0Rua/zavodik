/**
 * Integration test for the subscription-limit path (spec §2.3б) against the
 * REAL Postgres + pg-boss: a handler throwing RateLimitedError must park the
 * job in `retry_wait` with next_attempt_at, keep the same idempotency key,
 * NOT count an attempt, and never reach `failed`.
 *
 *   pnpm tsx scripts/test-rate-limit-requeue.ts
 */
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { enqueue, register, getBoss, type JobName } from '../src/orchestrator/queue.js';
import { RateLimitedError } from '../src/agents/types.js';

const KEY = `ratelimit-test:${Date.now()}`;
// A dedicated queue name: registering a REAL job type here would race with the
// production worker (and with jobs left over from earlier runs), which silently
// invalidates the test. Cast is safe — pg-boss treats the name as a plain string.
const JOB = `ratelimit-probe-${Date.now()}` as JobName;
let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`, detail ?? ''); }
};

async function main(): Promise<void> {
  let calls = 0;
  // Throw a rate limit on the first call only.
  await register(JOB, async () => {
    calls++;
    if (calls === 1) {
      throw new RateLimitedError('5-hour window exhausted', {
        retryAfterMs: 60_000, rateLimitType: 'five_hour',
        resetsAt: new Date(Date.now() + 60_000),
        runtime: 'codex',
      });
    }
  });

  await enqueue(JOB, { businessId: 'ratelimit-probe', idempotencyKey: KEY });

  // wait for the handler to run and the row to be updated
  const deadline = Date.now() + 60_000;
  let parked: typeof schema.workflowJobs.$inferSelect | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await db.select().from(schema.workflowJobs)
      .where(and(eq(schema.workflowJobs.idempotencyKey, KEY), eq(schema.workflowJobs.status, 'retry_wait')));
    if (rows.length) { parked = rows[0]; break; }
  }

  check('handler was invoked', calls >= 1, { calls });
  check('job parked in retry_wait', Boolean(parked), parked?.status);
  check('errorCode = RATE_LIMITED', parked?.errorCode === 'RATE_LIMITED', parked?.errorCode);
  check('next_attempt_at set in the future', Boolean(parked?.nextAttemptAt && parked.nextAttemptAt > new Date()), parked?.nextAttemptAt);
  check('attempts NOT counted against the limit', parked?.attempts === 0, parked?.attempts);

  const all = await db.select().from(schema.workflowJobs)
    .where(eq(schema.workflowJobs.idempotencyKey, KEY)).orderBy(desc(schema.workflowJobs.id));
  check('re-enqueued under the SAME idempotency key', all.length === 2, all.map((r) => r.status));
  check('both rows share one idempotency key', new Set(all.map((r) => r.idempotencyKey)).size === 1);
  check('never marked failed', !all.some((r) => r.status === 'failed'), all.map((r) => r.status));
  check('re-enqueued row is queued', all[0]?.status === 'queued', all[0]?.status);

  // cleanup
  await db.delete(schema.workflowJobs).where(eq(schema.workflowJobs.idempotencyKey, KEY));
  const boss = await getBoss();
  await boss.stop({ graceful: false });

  console.log(failures === 0 ? '\n🧪 RATE-LIMIT REQUEUE TEST PASSED' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('TEST ERROR:', err); process.exit(1); });
