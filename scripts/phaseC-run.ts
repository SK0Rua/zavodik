/**
 * Phase C stage runner — drives one business through stages 9-12 by calling the
 * handlers directly, in order, with the same payloads the queue would deliver.
 *
 * Used for the acceptance run (and for the fixture rehearsal) because it gives a
 * readable, resumable transcript: each stage prints its own timing and the DB
 * state it produced, and a crash leaves the workspace intact for inspection.
 *
 *   pnpm tsx scripts/phaseC-run.ts <businessId> [--stage 9|10|11|12] [--all]
 *   pnpm tsx scripts/phaseC-run.ts <businessId> --all --max-iterations 3
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema, pool } from '../src/db/client.js';
import { config } from '../src/config.js';
import { contentDesignHandler } from '../src/workers/contentDesign.js';
import { buildSiteHandler } from '../src/workers/builder.js';
import { visualQaHandler } from '../src/workers/visualQa.js';
import { deployHandler } from '../src/workers/deploy.js';
import { ensureDemoServer } from '../src/lib/serveDir.js';
import { checkProvenance } from '../src/build/provenance.js';
import { getObject } from '../src/lib/storage.js';
import { outputDir } from '../src/build/workspace.js';

const argv = process.argv.slice(2);
const businessId = argv.find((a) => !a.startsWith('--'));
if (!businessId) {
  console.error('usage: phaseC-run.ts <businessId> [--stage N] [--all]');
  process.exit(1);
}
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = flag('stage');
const all = argv.includes('--all');
const maxIterations = Number(flag('max-iterations') ?? config.maxQaIterations);

function stamp(): string { return new Date().toISOString().slice(11, 19); }
function banner(text: string): void { console.log(`\n${'─'.repeat(72)}\n${stamp()}  ${text}\n${'─'.repeat(72)}`); }

async function currentProject() {
  const [p] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.businessId, businessId!))
    .orderBy(desc(schema.siteProjects.id)).limit(1);
  return p;
}

const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
if (!biz) { console.error(`business not found: ${businessId}`); process.exit(1); }
console.log(`business: ${biz.name} (${biz.id}) status=${biz.status} campaign=${biz.campaignId}`);

/**
 * Each handler ENQUEUES the next stage as well as returning. If a worker process
 * (`pnpm workers` / `pnpm all`) is running, it will pick that job up and run the
 * next stage concurrently with this script — two builder agents in one workspace.
 * Warn loudly rather than racing silently.
 */
{
  const active = await db.select().from(schema.workflowJobs)
    .where(eq(schema.workflowJobs.businessId, businessId));
  const running = active.filter((j) => j.status === 'running' || j.status === 'queued');
  if (running.length) {
    console.warn(
      `\n⚠️  ${running.length} job(s) already queued/running for this business ` +
      `(${running.map((j) => `${j.jobType}:${j.status}`).join(', ')}).\n` +
      '   A worker process is draining the queue, so stages may run there instead of here.\n' +
      '   Stop `pnpm workers` / `pnpm all` before using this runner to drive stages directly.\n');
  }
}

const timings: Record<string, number> = {};
const t0 = Date.now();

// ── stage 9 ───────────────────────────────────────────────────────────────
if (all || only === '9') {
  banner('STAGE 9 — content brief + 3 art directions + rubric');
  const t = Date.now();
  await contentDesignHandler({ businessId, campaignId: biz.campaignId });
  timings.stage9 = Math.round((Date.now() - t) / 1000);
  const p = await currentProject();
  console.log(`→ project ${p!.id}: direction="${p!.designDirection}" score=${p!.designScore}`);
  console.log(`→ keys: snapshot=${p!.snapshotKey} brief=${p!.contentBriefKey} design=${p!.designContractKey}`);
  console.log(`→ ${timings.stage9}s`);
}

// ── stages 10 + 11 (the loop) ─────────────────────────────────────────────
// `--stage 11` deliberately does NOT rebuild: it QAs the export that is already
// in the workspace. Rebuilding would wipe the very artefact you asked to inspect.
const runBuild = all || only === '10';
const runQa = all || only === '10' || only === '11';
if (runQa) {
  const project = await currentProject();
  if (!project) { console.error('no site project; run stage 9 first'); process.exit(1); }

  let iteration = project.qaIterations ?? 0;
  for (; iteration < maxIterations; iteration++) {
    const p = await currentProject();
    if (p!.state === 'ready' || p!.state === 'deployed') break;
    if (p!.state === 'needs_human_review') { console.log('project needs human review; stopping'); break; }

    if (runBuild) {
      banner(`STAGE 10 — build (iteration ${iteration})`);
      const tb = Date.now();
      await buildSiteHandler({ businessId, campaignId: biz.campaignId, projectId: project.id, iteration });
      const buildSec = Math.round((Date.now() - tb) / 1000);
      timings[`build_${iteration}`] = buildSec;
      console.log(`→ build ${iteration} done in ${buildSec}s`);
    } else {
      banner(`STAGE 10 — skipped (--stage 11: QA the existing export)`);
    }

    // Recompute the provenance findings the queue payload would have carried.
    const after = await currentProject();
    const snapshot = JSON.parse((await getObject('raw', after!.snapshotKey!)).toString());
    const prov = await checkProvenance(outputDir(after!.dir), snapshot);
    const provIssues = prov.findings.filter((f) => f.severity === 'high')
      .map((f) => `provenance [${f.kind}] in ${f.file}: ${f.detail}`);
    console.log(`→ provenance: ok=${prov.ok} findings=${prov.findings.length} high=${provIssues.length} contacts=${prov.contactsPresent.join(', ') || 'none'}`);
    for (const f of prov.findings) console.log(`   · [${f.severity}] ${f.kind}: ${f.detail.slice(0, 160)}`);

    banner(`STAGE 11 — visual QA (iteration ${iteration})`);
    const tq = Date.now();
    try {
      await visualQaHandler({
        businessId, campaignId: biz.campaignId, projectId: project.id, iteration,
        provenanceIssues: provIssues, provenanceFindings: prov.findings,
      });
    } catch (err: any) {
      if (err?.code === 'NEEDS_HUMAN') { console.log(`→ ${err.message}`); break; }
      throw err;
    }
    timings[`qa_${iteration}`] = Math.round((Date.now() - tq) / 1000);
    const afterQa = await currentProject();
    const open = (afterQa!.openIssues ?? []);
    console.log(`→ QA ${iteration} done in ${timings[`qa_${iteration}`]}s; state=${afterQa!.state}; issues=${open.length}`);
    for (const i of open.slice(0, 12)) console.log(`   · ${i.slice(0, 170)}`);
    if (afterQa!.state === 'ready') break;
  }
}

// ── stage 12 ──────────────────────────────────────────────────────────────
if (all || only === '12') {
  const project = await currentProject();
  if (project && (project.state === 'ready' || project.state === 'deployed')) {
    banner('STAGE 12 — private deploy');
    const t = Date.now();
    await ensureDemoServer();
    await deployHandler({ businessId, campaignId: biz.campaignId, projectId: project.id });
    timings.stage12 = Math.round((Date.now() - t) / 1000);
    const p = await currentProject();
    console.log(`→ ${p!.deployUrl}  (${timings.stage12}s)`);
  } else {
    console.log(`skipping deploy: project state=${project?.state ?? 'none'}`);
  }
}

// ── summary ───────────────────────────────────────────────────────────────
const final = await currentProject();
const [finalBiz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
banner('SUMMARY');
console.log(JSON.stringify({
  business: { id: finalBiz!.id, name: finalBiz!.name, status: finalBiz!.status },
  project: final && {
    id: final.id, state: final.state, dir: final.dir,
    designDirection: final.designDirection, designScore: final.designScore,
    buildOk: final.buildOk, buildSeconds: final.buildSeconds,
    qaIterations: final.qaIterations, qaReportKeys: final.qaReportKeys,
    screenshotKeys: final.screenshotKeys,
    openIssues: final.openIssues, deployUrl: final.deployUrl,
  },
  timings: { ...timings, totalSeconds: Math.round((Date.now() - t0) / 1000) },
}, null, 2));

await pool.end();
