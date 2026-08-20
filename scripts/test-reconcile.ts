/**
 * Reconciler tests (`src/orchestrator/reconcile.ts`).
 *
 * The reconciler runs at worker boot and REWRITES state, so the two properties
 * that matter are opposite in sign and both have to hold at once:
 *
 *   it must close work that is genuinely stranded, and
 *   it must not touch work that is genuinely alive.
 *
 * Getting the second one wrong is much worse than getting the first one wrong:
 * a missed ghost is a stale row on a settings page, but a live 40-minute build
 * marked `stale` and its business reverted mid-flight destroys real work. So
 * the live cases below are the point of this file, and the ghost cases are
 * there to prove the check is not simply a no-op.
 *
 *   pnpm tsx scripts/test-reconcile.ts
 *
 * Fixtures are created under `gr-recontest-*` and deleted at the end, pass or
 * fail. Nothing in the real campaign is read or written.
 */
import 'dotenv/config';
import { db, schema, pool } from '../src/db/client.js';
import { reconcileOnStartup } from '../src/orchestrator/reconcile.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const PREFIX = 'gr-recontest';
const CID = 'recontest-campaign';

async function cleanup() {
  for (const t of ['site_projects', 'workflow_jobs', 'status_history']) {
    await pool.query(`delete from ${t} where business_id like $1`, [`${PREFIX}%`]).catch(() => {});
  }
  await pool.query(`delete from businesses where id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from campaigns where id = $1`, [CID]).catch(() => {});
}

async function biz(id: string, status: string) {
  await db.insert(schema.businesses).values({
    id: `${PREFIX}-${id}`, campaignId: CID, name: `Recon ${id}`,
    normalizedName: `recon ${id}`, status,
  });
  return `${PREFIX}-${id}`;
}

/** Insert a mirror row. `bossJobId` null = never reached pg-boss = a ghost. */
async function job(businessId: string, jobType: string, status: string, bossJobId: string | null) {
  const [row] = await db.insert(schema.workflowJobs)
    .values({ businessId, jobType, status, bossJobId }).returning();
  return row.id;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(
    'select status from businesses where id = $1', [id]);
  return rows[0]?.status ?? 'MISSING';
}

async function jobStatus(id: number): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(
    'select status from workflow_jobs where id = $1', [id]);
  return rows[0]?.status ?? 'MISSING';
}

try {
  await cleanup();
  await db.insert(schema.campaigns).values({
    id: CID, country: 'gr', city: 'Recontest', niche: 'beauty', language: 'el',
    queries: ['x'], geofence: { lat: 38, lng: 21, radiusKm: 1 }, targetCount: 1,
  });

  // ── 1. a ghost job: mirror says queued, pg-boss has never heard of it ──────
  const ghostBiz = await biz('ghost', 'needs_review');
  const ghostJob = await job(ghostBiz, 'enrich', 'queued', null);

  // ── 2. a LIVE job: a real pg-boss row in `created`, must be left alone ─────
  // Written straight into pgboss.job so the test does not need a running worker
  // (a worker would dequeue it and change the state under us).
  const liveBiz = await biz('live', 'needs_review');
  const { rows: bossRows } = await pool.query<{ id: string }>(
    `insert into pgboss.job (name, data, state)
     values ('enrich', '{"businessId":"${liveBiz}"}'::jsonb, 'created')
     returning id`);
  const liveJob = await job(liveBiz, 'enrich', 'queued', bossRows[0].id);

  // ── 3. a stranded business: transient status, no job, no project ───────────
  const strandedBiz = await biz('stranded', 'site_in_progress');
  await db.insert(schema.statusHistory).values([
    { businessId: strandedBiz, fromStatus: 'qualified', toStatus: 'production_ready', actor: 'readiness-gate' },
    { businessId: strandedBiz, fromStatus: 'production_ready', toStatus: 'site_in_progress', actor: 'content-design-worker' },
  ]);

  // ── 4. a business whose build PRODUCED a project: never reverted, even with
  //       no live job — the artefact is the proof the work was real ──────────
  const builtBiz = await biz('built', 'site_in_progress');
  await db.insert(schema.siteProjects).values({
    businessId: builtBiz, state: 'building', dir: `sites/${builtBiz}`,
  });

  // ── 5. a transient business WITH a live job: not stranded ─────────────────
  const workingBiz = await biz('working', 'enriching');
  await job(workingBiz, 'enrich', 'queued', bossRows[0].id);

  // ── 6. a business with no stable history at all -> needs_review ───────────
  const noHistBiz = await biz('nohist', 'enriching');

  const report = await reconcileOnStartup();

  check('ghost job marked stale', await jobStatus(ghostJob) === 'stale', await jobStatus(ghostJob));
  check('LIVE job left queued', await jobStatus(liveJob) === 'queued', await jobStatus(liveJob));
  check('stranded business reverted to last stable',
    await statusOf(strandedBiz) === 'production_ready', await statusOf(strandedBiz));
  check('business WITH a site_project left alone',
    await statusOf(builtBiz) === 'site_in_progress', await statusOf(builtBiz));
  check('business with a live job left alone',
    await statusOf(workingBiz) === 'enriching', await statusOf(workingBiz));
  check('business with no stable history -> needs_review',
    await statusOf(noHistBiz) === 'needs_review', await statusOf(noHistBiz));

  // status_history must stay in lockstep with businesses.status — the invariant
  // the 2026-08-20 audit verified for all 36 rows.
  const { rows: hist } = await pool.query<{ actor: string; to_status: string }>(
    `select actor, to_status from status_history
      where business_id = $1 order by at desc limit 1`, [strandedBiz]);
  check('recovery written to status_history as actor=reconciler',
    hist[0]?.actor === 'reconciler' && hist[0]?.to_status === 'production_ready',
    `${hist[0]?.actor}/${hist[0]?.to_status}`);

  check('report counts the ghost', report.staleJobs >= 1, String(report.staleJobs));

  // ── idempotence: a second pass must be a no-op ────────────────────────────
  const second = await reconcileOnStartup();
  const secondTouchedFixtures = second.revertedBusinesses
    .filter((r) => r.businessId.startsWith(PREFIX));
  check('second pass reverts nothing more', secondTouchedFixtures.length === 0,
    JSON.stringify(secondTouchedFixtures));
  check('second pass leaves the live job alone', await jobStatus(liveJob) === 'queued');

  await pool.query('delete from pgboss.job where id = $1', [bossRows[0].id]).catch(() => {});
} finally {
  await cleanup();
}

console.log(failures === 0 ? '\n🔧 RECONCILE TESTS PASSED' : `\n❌ ${failures} failed`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
