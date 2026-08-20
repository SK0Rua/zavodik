/**
 * Exercise ONLY the multimodal visual critic against an already-built site.
 *
 * The critic is the half of visual QA that a deterministic test cannot cover, and
 * it is also the half most likely to break silently (a prompt that produces
 * schema-valid but useless output still "passes"). This script makes its actual
 * judgement visible so it can be read and argued with.
 *
 * It goes through `runVisualCritique()`, the same function the pipeline calls, so
 * the critic is exercised with the EXACT payload it receives in production —
 * screenshots, motion frames and the reference stills. Passing a directory of
 * pre-captured PNGs would test a payload nobody ever sends.
 *
 *   pnpm tsx scripts/phaseC-critic-check.ts <out-dir> "<business name>" [category] [reference-slug]
 *
 * `reference-slug` is a directory under `references/motion/`; omit it to see what
 * the critic does with no bar to compare against.
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { serveDir } from '../src/lib/serveDir.js';
import { captureMotionEvidence, runVisualCritique, runDeterministicChecks } from '../src/workers/visualQa.js';
import { WOW_FAIL_THRESHOLD, WOW_MAX, wowVerdict } from '../src/build/motionRefs.js';
import type { BuildSnapshot } from '../src/build/snapshot.js';

const outDir = process.argv[2];
const name = process.argv[3] ?? 'Demo Business';
const category = process.argv[4] ?? 'beauty salon';
const referenceSlug = process.argv[5] ?? null;
if (!outDir) {
  console.error('usage: phaseC-critic-check.ts <out-dir> "<business name>" [category] [reference-slug]');
  process.exit(1);
}

/**
 * The critic never reads the snapshot — it judges pixels — so a minimal stub is
 * enough to drive the deterministic pass that produces the screenshots. This
 * keeps the script DB-free, which is what makes it usable on a stale deploy
 * directory whose business row may no longer exist.
 */
const snapshot = {
  name, category, city: null, language: 'el', languageName: 'Greek (Ελληνικά)',
  contacts: [], assets: [], reviews: [], services: [], sources: [], otherFacts: [], openGaps: [],
} as unknown as BuildSnapshot;

const { url, close } = await serveDir(path.resolve(outDir));
const browser = await chromium.launch({ headless: true });
const t = Date.now();
try {
  console.log(`serving ${outDir} at ${url}`);
  const det = await runDeterministicChecks(browser, url, snapshot);
  console.log(`screenshots: ${det.screenshots.map((s) => s.name).join(', ')}`);

  const motion = await captureMotionEvidence(browser, url);
  console.log(`motion frames: ${motion.frames.length}`);
  console.log(`hero motion detected: ${motion.heroMotionDetected}`);
  console.log(`  entrance  (0.15s -> 1.6s): ${(motion.heroMotionPixelDelta * 100).toFixed(2)}%`);
  console.log(`  sustained (2.4s -> 3.6s):  ${(motion.heroSustainedPixelDelta * 100).toFixed(2)}% `
    + `-> still moving: ${motion.heroSustainedMotion}`);
  console.log(`animation engines in the DOM: ${motion.animationEngines.join(', ') || 'none'}`);
  console.log(`elements with a non-identity transform at rest: ${motion.transformedAtRest}`);
  console.log(`reference: ${referenceSlug ?? '(none supplied)'}\n`);

  const critique = await runVisualCritique({
    business: { name, category, city: null, languageName: 'Greek (Ελληνικά)' },
    designDirection: null,
    referenceSlug,
    screenshots: det.screenshots,
    motion,
  });

  // Same override the pipeline applies: a hero the browser measured as static
  // cannot score above 0, however generous the critic felt.
  const wowScores = { ...critique.wow };
  if (!motion.heroMotionDetected) wowScores.heroMotion = 0;
  const wow = wowVerdict(wowScores);

  console.log(`=== critique in ${Math.round((Date.now() - t) / 1000)}s ===`);
  console.log(`critic approved: ${critique.approved}`);
  console.log(`§2.4 rubric: ${JSON.stringify(critique.rubric)}`);
  console.log(`\nWOW ${wow.total}/${WOW_MAX} (floor ${WOW_FAIL_THRESHOLD}) — ${wow.passed ? 'PASS' : 'FAIL'}`);
  for (const [axis, v] of Object.entries(wowScores)) console.log(`  ${axis}: ${v}/3`);
  for (const r of wow.reasons) console.log(`  ! ${r}`);
  console.log(`\nvs reference "${critique.referenceComparison.slug}": closeness ${critique.referenceComparison.closeness}/10`);
  console.log(`  gap: ${critique.referenceComparison.gap}`);
  console.log(`\nstrengths:`);
  for (const s of critique.strengths) console.log(`  + ${s}`);
  console.log(`\nissues (${critique.issues.length}):`);
  for (const i of critique.issues) {
    console.log(`  [${i.severity}/${i.category} @ ${i.viewport}]`);
    console.log(`     ${i.issue}`);
    console.log(`     fix: ${i.fix}`);
  }
} finally {
  await browser.close();
  close();
}
