/**
 * The audit's contradiction check never fired on the real campaign, which is
 * the right outcome (enrichment and audit agreed everywhere) but leaves the
 * branch unproven. This drives it directly against a synthetic business.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { auditHandler } from '../src/workers/audit.js';
import { ensureBuckets } from '../src/lib/storage.js';

const CAMPAIGN = 'contradiction-test';
const BIZ = 'gr-test-contradiction-salon';
let pass = 0, fail = 0;
const t = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`, extra ?? ''); }
};

await ensureBuckets();

// clean slate
await db.delete(schema.websiteAudits).where(eq(schema.websiteAudits.businessId, BIZ));
await db.delete(schema.businessFacts).where(eq(schema.businessFacts.businessId, BIZ));
await db.delete(schema.businessContacts).where(eq(schema.businessContacts.businessId, BIZ));
await db.delete(schema.statusHistory).where(eq(schema.statusHistory.businessId, BIZ));
await db.delete(schema.businessSources).where(eq(schema.businessSources.businessId, BIZ));
await db.delete(schema.businesses).where(eq(schema.businesses.id, BIZ));
await db.delete(schema.campaigns).where(eq(schema.campaigns.id, CAMPAIGN));

await db.insert(schema.campaigns).values({
  id: CAMPAIGN, country: 'gr', city: 'Testville', niche: 'beauty',
  queries: ['test'], geofence: { lat: 38.24, lng: 21.73, radiusKm: 5 },
});
await db.insert(schema.businesses).values({
  id: BIZ, campaignId: CAMPAIGN, name: 'Contradiction Salon', normalizedName: 'contradiction salon',
  // no owned domain -> the audit must land on no_website ...
  domain: null, websiteUrl: null, status: 'enriching', businessStatus: 'OPERATIONAL',
});
// ... while enrichment claims it captured an owned website
const [src] = await db.insert(schema.businessSources).values({
  businessId: BIZ, sourceType: 'owned_website', url: 'https://claimed-site.example',
  method: 'playwright', rawObjectKey: null,
}).returning();
await db.insert(schema.businessFacts).values({
  businessId: BIZ, key: 'service', value: { name: 'Haircut', price: null },
  sourceId: src.id, extractionMethod: 'llm_structured', confidence: 0.8, verified: true,
});

await auditHandler({ businessId: BIZ, campaignId: CAMPAIGN });

const [audit] = await db.select().from(schema.websiteAudits).where(eq(schema.websiteAudits.businessId, BIZ));
const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, BIZ));

t('audit row written', !!audit);
t(`verdict is no_website (got ${audit?.verdict})`, audit?.verdict === 'no_website');
t('CONTRADICTION recorded in notes', (audit?.notes ?? '').includes('CONTRADICTION'), audit?.notes);
t('business moved to needs_review', biz?.status === 'needs_review', biz?.status);
t('reason explains the contradiction', (biz?.statusReason ?? '').includes('contradiction'), biz?.statusReason);

// cleanup
await db.delete(schema.websiteAudits).where(eq(schema.websiteAudits.businessId, BIZ));
await db.delete(schema.businessFacts).where(eq(schema.businessFacts.businessId, BIZ));
await db.delete(schema.statusHistory).where(eq(schema.statusHistory.businessId, BIZ));
await db.delete(schema.businessSources).where(eq(schema.businessSources.businessId, BIZ));
await db.delete(schema.businesses).where(eq(schema.businesses.id, BIZ));
await db.delete(schema.campaigns).where(eq(schema.campaigns.id, CAMPAIGN));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
