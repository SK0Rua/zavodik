/**
 * Verifies spec §7: gosom unreachable / 0 results => loud failure, never a silent zero.
 * Points the client at a dead port and at a stub server returning a header-only CSV.
 */
import http from 'node:http';
import { db, schema, pool } from '../src/db/client.js';
import { config } from '../src/config.js';

// config reads env at import time, so override the live object (NEVER let this
// test hit the real gosom: it would queue a junk scrape job).
config.gosom.url = 'http://127.0.0.1:59999'; // nothing listening
config.gosom.requestTimeoutSeconds = 3;
config.gosom.jobTimeoutSeconds = 10;
config.gosom.pollIntervalSeconds = 1;

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const CID = 'failpath-test-campaign';
await pool.query(`delete from campaigns where id = $1`, [CID]);
await db.insert(schema.campaigns).values({
  id: CID, country: 'gr', city: 'Patras', niche: 'beauty', language: 'el',
  queries: ['nail salon'], geofence: { lat: 38.24, lng: 21.73, radiusKm: 10 }, targetCount: 5,
});

const { discoverHandler, DiscoveryUnavailableError } = await import(
  '../src/workers/discovery.js');

// 1) gosom unreachable
let err: any = null;
try { await discoverHandler({ campaignId: CID }); } catch (e) { err = e; }
check('gosom unreachable -> throws', !!err, String(err?.message ?? '').slice(0, 90));
check('  ... as DiscoveryUnavailableError', err instanceof DiscoveryUnavailableError);

// 2) gosom reachable but job yields an empty result set (header row only)
const stub = http.createServer((req, res) => {
  const url = req.url ?? '';
  if (req.method === 'POST' && url === '/api/v1/jobs') {
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'stub-job-1' }));
  } else if (url.endsWith('/download')) {
    res.writeHead(200, { 'content-type': 'text/csv' });
    res.end('input_id,link,title,category,address,website,phone,review_count,review_rating,latitude,longitude,place_id,emails\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ID: 'stub-job-1', Name: 'x', Date: new Date().toISOString(), Status: 'ok', Data: {} }));
  }
});
await new Promise<void>((r) => stub.listen(59998, r));
config.gosom.url = 'http://127.0.0.1:59998';

err = null;
try { await discoverHandler({ campaignId: CID }); } catch (e) { err = e; }
check('0 results -> throws (not a silent zero)', !!err, String(err?.message ?? '').slice(0, 90));
check('  ... mentions 0 candidates', /0 candidates/.test(String(err?.message ?? '')));

const biz = await pool.query(`select count(*)::int n from businesses where campaign_id = $1`, [CID]);
check('no businesses created on failure', biz.rows[0].n === 0);

// 3) a failed gosom job must also throw
stub.close();
await pool.query(`delete from campaigns where id = $1`, [CID]);
await pool.end();
console.log(failures === 0 ? '\n✅ FAILURE PATHS OK' : `\n💥 ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
