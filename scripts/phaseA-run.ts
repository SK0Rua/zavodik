/**
 * Phase A acceptance run: real gosom discovery for the Patras beauty campaign,
 * then drain the normalize + fast-qualify queues so businesses land in the DB.
 */
import { db, schema, pool } from '../src/db/client.js';
import { ensureBuckets } from '../src/lib/storage.js';
import { discoverHandler } from '../src/workers/discovery.js';
import { normalizeHandler } from '../src/workers/normalize.js';
import { fastQualifyHandler } from '../src/workers/fastQualify.js';
import { register, getBoss } from '../src/orchestrator/queue.js';

const CID = 'gr-patras-beauty';

await ensureBuckets();

// Drive normalize + fast-qualify through the REAL queue, so dedup/idempotency
// and the router are exercised exactly as in production.
await register('normalize', normalizeHandler);
await register('fast-qualify', fastQualifyHandler);

const t0 = Date.now();
console.log(`[run] starting discovery for ${CID} at ${new Date().toISOString()}`);
await discoverHandler({ campaignId: CID });
console.log(`[run] discovery handler finished in ${Math.round((Date.now() - t0) / 1000)}s`);

// let the queue drain
let idle = 0;
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const q = await pool.query(
    `select status, count(*)::int n from workflow_jobs where campaign_id = $1 group by status`, [CID],
  );
  const pending = q.rows.filter((r) => r.status === 'queued' || r.status === 'running')
    .reduce((a, r) => a + r.n, 0);
  const biz = await pool.query(`select count(*)::int n from businesses where campaign_id = $1`, [CID]);
  console.log(`[drain] pending=${pending} businesses=${biz.rows[0].n} ${JSON.stringify(q.rows)}`);
  if (pending === 0) { idle++; if (idle >= 3) break; } else idle = 0;
}

const boss = await getBoss();
await boss.stop({ close: true, timeout: 5000 }).catch(() => {});
await pool.end();
console.log('[run] done');
process.exit(0);
