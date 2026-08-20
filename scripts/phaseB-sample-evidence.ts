/**
 * Prints the full evidence package for one business: every fact with the source
 * it came from, contacts, assets, the audit and the score breakdown. This is the
 * "show me the proof" view for a production_ready business.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';

const businessId = process.argv[2];
if (!businessId) { console.error('usage: pnpm tsx scripts/phaseB-sample-evidence.ts <businessId>'); process.exit(1); }

const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
if (!biz) { console.error(`no such business: ${businessId}`); process.exit(1); }

const sources = await db.select().from(schema.businessSources).where(eq(schema.businessSources.businessId, businessId));
const facts = await db.select().from(schema.businessFacts).where(eq(schema.businessFacts.businessId, businessId));
const contacts = await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, businessId));
const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));
const gaps = await db.select().from(schema.productionGaps).where(eq(schema.productionGaps.businessId, businessId));
const [audit] = await db.select().from(schema.websiteAudits).where(eq(schema.websiteAudits.businessId, businessId))
  .orderBy(desc(schema.websiteAudits.auditedAt)).limit(1);
const [qual] = await db.select().from(schema.qualifications).where(eq(schema.qualifications.businessId, businessId))
  .orderBy(desc(schema.qualifications.at)).limit(1);

const srcById = new Map(sources.map((s) => [s.id, s]));
const short = (v: unknown, n = 150) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s ?? '').length > n ? `${(s ?? '').slice(0, n)}…` : s ?? '';
};

console.log(`\n=== ${biz.name} (${biz.id})`);
console.log(`status=${biz.status} score=${biz.score} rating=${biz.rating} reviews=${biz.reviewCount}`);
console.log(`category=${biz.category} domain=${biz.domain ?? '(none owned)'}`);

console.log(`\n--- SOURCES (${sources.length}) — the immutable evidence trail`);
for (const s of sources) {
  console.log(`  [${s.id}] ${s.sourceType.padEnd(15)} ${s.method.padEnd(11)} ${s.capturedAt.toISOString().slice(0, 19)}`);
  console.log(`        url: ${short(s.url, 110)}`);
  console.log(`        raw: ${s.rawObjectKey ?? '(none)'}`);
}

console.log(`\n--- FACTS (${facts.length}) — every one carries source_id`);
const byKey = new Map<string, typeof facts>();
for (const f of facts) {
  if (!byKey.has(f.key)) byKey.set(f.key, []);
  byKey.get(f.key)!.push(f);
}
for (const [key, rows] of [...byKey.entries()].sort()) {
  console.log(`  ${key} (${rows.length}, ${rows[0].extractionMethod})`);
  for (const f of rows.slice(0, 4)) {
    const src = f.sourceId ? srcById.get(f.sourceId) : null;
    console.log(`     src=${String(f.sourceId ?? 'NULL').padEnd(5)} conf=${f.confidence} ${short(f.value, 120)}`);
    if (src) console.log(`        └─ from ${src.sourceType} ${short(src.url, 80)}`);
  }
  if (rows.length > 4) console.log(`     … ${rows.length - 4} more`);
}

console.log(`\n--- CONTACTS (${contacts.length})`);
for (const c of contacts) console.log(`  ${c.channel.padEnd(14)} ${c.value.padEnd(46)} src=${c.sourceId ?? 'NULL'} verified=${c.verified}`);

console.log(`\n--- ASSETS (${assetRows.length}) — all private_demo_only, real photography`);
for (const a of assetRows) {
  console.log(`  ${a.intendedUsage.padEnd(8)} ${String(a.width)}x${String(a.height)} ai=${a.aiGenerated} rights=${a.rights}`);
  console.log(`     key: ${a.objectKey}`);
}

console.log(`\n--- WEBSITE AUDIT`);
if (audit) {
  console.log(`  verdict: ${audit.verdict}`);
  console.log(`  best endpoint: ${audit.bestEndpoint ?? '(none reachable)'}`);
  console.log(`  desktop screenshot: ${audit.desktopScreenshotKey ?? '(none)'}`);
  console.log(`  mobile screenshot:  ${audit.mobileScreenshotKey ?? '(none)'}`);
  console.log(`  notes: ${short(audit.notes, 300)}`);
  console.log(`  endpoint matrix:`);
  for (const m of audit.endpointMatrix ?? []) {
    console.log(`     ${m.url.padEnd(34)} status=${String(m.status ?? '-').padEnd(5)} tls=${String(m.tlsOk ?? '-').padEnd(5)} ${m.error ?? ''}`);
  }
} else console.log('  (no audit)');

console.log(`\n--- SCORE + INDEPENDENT QA`);
if (qual) {
  console.log(`  score: ${qual.score}  breakdown: ${JSON.stringify(qual.scoreBreakdown)}`);
  console.log(`  qualified: ${qual.qualified}  reasons: ${JSON.stringify(qual.reasons)}`);
  console.log(`  qa_passed: ${qual.qaPassed}`);
  console.log(`  qa notes: ${short(qual.qaNotes, 700)}`);
} else console.log('  (not scored)');

const open = gaps.filter((g) => !g.resolved);
console.log(`\n--- PRODUCTION GAPS (${open.length} open)`);
for (const g of open) console.log(`  [${g.blockerLevel}] ${g.gap}`);

process.exit(0);
