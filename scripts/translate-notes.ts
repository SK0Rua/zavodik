/**
 * Backfill: Ukrainian renderings of the notes agents already wrote.
 *
 *   pnpm tsx scripts/translate-notes.ts [--campaign <id>] [--dry-run] [--limit N]
 *
 * From 2026-08-20 the enrichment and scoring workers translate their own free
 * text as they write it (`src/lib/translateNotes.ts`). This fills in the rows
 * that predate that: on the Patras campaign, 156 soft gaps — most of them Greek,
 * because the enrichment agent is instructed to stay in the language of the
 * evidence — and 19 critic reports in English.
 *
 * Idempotent by null-check: a row that already has `gap_uk` / `qa_notes_uk` is
 * skipped, so running this twice costs nothing and running it against a campaign
 * that is still enriching is safe (the rows written after it started simply get
 * their translation from the worker instead).
 *
 * This translates text that already exists in the database. It enqueues no jobs
 * and starts no builds.
 */
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, schema, pool } from '../src/db/client.js';
import { translateToUkrainian, translateQaNotes } from '../src/lib/translateNotes.js';

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const campaignId = flag('campaign');
const dryRun = args.includes('--dry-run');
const limit = Number(flag('limit') ?? '0') || null;

/** Business ids in scope, or null for "every business". */
async function scopeBusinessIds(): Promise<string[] | null> {
  if (!campaignId) return null;
  const rows = await db.select({ id: schema.businesses.id }).from(schema.businesses)
    .where(eq(schema.businesses.campaignId, campaignId));
  if (rows.length === 0) throw new Error(`campaign has no businesses (or does not exist): ${campaignId}`);
  return rows.map((r) => r.id);
}

async function backfillGaps(ids: string[] | null): Promise<{ scanned: number; translated: number }> {
  const where = ids
    ? and(isNull(schema.productionGaps.gapUk), inArray(schema.productionGaps.businessId, ids))
    : isNull(schema.productionGaps.gapUk);
  const rows = await db.select().from(schema.productionGaps).where(where);

  // Hard gaps are gate KEYS with a code-side Ukrainian name in the UI; they have
  // nothing to translate and must not be sent to a model.
  const soft = rows.filter((r) => r.blockerLevel !== 'hard');
  const scoped = limit ? soft.slice(0, limit) : soft;
  if (scoped.length === 0) return { scanned: 0, translated: 0 };

  // Batched PER BUSINESS: the context line ("gaps for <name>, a hair salon") is
  // what lets the model read «λέιζερ» as a treatment rather than a noun, and one
  // business's context must never be applied to another's notes.
  const byBusiness = new Map<string, typeof scoped>();
  for (const row of scoped) {
    const list = byBusiness.get(row.businessId) ?? [];
    list.push(row);
    byBusiness.set(row.businessId, list);
  }

  let translated = 0;
  for (const [businessId, group] of byBusiness) {
    const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
    const context = `evidence gaps for "${biz?.name ?? businessId}", a ${biz?.category ?? 'local business'}`;
    const uk = await translateToUkrainian(group.map((g) => g.gap), context);
    for (const [i, row] of group.entries()) {
      const value = uk[i];
      if (!value) continue;
      translated++;
      console.log(`  gap#${row.id} ${biz?.name ?? businessId}\n    ${row.gap.slice(0, 90)}\n    → ${value.slice(0, 90)}`);
      if (!dryRun) {
        await db.update(schema.productionGaps).set({ gapUk: value })
          .where(eq(schema.productionGaps.id, row.id));
      }
    }
  }
  return { scanned: scoped.length, translated };
}

async function backfillQaNotes(ids: string[] | null): Promise<{ scanned: number; translated: number }> {
  const where = ids
    ? and(isNull(schema.qualifications.qaNotesUk), inArray(schema.qualifications.businessId, ids))
    : isNull(schema.qualifications.qaNotesUk);
  const rows = (await db.select().from(schema.qualifications).where(where))
    .filter((r) => r.qaNotes && r.qaNotes.trim());
  const scoped = limit ? rows.slice(0, limit) : rows;

  let translated = 0;
  for (const row of scoped) {
    const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, row.businessId));
    const uk = await translateQaNotes(
      row.qaNotes,
      `fact-check findings about "${biz?.name ?? row.businessId}", a ${biz?.category ?? 'local business'}`,
    );
    if (!uk) continue;
    translated++;
    console.log(`  qa#${row.id} ${biz?.name ?? row.businessId}\n    → ${uk.slice(0, 140)}`);
    if (!dryRun) {
      await db.update(schema.qualifications).set({ qaNotesUk: uk })
        .where(eq(schema.qualifications.id, row.id));
    }
  }
  return { scanned: scoped.length, translated };
}

const ids = await scopeBusinessIds();
console.log(
  `translate-notes: scope=${campaignId ?? 'ALL'}`
  + `${ids ? ` (${ids.length} businesses)` : ''}${dryRun ? ' [dry-run]' : ''}`,
);

console.log('\nsoft gaps:');
const gaps = await backfillGaps(ids);
console.log(`  ${gaps.translated}/${gaps.scanned} translated`);

console.log('\ncritic notes:');
const qa = await backfillQaNotes(ids);
console.log(`  ${qa.translated}/${qa.scanned} translated`);

console.log(
  `\ndone: ${gaps.translated} gaps + ${qa.translated} critic reports`
  + `${dryRun ? ' (nothing written — dry run)' : ' written'}`,
);
await pool.end();
