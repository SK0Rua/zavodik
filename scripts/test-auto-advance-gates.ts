/**
 * The campaign-level gates on automatic advancement.
 *
 * These exist as a test because they have already been lost once: both lived in
 * `router.ts`'s `advance()`, and when chaining moved into the workers the
 * build-policy gate came along while these two did not. Nothing failed — the
 * buttons simply stopped doing anything, which is the kind of regression only a
 * test notices.
 */
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { autoAdvanceBlock } from '../src/orchestrator/autoAdvance.js';
import * as schema from '../src/db/schema.js';
import { withDisposableFactoryDatabase } from './lib/disposableFactoryDatabase.js';

let passed = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  await run();
  passed++;
  console.log(`✅ ${label}`);
}

await withDisposableFactoryDatabase(async ({ db }) => {
  async function campaign(
    id: string,
    status: string,
    autoStage: string,
  ): Promise<void> {
    await db.insert(schema.campaigns).values({
      id,
      country: 'UA',
      city: 'Sumy',
      niche: 'test',
      language: 'uk',
      queries: ['test'],
      geofence: { lat: 50.9, lng: 34.8, radiusKm: 1 },
      status,
      autoStage,
    });
  }

  // `autoAdvanceBlock` takes a transaction; every check runs in one.
  const blockOf = (campaignId: string | null, nextJob: string) =>
    db.transaction((tx) => autoAdvanceBlock(tx, campaignId, nextJob));

  await check('a paused campaign starts no new work', async () => {
    await campaign('paused-build', 'paused', 'build');
    assert.equal(await blockOf('paused-build', 'enrich'), 'campaign_paused');
    assert.equal(await blockOf('paused-build', 'content-and-design'), 'campaign_paused');
  });

  await check('a running campaign at the full stop-point advances freely', async () => {
    await campaign('running-build', 'running', 'build');
    assert.equal(await blockOf('running-build', 'enrich'), null);
    assert.equal(await blockOf('running-build', 'content-and-design'), null);
  });

  await check('stop-point `discover` freezes data collection', async () => {
    await campaign('running-discover', 'running', 'discover');
    assert.equal(await blockOf('running-discover', 'enrich'), 'stop_point');
    assert.equal(await blockOf('running-discover', 'content-and-design'), 'stop_point');
  });

  await check('stop-point `enrich` allows collection but not the build', async () => {
    await campaign('running-enrich', 'running', 'enrich');
    assert.equal(await blockOf('running-enrich', 'enrich'), null);
    assert.equal(await blockOf('running-enrich', 'content-and-design'), 'stop_point');
  });

  await check('the ladder gates only the two phase doors', async () => {
    await campaign('ladder', 'running', 'discover');
    // Mid-build continuations and the approval hand-off are not what the
    // ladder is for: stopping those would strand a half-built business.
    for (const job of ['build-site', 'visual-qa', 'deploy-demo', 'request-approval']) {
      assert.equal(await blockOf('ladder', job), null, `${job} must not be ladder-gated`);
    }
  });

  await check('pause outranks the stop-point, and an unknown campaign never blocks', async () => {
    await campaign('paused-discover', 'paused', 'discover');
    assert.equal(await blockOf('paused-discover', 'enrich'), 'campaign_paused');
    // A missing or absent campaign must not silently freeze the pipeline.
    assert.equal(await blockOf('does-not-exist', 'enrich'), null);
    assert.equal(await blockOf(null, 'enrich'), null);
  });

  await check('an archived campaign is paused, so it also stops advancing', async () => {
    await campaign('to-archive', 'running', 'build');
    await db.update(schema.campaigns)
      .set({ status: 'paused', archivedAt: new Date() })
      .where(eq(schema.campaigns.id, 'to-archive'));
    assert.equal(await blockOf('to-archive', 'enrich'), 'campaign_paused');
  });
});

console.log(`\n${passed} auto-advance gate checks passed`);
