/**
 * Runs stage 9 for one business and prints the design contract, WITHOUT
 * enqueueing the build.
 *
 * `contentDesignHandler` finishes by enqueueing `build-site`, which a running
 * `factory-build` container would pick up immediately — a 40-minute agent
 * session nobody asked for. This script reproduces stage 9's three calls and
 * the deterministic choice, then stops, so the brand grounding can be inspected
 * on its own.
 *
 *   pnpm tsx scripts/test-stage9-brand.ts <businessId>
 */
import { eq } from 'drizzle-orm';
import { db, schema, pool } from '../src/db/client.js';
import { buildSnapshot } from '../src/build/snapshot.js';
import { brandNeglect, brandPaletteHexes, chooseDirection } from '../src/build/rubric.js';
import { runStage9Calls } from '../src/workers/contentDesign.js';

async function main(): Promise<void> {
  const businessId = process.argv[2];
  if (!businessId) {
    console.error('usage: pnpm tsx scripts/test-stage9-brand.ts <businessId>');
    process.exit(1);
  }
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) { console.error(`business not found: ${businessId}`); process.exit(1); }

  const snapshot = await buildSnapshot(businessId);
  console.log(`\nbusiness: ${biz.name}`);
  console.log(`brand measured from: ${snapshot.brand.paletteSource}`);
  console.log(`  primary ${snapshot.brand.primary?.hex ?? '—'}  accent ${snapshot.brand.accent?.hex ?? '—'}`);
  console.log(`  voice   ${snapshot.brand.voice ? `${snapshot.brand.voice.tone} / ${snapshot.brand.voice.formality}` : '—'}`);
  console.log(`  hexes the rubric will check against: ${brandPaletteHexes(snapshot).join(', ') || '(none)'}`);

  const { brief, directions, critique, siblings, motionSlugs } = await runStage9Calls(businessId, snapshot);

  console.log(`\nsiblings in campaign shown to the art director: ${siblings.length}`);
  for (const s of siblings) console.log(`  - ${s.business}: ${s.direction} · ${s.palette ?? 'palette unknown'}`);

  console.log(`\nbrief: ${brief.sections.length} sections, tone "${brief.toneOfVoice}"`);

  console.log('\n── the three directions ─────────────────────────────────────────');
  for (const d of directions.directions) {
    const sc = critique.scores.find((x) => x.name.trim().toLowerCase() === d.name.trim().toLowerCase());
    console.log(`\n"${d.name}"`);
    console.log(`  palette      : bg ${d.palette.background}  fg ${d.palette.foreground}  accent ${d.palette.accent}`);
    console.log(`  paletteSource: ${d.palette.paletteSource}`);
    console.log(`  brandAlignment: ${d.palette.brandAlignment}`);
    console.log(`  derivedFrom  : ${d.palette.derivedFrom}`);
    console.log(`  typography   : ${d.typography.displayFont} + ${d.typography.bodyFont}`);
    console.log(`  reference    : ${d.referenceSlug}   hero ${d.heroMotion}`);
    console.log(`  brandFit     : ${sc?.brandFit ?? '—'}/10`);
    const neglect = brandNeglect(d, snapshot);
    if (neglect) console.log(`  NEGLECT      : ${neglect}`);
  }

  const verdict = chooseDirection(directions.directions, critique.scores, snapshot, motionSlugs);
  console.log('\n── the deterministic choice ─────────────────────────────────────');
  console.log(`chosen: "${verdict.chosen.name}" (${verdict.chosenScore.toFixed(2)})`);
  for (const r of verdict.ranking) {
    console.log(`  ${r.name.padEnd(34)} ${r.score.toFixed(2)}  brandFit=${r.breakdown.brandFit ?? '—'}  brandNeglect=${r.breakdown.brandNeglectPenalty ?? 0}`);
  }
  console.log(`\nrationale:\n  ${verdict.rationale.replace(/\. /g, '.\n  ')}`);
  console.log('\n(no build enqueued)');
  await pool.end();
}

main().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1); });
