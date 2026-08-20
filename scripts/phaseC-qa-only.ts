/**
 * Run ONLY the deterministic half of visual QA against an already-built site.
 * No agent, no DB writes — useful for iterating on the checks themselves and for
 * inspecting a workspace the pipeline left behind.
 *
 *   pnpm tsx scripts/phaseC-qa-only.ts <path-to-out-dir> <businessId> [--shots <dir>]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { pool } from '../src/db/client.js';
import { buildSnapshot } from '../src/build/snapshot.js';
import { checkProvenance } from '../src/build/provenance.js';
import { serveDir } from '../src/lib/serveDir.js';
import { captureMotionEvidence, runDeterministicChecks } from '../src/workers/visualQa.js';

const outDir = process.argv[2];
const businessId = process.argv[3];
if (!outDir || !businessId) {
  console.error('usage: phaseC-qa-only.ts <out-dir> <businessId> [--shots <dir>]');
  process.exit(1);
}
const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx >= 0 ? process.argv[shotsIdx + 1] : undefined;

const snapshot = await buildSnapshot(businessId);
console.log(`snapshot: ${snapshot.name}, ${snapshot.contacts.length} contacts, ${snapshot.assets.length} assets`);

const prov = await checkProvenance(path.resolve(outDir), snapshot);
console.log(`\nprovenance: ok=${prov.ok} findings=${prov.findings.length}`);
for (const f of prov.findings) console.log(`  [${f.severity}] ${f.kind} (${f.file}): ${f.detail.slice(0, 180)}`);
console.log(`contacts on page: ${prov.contactsPresent.join(', ') || 'NONE'}`);

const { url, close } = await serveDir(path.resolve(outDir));
const browser = await chromium.launch({ headless: true });
try {
  const det = await runDeterministicChecks(browser, url, snapshot);
  console.log(`\ndeterministic checks: ${det.issues.length} issue(s)`);
  for (const i of det.issues) {
    console.log(`  [${i.severity}/${i.category} @ ${i.viewport}] ${i.issue}`);
    console.log(`     fix: ${i.fix.slice(0, 160)}`);
  }
  console.log('\nmetrics:', JSON.stringify(det.metrics, null, 2));

  // Motion evidence is deterministic too: the hero-motion verdict comes from a
  // pixel diff, not from a model, so it belongs in the no-agent script.
  const motion = await captureMotionEvidence(browser, url);
  console.log(`\nmotion: ${motion.frames.length} frames`);
  console.log(`  hero motion detected: ${motion.heroMotionDetected}`);
  console.log(`    entrance  (0.15s -> 1.6s): ${(motion.heroMotionPixelDelta * 100).toFixed(2)}% of pixels changed`);
  console.log(`    sustained (2.4s -> 3.6s):  ${(motion.heroSustainedPixelDelta * 100).toFixed(2)}% of pixels changed `
    + `-> still moving: ${motion.heroSustainedMotion}`);
  console.log(`  animation engines: ${motion.animationEngines.join(', ') || 'none'}`);
  console.log(`  elements transformed at rest: ${motion.transformedAtRest}`);

  if (shotsDir) {
    await mkdir(shotsDir, { recursive: true });
    for (const s of [...det.screenshots, ...motion.frames]) {
      const f = path.join(shotsDir, `${s.name}.png`);
      await writeFile(f, s.buf);
      console.log(`screenshot: ${f} (${Math.round(s.buf.length / 1024)} KB)`);
    }
  }
} finally {
  await browser.close();
  close();
  await pool.end();
}
