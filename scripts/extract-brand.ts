/**
 * Runs brand identity extraction for one or more businesses and prints what was
 * measured, with the source behind every value.
 *
 *   pnpm tsx scripts/extract-brand.ts <businessId> [<businessId>...]
 *   pnpm tsx scripts/extract-brand.ts --dry-run <businessId>
 *   pnpm tsx scripts/extract-brand.ts --no-voice <businessId>
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { extractBrandIdentity } from '../src/enrichment/brandIdentity.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipVoice = args.includes('--no-voice');
  const ids = args.filter((a) => !a.startsWith('--'));
  if (ids.length === 0) {
    console.error('usage: pnpm tsx scripts/extract-brand.ts [--dry-run] [--no-voice] <businessId>...');
    process.exit(1);
  }

  const rows = await db.select().from(schema.businesses).where(inArray(schema.businesses.id, ids));
  for (const id of ids) {
    const biz = rows.find((b) => b.id === id);
    console.log(`\n${'═'.repeat(78)}\n${biz?.name ?? '(unknown)'}  [${id}]  status=${biz?.status ?? '?'}`);
    const started = Date.now();
    // `preserveVoice` so `--no-voice` refreshes colours without deleting a
    // classification an earlier run already paid a subscription call for.
    const brand = await extractBrandIdentity(id, { dryRun, skipVoice, preserveVoice: skipVoice });
    const sources = await db.select().from(schema.businessSources)
      .where(eq(schema.businessSources.businessId, id));
    const srcLabel = (sid: number | undefined | null) => {
      const s = sources.find((x) => x.id === sid);
      return s ? `#${s.id} ${s.sourceType} ${s.url.slice(0, 64)}` : `#${sid ?? '—'}`;
    };

    console.log(`  palette source : ${brand.paletteSource}   (${Math.round((Date.now() - started) / 1000)}s)`);
    console.log(`  primary        : ${brand.primary?.hex ?? '—'}   ${brand.primary ? `from ${brand.primary.from}` : ''}`);
    if (brand.primary) console.log(`                   source ${srcLabel(brand.primary.sourceId)}`);
    console.log(`  accent         : ${brand.accent?.hex ?? '—'}   onLight ${brand.accentOnLight ?? '—'}  onDark ${brand.accentOnDark ?? '—'}`);
    if (brand.accent) console.log(`                   source ${srcLabel(brand.accent.sourceId)}`);
    for (const [label, pal] of [
      ['logo   ', brand.logoColors], ['avatar ', brand.avatarColors],
      ['site   ', brand.siteColors], ['photos ', brand.photoColors],
    ] as const) {
      if (!pal) continue;
      console.log(`  ${label}palette: ${pal.colors.map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}%`).join('  ')}`);
      console.log(`                   ${pal.from} · source ${srcLabel(pal.sourceId)}`);
    }
    if (brand.fontsSeen) {
      console.log(`  fonts seen     : ${brand.fontsSeen.fonts.join(', ')}`);
      console.log(`                   source ${srcLabel(brand.fontsSeen.sourceId)}`);
    }
    if (brand.voice) {
      console.log(`  voice          : ${brand.voice.tone} / ${brand.voice.formality}`);
      console.log(`    self-described: ${brand.voice.selfDescribedAs.join(' | ') || '—'}`);
      console.log(`    brand elements: ${brand.voice.statedBrandElements.join(' | ') || '—'}`);
      console.log(`    reasoning     : ${brand.voice.reasoning.slice(0, 220)}`);
      console.log(`                   source ${srcLabel(brand.voice.sourceId)}`);
    }
    if (brand.gap) console.log(`  GAP            : ${brand.gap}`);
    for (const n of brand.notes) console.log(`  note           : ${n}`);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
