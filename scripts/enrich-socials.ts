/**
 * Runs ONLY the social discovery step of enrichment for existing businesses.
 *
 * Why a separate script: the 32 Patras businesses are already enriched, several
 * are production_ready or building. Re-running the full enrichment would delete
 * and rebuild their facts and could move their status. This adds sources and
 * contacts and nothing else — no status transition, no deletion.
 *
 *   pnpm tsx scripts/enrich-socials.ts --business gr-patras-exte-hair-design
 *   pnpm tsx scripts/enrich-socials.ts --all-missing --campaign gr-patras-beauty
 *   pnpm tsx scripts/enrich-socials.ts --business <id> --dry-run   # score only, write nothing
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { ensureBuckets } from '../src/lib/storage.js';
import { config } from '../src/config.js';
import { launchBrowser } from '../src/enrichment/capture.js';
import {
  discoverSocials, existingSocialPlatforms, type SocialTargetBusiness,
} from '../src/enrichment/socialDiscovery.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
}
const has = (name: string) => process.argv.includes(`--${name}`);

const businessId = arg('business');
const allMissing = has('all-missing');
const campaignId = arg('campaign') ?? 'gr-patras-beauty';
const dryRun = has('dry-run');
const limit = Number(arg('limit') ?? 0);

if (!businessId && !allMissing) {
  console.error('usage: enrich-socials.ts --business <id> | --all-missing [--campaign <id>] [--limit N] [--dry-run]');
  process.exit(2);
}

await ensureBuckets();

/**
 * Businesses lacking a social contact. "Missing" means no instagram/facebook
 * contact at all — an unverified candidate from a previous run still counts as
 * found, so repeated runs do not re-search the same businesses.
 */
async function selectTargets(): Promise<SocialTargetBusiness[]> {
  if (businessId) {
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
    if (!b) { console.error(`business not found: ${businessId}`); process.exit(2); }
    return [toTarget(b)];
  }
  const rows = (await db.execute(sql`
    select b.* from businesses b
    where b.campaign_id = ${campaignId}
      and not exists (
        select 1 from business_contacts c
        where c.business_id = b.id and c.channel in ('instagram','facebook')
      )
    order by b.id`) as unknown as { rows: Array<Record<string, unknown>> }).rows;
  const mapped = rows.map((r) => toTarget({
    id: String(r.id), name: String(r.name), address: r.address as string | null,
    phone: r.phone as string | null, normalizedPhone: r.normalized_phone as string | null,
    domain: r.domain as string | null, websiteUrl: r.website_url as string | null,
    category: r.category as string | null, campaignId: String(r.campaign_id),
  } as never));
  return limit > 0 ? mapped.slice(0, limit) : mapped;
}

function toTarget(b: {
  id: string; name: string; address: string | null; phone: string | null;
  normalizedPhone: string | null; domain: string | null; websiteUrl: string | null;
  category: string | null; campaignId: string;
}): SocialTargetBusiness {
  return {
    id: b.id, name: b.name, city: 'Patras',
    phone: b.phone, normalizedPhone: b.normalizedPhone, address: b.address,
    domain: b.domain, websiteUrl: b.websiteUrl, category: b.category,
  };
}

// City comes from the campaign, not a hardcode — the matcher uses it for the
// "profile mentions the city" signal.
const cityByCampaign = new Map<string, string>();
for (const c of await db.select().from(schema.campaigns)) cityByCampaign.set(c.id, c.city);

const targets = await selectTargets();
console.log(`social discovery for ${targets.length} business(es)${dryRun ? ' [DRY RUN — nothing is written]' : ''}`);
console.log(`config: maxCandidates=${config.socialDiscovery.maxCandidates} delay=${config.socialDiscovery.delayMs}ms timeout=${config.socialDiscovery.timeoutMs}ms\n`);

const browser = await launchBrowser();
const summary: Array<{ id: string; candidates: number; strong: number; medium: number; weak: number; written: number; gap: string | null }> = [];

try {
  for (const t of targets) {
    const [row] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, t.id));
    const city = cityByCampaign.get(row?.campaignId ?? '') ?? t.city;
    const skip = await existingSocialPlatforms(t.id);
    console.log(`── ${t.id} — ${t.name}`);
    if (skip.length) console.log(`   already has verified: ${skip.join(', ')}`);

    const res = await discoverSocials({ ...t, city }, { browser, skipPlatforms: skip, dryRun });

    const strong = res.profiles.filter((p) => p.verdict.strength === 'strong');
    const medium = res.profiles.filter((p) => p.verdict.strength === 'medium');
    const weak = res.profiles.filter((p) => p.verdict.strength === 'weak');
    console.log(`   SERPs: ${res.serpsCaptured} captured, ${res.serpsFailed} failed | candidates: ${res.candidates.length} | profiles read: ${res.profiles.length}`);
    for (const p of res.profiles) {
      console.log(`   [${p.verdict.strength.toUpperCase()} ${p.verdict.score}] ${p.platform} ${p.url}`);
      console.log(`      title: ${p.title.slice(0, 110)}`);
      if (p.bio) console.log(`      bio:   ${p.bio.replace(/\s+/g, ' ').slice(0, 160)}`);
      console.log(`      signals: ${p.verdict.signals.join('; ') || '(none)'}`);
      if (p.verdict.blockers.length) console.log(`      blockers: ${p.verdict.blockers.join('; ')}`);
      if (p.rawObjectKey) console.log(`      evidence: source_id=${p.sourceId} key=${p.rawObjectKey}`);
      for (const m of p.messengers) console.log(`      messenger: ${m.channel} ${m.value}`);
    }
    if (res.contactsWritten.length) {
      console.log(`   CONTACTS WRITTEN: ${res.contactsWritten.map((c) => `${c.channel}=${c.value} (verified=${c.verified})`).join(', ')}`);
    }
    if (res.gap) {
      console.log(`   GAP: ${res.gap}`);
      if (!dryRun) {
        // Only one open gap of this kind per business.
        const open = await db.select().from(schema.productionGaps).where(and(
          eq(schema.productionGaps.businessId, t.id),
          eq(schema.productionGaps.gap, res.gap),
          eq(schema.productionGaps.resolved, false),
        ));
        if (open.length === 0) {
          await db.insert(schema.productionGaps).values({ businessId: t.id, gap: res.gap, blockerLevel: 'soft' });
        }
      }
    } else if (!dryRun) {
      // A previously recorded gap is resolved once socials are found.
      await db.update(schema.productionGaps).set({ resolved: true }).where(and(
        eq(schema.productionGaps.businessId, t.id),
        eq(schema.productionGaps.gap, 'socials_unresolved'),
        eq(schema.productionGaps.resolved, false),
      ));
    }
    for (const n of res.notes) console.log(`   note: ${n}`);
    console.log('');

    summary.push({
      id: t.id, candidates: res.candidates.length,
      strong: strong.length, medium: medium.length, weak: weak.length,
      written: res.contactsWritten.length, gap: res.gap,
    });
  }
} finally {
  await browser.close().catch(() => {});
}

console.log('\n=== SUMMARY ===');
console.log('business'.padEnd(56), 'cand', 'strong', 'med', 'weak', 'written', 'gap');
for (const s of summary) {
  console.log(
    s.id.padEnd(56),
    String(s.candidates).padEnd(4), String(s.strong).padEnd(6), String(s.medium).padEnd(3),
    String(s.weak).padEnd(4), String(s.written).padEnd(7), s.gap ?? '-',
  );
}
const totals = summary.reduce((a, s) => ({
  strong: a.strong + s.strong, medium: a.medium + s.medium, written: a.written + s.written,
  gaps: a.gaps + (s.gap ? 1 : 0),
}), { strong: 0, medium: 0, written: 0, gaps: 0 });
console.log(`\ntotals: strong=${totals.strong} medium=${totals.medium} contacts_written=${totals.written} gaps=${totals.gaps}`);
process.exit(0);
