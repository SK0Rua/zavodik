/**
 * Archive/delete behaviour against a real database.
 *
 * The API-level test (`test-archive-command-api`) stubs the service; this one
 * exercises the SQL, because the parts most likely to break are the ones only
 * Postgres can answer: the single cascade timestamp a campaign restore matches
 * on, the child-row deletion order, and the guarantee that a contacted business
 * survives a bulk delete aimed at it.
 */
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { ArchiveService } from '../src/orchestrator/archiveService.js';
import * as schema from '../src/db/schema.js';
import { withDisposableFactoryDatabase } from './lib/disposableFactoryDatabase.js';

let passed = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  await run();
  passed++;
  console.log(`✅ ${label}`);
}

await withDisposableFactoryDatabase(async ({ db }) => {
  const archive = new ArchiveService(db);

  async function campaign(id: string): Promise<void> {
    await db.insert(schema.campaigns).values({
      id,
      country: 'UA',
      city: 'Sumy',
      niche: 'test',
      language: 'uk',
      queries: ['test'],
      geofence: { lat: 50.9, lng: 34.8, radiusKm: 1 },
    }).onConflictDoNothing();
  }

  async function business(id: string, campaignId: string, status = 'discovered'): Promise<void> {
    await db.insert(schema.businesses).values({
      id, campaignId, name: id, normalizedName: id, status,
    });
  }

  async function isArchived(id: string): Promise<boolean> {
    const [row] = await db.select({ archivedAt: schema.businesses.archivedAt })
      .from(schema.businesses).where(eq(schema.businesses.id, id));
    return row?.archivedAt != null;
  }

  await check('archiving is reversible and leaves the workflow status alone', async () => {
    await campaign('c1');
    await business('b-won', 'c1', 'won');

    const archived = await archive.archiveBusiness('b-won', 'не цільовий');
    assert.equal(archived.kind, 'archived');
    assert.equal(await isArchived('b-won'), true);

    // The archive must NOT rewrite `status`: shelving a won deal cannot be
    // allowed to pretend the deal never happened.
    const [row] = await db.select().from(schema.businesses)
      .where(eq(schema.businesses.id, 'b-won'));
    assert.equal(row?.status, 'won');
    assert.equal(row?.archivedReason, 'не цільовий');

    await archive.unarchiveBusiness('b-won');
    assert.equal(await isArchived('b-won'), false);
  });

  await check('archiving twice is a no-op, not a second cancel storm', async () => {
    await business('b-twice', 'c1');
    await archive.archiveBusiness('b-twice');
    const [first] = await db.select({ at: schema.businesses.archivedAt })
      .from(schema.businesses).where(eq(schema.businesses.id, 'b-twice'));

    const again = await archive.archiveBusiness('b-twice');
    assert.equal(again.kind, 'archived');
    const [second] = await db.select({ at: schema.businesses.archivedAt })
      .from(schema.businesses).where(eq(schema.businesses.id, 'b-twice'));
    // The timestamp is what a campaign restore matches on; re-archiving must
    // never move it.
    assert.deepEqual(second?.at, first?.at);
  });

  await check('a campaign cascade stamps ONE timestamp and restores exactly it', async () => {
    await campaign('c2');
    await business('b-a', 'c2');
    await business('b-b', 'c2');
    await business('b-hand', 'c2');

    // Archived by hand BEFORE the campaign: must survive the campaign restore.
    await archive.archiveBusiness('b-hand', 'вручну');

    const archived = await archive.archiveCampaign('c2', 'закрито');
    assert.equal(archived.kind, 'archived');
    assert.equal(archived.kind === 'archived' && archived.archivedBusinesses, 2);

    const stamps = await db.select({ at: schema.businesses.archivedAt })
      .from(schema.businesses).where(eq(schema.businesses.campaignId, 'c2'));
    const cascade = new Set(
      stamps.map((s) => s.at?.toISOString()).filter(Boolean),
    );
    // Two distinct instants: the hand-archived one, and the single cascade.
    assert.equal(cascade.size, 2);

    const restored = await archive.unarchiveCampaign('c2');
    assert.equal(restored.kind === 'unarchived' && restored.restoredBusinesses, 2);
    assert.equal(await isArchived('b-a'), false);
    assert.equal(await isArchived('b-b'), false);
    assert.equal(await isArchived('b-hand'), true, 'a hand-archived business must stay shelved');
  });

  await check('a restored campaign comes back paused, never silently running', async () => {
    const [row] = await db.select({ status: schema.campaigns.status })
      .from(schema.campaigns).where(eq(schema.campaigns.id, 'c2'));
    assert.equal(row?.status, 'paused');
  });

  await check('outreach makes a business undeletable, and bulk delete skips it', async () => {
    await campaign('c3');
    await business('b-contacted', 'c3');
    await business('b-clean', 'c3');
    await db.insert(schema.approvals).values({
      businessId: 'b-contacted', kind: 'outreach', decision: 'approved',
    });

    const single = await archive.deleteBusiness('b-contacted');
    assert.equal(single.kind, 'blocked');

    // A batch aimed at both must delete the clean one and preserve the audit
    // trail of the other — not refuse everything, and not destroy the proof.
    const bulk = await archive.deleteBusinesses(['b-contacted', 'b-clean']);
    assert.equal(bulk.deleted, 1);
    assert.equal(bulk.blocked, 1);

    const [survivor] = await db.select({ id: schema.businesses.id })
      .from(schema.businesses).where(eq(schema.businesses.id, 'b-contacted'));
    assert.ok(survivor, 'a contacted business must survive a bulk delete');
    const [gone] = await db.select({ id: schema.businesses.id })
      .from(schema.businesses).where(eq(schema.businesses.id, 'b-clean'));
    assert.equal(gone, undefined);
  });

  await check('deleting a business leaves no orphaned child rows', async () => {
    await campaign('c4');
    await business('b-full', 'c4');
    await db.insert(schema.statusHistory).values({
      businessId: 'b-full', toStatus: 'discovered', actor: 'test',
    });
    const [source] = await db.insert(schema.businessSources).values({
      businessId: 'b-full',
      sourceType: 'google_maps',
      url: 'https://example.test',
      method: 'gosom_api',
    }).returning({ id: schema.businessSources.id });
    await db.insert(schema.businessFacts).values({
      businessId: 'b-full',
      key: 'k',
      value: 'v',
      sourceId: source!.id,
      extractionMethod: 'deterministic',
    });
    await db.insert(schema.businessContacts).values({
      businessId: 'b-full', channel: 'email', value: 'a@example.test', sourceId: source!.id,
    });

    const deleted = await archive.deleteBusiness('b-full');
    assert.equal(deleted.kind, 'deleted');

    for (const [label, table, column] of [
      ['status_history', schema.statusHistory, schema.statusHistory.businessId],
      ['business_sources', schema.businessSources, schema.businessSources.businessId],
      ['business_facts', schema.businessFacts, schema.businessFacts.businessId],
      ['business_contacts', schema.businessContacts, schema.businessContacts.businessId],
    ] as const) {
      const rows = await db.select().from(table).where(eq(column, 'b-full'));
      assert.equal(rows.length, 0, `${label} left an orphan behind`);
    }
  });

  await check('a campaign with businesses cannot be deleted', async () => {
    await campaign('c5');
    await business('b-blocker', 'c5');
    const blocked = await archive.deleteCampaign('c5');
    assert.equal(blocked.kind, 'blocked');

    await archive.deleteBusinesses(['b-blocker']);
    const ok = await archive.deleteCampaign('c5');
    assert.equal(ok.kind, 'deleted');
  });
});

console.log(`\n${passed} archive service checks passed`);
