/**
 * Router build-gate check against the REAL database.
 *
 * `scripts/test-build-policy.ts` proves the decision function; this proves the
 * wiring — that `advance()` actually consults the campaign policy and the latest
 * audit verdict before enqueuing `content-and-design`, and that an ineligible
 * business is left resting in `production_ready` instead of being pushed into a
 * build. It uses a throwaway campaign and cleans up after itself; no real
 * business row is read or written.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { advance } from '../src/orchestrator/router.js';

const CAMPAIGN = 'test-build-gate-campaign';
const SUFFIX = Date.now();

let passed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`FAILED: ${label} ${detail}`);
  passed++;
  console.log(`✅ ${label}`);
}

/** Jobs of this type queued for a business since the test started. */
async function buildJobCount(businessId: string): Promise<number> {
  const rows = await db.select().from(schema.workflowJobs)
    .where(eq(schema.workflowJobs.businessId, businessId));
  return rows.filter((r) => r.jobType === 'content-and-design').length;
}

async function makeBusiness(slug: string, verdict: string | null, score: number): Promise<string> {
  const id = `test-gate-${slug}-${SUFFIX}`;
  await db.insert(schema.businesses).values({
    id, campaignId: CAMPAIGN, name: `Gate test ${slug}`, normalizedName: `gate test ${slug}`,
    status: 'production_ready', score, placeId: `test-place-${slug}-${SUFFIX}`,
  });
  if (verdict) {
    await db.insert(schema.websiteAudits).values({ businessId: id, verdict });
  }
  return id;
}

async function main(): Promise<void> {
  await db.insert(schema.campaigns).values({
    id: CAMPAIGN, country: 'GR', city: 'Testtown', niche: 'beauty',
    queries: ['test'], geofence: { lat: 0, lng: 0, radiusKm: 1 },
    autoBuild: 'no_site_only',
  }).onConflictDoNothing();

  const noSite = await makeBusiness('nosite', 'no_website', 60);
  const hasSite = await makeBusiness('hassite', 'working_good', 95);
  const noAudit = await makeBusiness('noaudit', null, 90);
  // For the stop-point ladder: a business that WOULD be built (no_website) so the
  // only thing that can hold it back is `auto_stage`, never the build policy.
  const stageGate = await makeBusiness('stagegate', 'no_website', 80);

  try {
    // ── policy no_site_only ──────────────────────────────────────────────────
    await advance(noSite);
    ok('no_site_only: no_website business IS enqueued', await buildJobCount(noSite) === 1);

    await advance(hasSite);
    ok('no_site_only: working_good business is NOT enqueued', await buildJobCount(hasSite) === 0);

    await advance(noAudit);
    ok('no_site_only: business without an audit is NOT enqueued', await buildJobCount(noAudit) === 0);

    // The gate must not touch the state machine: skipped businesses keep resting
    // in production_ready, ready for the UI button.
    const [stillReady] = await db.select().from(schema.businesses)
      .where(eq(schema.businesses.id, hasSite));
    ok('skipped business stays in production_ready', stillReady?.status === 'production_ready',
      `got ${stillReady?.status}`);

    // ── policy all ───────────────────────────────────────────────────────────
    await db.update(schema.campaigns).set({ autoBuild: 'all' })
      .where(eq(schema.campaigns.id, CAMPAIGN));
    await advance(hasSite);
    ok('policy all: working_good business IS enqueued', await buildJobCount(hasSite) === 1);

    // ── stop-point ladder (auto_stage) — orthogonal to auto_build ─────────────
    // auto_build stays 'all' so a skipped build can only be the stop-point.
    await db.update(schema.campaigns).set({ autoStage: 'enrich' })
      .where(eq(schema.campaigns.id, CAMPAIGN));
    await advance(stageGate);
    ok('auto_stage enrich: a buildable business is NOT built', await buildJobCount(stageGate) === 0);

    await db.update(schema.campaigns).set({ autoStage: 'build' })
      .where(eq(schema.campaigns.id, CAMPAIGN));
    await advance(stageGate);
    ok('auto_stage build: the same business IS built', await buildJobCount(stageGate) === 1);

    // ── paused campaign starts no new work ────────────────────────────────────
    await db.update(schema.campaigns).set({ status: 'paused' })
      .where(eq(schema.campaigns.id, CAMPAIGN));
    await advance(noSite); // noSite already has 1 job from the first assertion
    ok('paused campaign: no further build is enqueued', await buildJobCount(noSite) === 1);
    await db.update(schema.campaigns).set({ status: 'running' })
      .where(eq(schema.campaigns.id, CAMPAIGN));

    // ── policy manual ────────────────────────────────────────────────────────
    await db.update(schema.campaigns).set({ autoBuild: 'manual' })
      .where(eq(schema.campaigns.id, CAMPAIGN));
    await advance(noAudit);
    ok('policy manual: nothing is enqueued', await buildJobCount(noAudit) === 0);

    console.log(`\n🏭 ROUTER BUILD GATE PASSED (${passed})`);
  } finally {
    for (const id of [noSite, hasSite, noAudit, stageGate]) {
      await db.delete(schema.workflowJobs).where(eq(schema.workflowJobs.businessId, id));
      await db.delete(schema.websiteAudits).where(eq(schema.websiteAudits.businessId, id));
      await db.delete(schema.businesses).where(eq(schema.businesses.id, id));
    }
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, CAMPAIGN));
    // The enqueues above are real pg-boss rows for businesses that no longer
    // exist. Left behind, a worker would pick them up and fail on a missing
    // business, so the test removes its own queue entries too.
    await db.execute(sql`delete from pgboss.job where singleton_key like ${`%test-gate-%-${SUFFIX}`}`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
