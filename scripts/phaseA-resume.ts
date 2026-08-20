/**
 * Attaches to an ALREADY RUNNING gosom job (id via --job) and finishes the
 * discovery pipeline from there: wait -> download CSV -> store raw evidence ->
 * map to candidates -> normalize/dedup -> fast-qualify.
 * Used when the scrape is already in flight and re-creating it would waste it.
 */
import { eq } from 'drizzle-orm';
import { db, schema, pool } from '../src/db/client.js';
import { ensureBuckets, putRaw } from '../src/lib/storage.js';
import {
  waitForGosomJob, downloadGosomCsv, mapCsvToCandidates,
} from '../src/workers/discovery.js';
import { normalizeHandler } from '../src/workers/normalize.js';
import { fastQualifyHandler } from '../src/workers/fastQualify.js';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (d !== undefined) return d;
  throw new Error(`missing --${n}`);
};

const CID = arg('campaign', 'gr-patras-beauty');
const JOB = arg('job');

await ensureBuckets();
const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, CID));
if (!campaign) throw new Error(`campaign not found: ${CID}`);

const t0 = Date.now();
console.log(`[resume] waiting on gosom job ${JOB} ...`);
const job = await waitForGosomJob(JOB);
console.log(`[resume] gosom job ${job.Status} after ${Math.round((Date.now() - t0) / 1000)}s`);

const csv = await downloadGosomCsv(JOB);
const rawObjectKey = await putRaw(`discovery/${CID}/gosom-${JOB}`, csv, 'text/csv');
console.log(`[resume] raw evidence: ${rawObjectKey} (${csv.length} bytes)`);

const candidates = mapCsvToCandidates(csv, (campaign.queries ?? []).join(' | '), rawObjectKey);
console.log(`[resume] candidates parsed: ${candidates.length}`);
if (candidates.length === 0) throw new Error('0 candidates — see spec §7');

const limited = candidates.slice(0, campaign.targetCount);
let ok = 0, failed = 0;
for (const cand of limited) {
  try {
    // call the handlers directly: same code path as the queue, no worker needed
    await normalizeHandler({ campaignId: CID, candidate: cand as any });
    ok++;
  } catch (err) {
    failed++;
    console.warn(`[resume] normalize failed for ${cand.name}: ${String(err).slice(0, 160)}`);
  }
}
console.log(`[resume] normalized ok=${ok} failed=${failed}`);

// fast-qualify everything still sitting in `discovered`
const discovered = await pool.query(
  `select id from businesses where campaign_id = $1 and status = 'discovered'`, [CID]);
let q = 0;
for (const row of discovered.rows) {
  try { await fastQualifyHandler({ businessId: row.id }); q++; } catch (err) {
    console.warn(`[resume] fast-qualify failed for ${row.id}: ${String(err).slice(0, 160)}`);
  }
}
console.log(`[resume] fast-qualified ${q}`);
await pool.end();
console.log(`[resume] done in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(0);
