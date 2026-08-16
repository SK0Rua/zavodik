/**
 * Smoke test: exercises the deterministic pipeline end-to-end without LLM agents
 * and without live Google Maps:
 *   campaign -> synthetic candidate -> normalize (dedup) -> fast-qualify
 *   -> website audit (real browser on a controlled local page) -> queue round-trip.
 * Run: pnpm tsx scripts/smoke.ts
 */
import { eq } from 'drizzle-orm';
import http from 'node:http';
import { db, schema, pool } from '../src/db/client.js';
import { ensureBuckets } from '../src/lib/storage.js';
import { normalizeHandler } from '../src/workers/normalize.js';
import { fastQualifyHandler } from '../src/workers/fastQualify.js';
import { auditHandler } from '../src/workers/audit.js';
import { readinessHandler } from '../src/workers/readiness.js';
import { getBoss, register, enqueue } from '../src/orchestrator/queue.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

await ensureBuckets();

// clean slate for the smoke campaign
const CID = 'smoke-test-campaign';
const BIZ_PREFIX = 'gr-smoketown';
await db.execute(`delete from status_history where business_id like '${BIZ_PREFIX}%'` as any).catch(() => {});
for (const table of ['production_gaps', 'qualifications', 'website_audits', 'business_contacts', 'business_facts', 'business_sources', 'workflow_jobs']) {
  await pool.query(`delete from ${table} where business_id like $1`, [`${BIZ_PREFIX}%`]).catch(() => {});
}
await pool.query(`delete from status_history where business_id like $1`, [`${BIZ_PREFIX}%`]);
await pool.query(`delete from businesses where id like $1`, [`${BIZ_PREFIX}%`]);
await pool.query(`delete from campaigns where id = $1`, [CID]);

await db.insert(schema.campaigns).values({
  id: CID, country: 'gr', city: 'Smoketown', niche: 'beauty', language: 'el',
  queries: ['nail salon'], geofence: { lat: 38, lng: 21, radiusKm: 10 }, targetCount: 5,
});
check('campaign created', true);

// local demo website for the audit stage (controlled, no external network)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Smoke Salon</title></head>
  <body><h1>Smoke Salon</h1><p>${'Beauty services in Smoketown. '.repeat(30)}</p></body></html>`);
});
await new Promise<void>((r) => server.listen(4567, r));

// ── normalize + dedup ──
const candidate = {
  name: 'Smoke Nails Studio', category: 'Nail salon', address: '1 Test St, Smoketown',
  phone: '+30 261 000 0000', websiteUrl: 'http://localhost:4567',
  listingUrl: 'https://maps.google.com/maps/place/smoke-nails?x=!19sChIJsmoke123', placeId: 'ChIJsmoke123',
  rating: 4.8, reviewCount: 52, lat: 38.0, lng: 21.0,
  rawObjectKey: 'smoke/raw-1', query: 'nail salon',
};
await normalizeHandler({ campaignId: CID, candidate: candidate as any });
let bizRows = await pool.query(`select * from businesses where campaign_id = $1`, [CID]);
check('normalize materialized business', bizRows.rowCount === 1, bizRows.rows[0]?.id);
const businessId = bizRows.rows[0].id as string;

// dedup: same placeId again must NOT create a second business
await normalizeHandler({ campaignId: CID, candidate: { ...candidate, name: 'Smoke Nails Studio DUPLICATE' } as any });
bizRows = await pool.query(`select * from businesses where campaign_id = $1`, [CID]);
check('dedup by place_id', bizRows.rowCount === 1);
const srcCount = await pool.query(`select count(*)::int n from business_sources where business_id = $1`, [businessId]);
check('duplicate attached as source', srcCount.rows[0].n >= 2, `sources=${srcCount.rows[0].n}`);

// ── fast qualification ──
await fastQualifyHandler({ businessId });
let biz = (await pool.query(`select * from businesses where id = $1`, [businessId])).rows[0];
check('fast-qualify -> prequalified', biz.status === 'prequalified', biz.status);

// illegal transition guard
const { transition } = await import('../src/orchestrator/statuses.js');
let threw = false;
try { await transition(businessId, 'contacted', 'smoke-worker'); } catch { threw = true; }
check('illegal transition blocked', threw);

// ── website audit (domain=localhost won't parse; set domain manually) ──
await pool.query(`update businesses set domain = 'localhost:4567', website_url = 'http://localhost:4567' where id = $1`, [businessId]);
await auditHandler({ businessId });
const audit = (await pool.query(`select * from website_audits where business_id = $1`, [businessId])).rows[0];
check('audit produced verdict', !!audit?.verdict, audit?.verdict);
check('audit took screenshots', !!audit?.desktop_screenshot_key && !!audit?.mobile_screenshot_key);

// ── readiness gate: no facts/assets yet -> must record gaps, not pass ──
await pool.query(`update businesses set status = 'qualified' where id = $1`, [businessId]);
await readinessHandler({ businessId });
const gaps = await pool.query(`select gap from production_gaps where business_id = $1 and resolved = false`, [businessId]);
check('readiness gate blocks incomplete package', gaps.rowCount! >= 3, gaps.rows.map((g: any) => g.gap).join(','));

// ── queue round-trip ──
await register('daily-summary', (await import('../src/workers/summary.js')).dailySummaryHandler);
await enqueue('daily-summary', { idempotencyKey: `smoke-summary-${Date.now()}` });
await new Promise((r) => setTimeout(r, 5000));
const jobRow = await pool.query(`select status from workflow_jobs where job_type = 'daily-summary' order by created_at desc limit 1`);
check('pg-boss queue round-trip', jobRow.rows[0]?.status === 'succeeded', jobRow.rows[0]?.status);

// status history is append-only and complete
const history = await pool.query(`select to_status from status_history where business_id = $1 order by at`, [businessId]);
check('status history recorded', history.rowCount! >= 2, history.rows.map((h: any) => h.to_status).join(' -> '));

server.close();
const boss = await getBoss();
await boss.stop({ close: true, timeout: 2000 });
await pool.end();

console.log(failures === 0 ? '\n🏭 SMOKE TEST PASSED' : `\n💥 ${failures} smoke checks failed`);
process.exit(failures === 0 ? 0 : 1);
