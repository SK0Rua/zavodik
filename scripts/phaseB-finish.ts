/**
 * Drives specific businesses through stages 4-8 synchronously, in-process.
 *
 * Used to finish businesses left mid-flight when a worker host is stopped:
 * enrichment clears a business's facts before rewriting them, so a process
 * killed mid-enrichment leaves the row at `enriching` with zero facts. This
 * runs the same handlers the queue would, in the same order, without needing a
 * worker host or competing for its slots.
 */
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { enrichHandler } from '../src/workers/enrich.js';
import { collectAssetsHandler } from '../src/workers/assets.js';
import { auditHandler } from '../src/workers/audit.js';
import { scoreAndQaHandler } from '../src/workers/score.js';
import { readinessHandler } from '../src/workers/readiness.js';
import { ensureBuckets } from '../src/lib/storage.js';

const campaignId = process.argv[2] ?? 'gr-patras-beauty';
const explicit = process.argv.slice(3);

await ensureBuckets();

const targets = explicit.length
  ? explicit
  : (await db.select({ id: schema.businesses.id }).from(schema.businesses).where(and(
      eq(schema.businesses.campaignId, campaignId),
      inArray(schema.businesses.status, ['prequalified', 'enriching']),
    ))).map((r) => r.id);

if (targets.length === 0) { console.log('nothing to finish'); process.exit(0); }
console.log(`finishing ${targets.length} business(es) through stages 4-8\n`);

for (const businessId of targets) {
  const t0 = Date.now();
  try {
    // `imageUrls` normally rides on the queue payload; enrichment re-enqueues
    // collect-assets itself, so here the offers are read back off that job.
    await enrichHandler({ businessId, campaignId });
    // Enrichment enqueued collect-assets with the image offers in its payload;
    // read that payload back so stage 5 runs here instead of waiting for a host.
    const jobs = await db.execute(sql`
      select data from pgboss.job
       where name = 'collect-assets' and data->>'businessId' = ${businessId}
       order by created_on desc limit 1`);
    const payload = (jobs as unknown as { rows: Array<{ data: { imageUrls?: unknown[] } }> }).rows[0]?.data;
    await collectAssetsHandler({ businessId, campaignId, imageUrls: (payload?.imageUrls ?? []) as never });
    await auditHandler({ businessId, campaignId });
    await scoreAndQaHandler({ businessId, campaignId });
    await readinessHandler({ businessId, campaignId });
    const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
    console.log(`  ${businessId}: ${biz?.status} (score ${biz?.score}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (err) {
    // One business failing must never stop the rest (spec §4).
    console.log(`  ${businessId}: FAILED — ${String(err).slice(0, 200)}`);
  }
}

process.exit(0);
