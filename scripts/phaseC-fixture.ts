/**
 * Phase C mechanics rehearsal on an HONEST synthetic business.
 *
 * Creates campaign `phaseC-fixture` with one business whose evidence package is
 * small but real in shape: real source rows, real facts with source ids, real
 * image files as assets. Nothing here is presented as a genuine Patras business —
 * the id is prefixed `gr-fixture-` and `--clean` removes every trace.
 *
 * Purpose: shake out the plumbing (workspace prep, agent session, independent
 * build verification, provenance grep, QA loop, deploy + health check) without
 * waiting for phase B, and without burning a real business on a bug.
 *
 *   pnpm tsx scripts/phaseC-fixture.ts --seed     # create the fixture
 *   pnpm tsx scripts/phaseC-fixture.ts --run      # seed + full chain
 *   pnpm tsx scripts/phaseC-fixture.ts --clean    # remove everything
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { eq } from 'drizzle-orm';
import { db, schema, pool } from '../src/db/client.js';
import { ensureBuckets, putAsset, sha256 } from '../src/lib/storage.js';
import { contentDesignHandler } from '../src/workers/contentDesign.js';
import { buildSiteHandler } from '../src/workers/builder.js';
import { visualQaHandler } from '../src/workers/visualQa.js';
import { deployHandler } from '../src/workers/deploy.js';
import { ensureDemoServer } from '../src/lib/serveDir.js';

const CAMPAIGN_ID = 'phaseC-fixture';
const BUSINESS_ID = 'gr-fixture-anemi-studio';
const args = new Set(process.argv.slice(2));

async function clean(): Promise<void> {
  for (const table of [
    'production_gaps', 'qualifications', 'website_audits', 'business_contacts',
    'business_facts', 'assets', 'site_projects', 'workflow_jobs', 'status_history',
    'business_sources',
  ]) {
    await pool.query(`delete from ${table} where business_id = $1`, [BUSINESS_ID]).catch(() => {});
  }
  await pool.query('delete from businesses where id = $1', [BUSINESS_ID]).catch(() => {});
  await pool.query('delete from campaigns where id = $1', [CAMPAIGN_ID]).catch(() => {});
  console.log('fixture removed');
}

/**
 * Deterministic, obviously-synthetic photographs. Generated with a headless
 * browser rather than shipped as binaries: they are plausible salon imagery in
 * composition and aspect ratio, which is all the pipeline mechanics need.
 */
async function makePhotos(dir: string): Promise<Array<{ file: string; w: number; h: number; kind: string }>> {
  await mkdir(dir, { recursive: true });
  const specs = [
    { name: 'interior.jpg', w: 1600, h: 1067, kind: 'hero', bg: '#d9cfc4', fg: '#6b5544', label: 'INTERIOR' },
    { name: 'detail.jpg', w: 1400, h: 1400, kind: 'gallery', bg: '#c9b9ab', fg: '#4a3a2e', label: 'DETAIL' },
    { name: 'workspace.jpg', w: 1500, h: 1000, kind: 'gallery', bg: '#e3dbd2', fg: '#5c4a3c', label: 'WORKSPACE' },
    { name: 'logo.png', w: 600, h: 600, kind: 'logo', bg: '#ffffff', fg: '#2b2118', label: 'ANEMI' },
  ];
  const browser = await chromium.launch({ headless: true });
  const out: Array<{ file: string; w: number; h: number; kind: string }> = [];
  try {
    for (const s of specs) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.setContent(`<html><body style="margin:0;width:${s.w}px;height:${s.h}px;
        background:linear-gradient(140deg, ${s.bg}, ${s.fg}22 70%, ${s.bg});
        display:flex;align-items:center;justify-content:center;
        font-family:Georgia,serif;color:${s.fg};letter-spacing:0.3em;font-size:${Math.round(s.w / 18)}px">
        <div style="opacity:.55">${s.label}</div></body></html>`);
      const buf = await page.screenshot({
        type: s.name.endsWith('.png') ? 'png' : 'jpeg',
        ...(s.name.endsWith('.png') ? {} : { quality: 88 }),
      });
      await writeFile(path.join(dir, s.name), buf);
      out.push({ file: s.name, w: s.w, h: s.h, kind: s.kind });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

async function seed(): Promise<void> {
  await ensureBuckets();
  await clean();

  await db.insert(schema.campaigns).values({
    id: CAMPAIGN_ID, country: 'gr', city: 'Patras', niche: 'beauty', language: 'el',
    queries: ['nail salon Patras'], geofence: { lat: 38.246, lng: 21.735, radiusKm: 8 },
    targetCount: 1, status: 'created',
  });

  await db.insert(schema.businesses).values({
    id: BUSINESS_ID, campaignId: CAMPAIGN_ID,
    name: 'Anemi Nail Studio',
    normalizedName: 'anemi nail studio',
    category: 'Nail salon',
    address: 'Riga Feraiou 84, Patras 262 21',
    lat: 38.2466, lng: 21.7346,
    phone: '+30 2610 279 118',
    normalizedPhone: '302610279118',
    placeId: 'FIXTURE-anemi-studio',
    listingUrl: 'https://maps.google.com/?cid=FIXTURE',
    rating: 4.8, reviewCount: 47,
    status: 'production_ready',
  });
  await db.insert(schema.statusHistory).values({
    businessId: BUSINESS_ID, fromStatus: null, toStatus: 'production_ready',
    actor: 'phaseC-fixture', reason: 'synthetic fixture for phase C mechanics',
  });

  const [source] = await db.insert(schema.businessSources).values({
    businessId: BUSINESS_ID, sourceType: 'google_maps',
    url: 'https://maps.google.com/?cid=FIXTURE', method: 'gosom_api',
    rawObjectKey: 'fixture/raw-1',
  }).returning();
  const [siteSource] = await db.insert(schema.businessSources).values({
    businessId: BUSINESS_ID, sourceType: 'owned_website',
    url: 'https://anemi-fixture.example.gr/', method: 'playwright',
    rawObjectKey: 'fixture/raw-2',
  }).returning();

  const facts: Array<[string, unknown, number]> = [
    ['identity.description', 'Στούντιο περιποίησης νυχιών στο κέντρο της Πάτρας, με έμφαση στη φυσική εμφάνιση και την υγιεινή.', siteSource!.id],
    ['service', { name: 'Manicure', price: '15€' }, siteSource!.id],
    ['service', { name: 'Ημιμόνιμο βερνίκι', price: '20€' }, siteSource!.id],
    ['service', { name: 'Pedicure', price: '25€' }, siteSource!.id],
    ['service', { name: 'Nail art', price: null }, siteSource!.id],
    ['review_excerpt', { text: 'Πολύ προσεγμένη δουλειά και καθαριότητα. Έμεινα ενθουσιασμένη.', rating: 5 }, source!.id],
    ['review_excerpt', { text: 'Συνεπείς στα ραντεβού, εξαιρετικό αποτέλεσμα στο ημιμόνιμο.', rating: 5 }, source!.id],
    ['hours', 'Δευ-Παρ 09:00-20:00, Σαβ 09:00-15:00', siteSource!.id],
    ['social.instagram', 'https://instagram.com/anemi.fixture', siteSource!.id],
  ];
  for (const [key, value, sourceId] of facts) {
    await db.insert(schema.businessFacts).values({
      businessId: BUSINESS_ID, key, value: value as never, sourceId,
      confidence: 0.9, extractionMethod: 'llm_structured', verified: true,
    });
  }

  await db.insert(schema.businessContacts).values([
    { businessId: BUSINESS_ID, channel: 'phone', value: '+30 2610 279 118', sourceId: source!.id, verified: true },
    { businessId: BUSINESS_ID, channel: 'email', value: 'hello@anemi-fixture.example.gr', sourceId: siteSource!.id, verified: true },
    { businessId: BUSINESS_ID, channel: 'instagram', value: 'https://instagram.com/anemi.fixture', sourceId: siteSource!.id, verified: true },
  ]);

  const photoDir = path.resolve('storage', 'fixture-photos');
  const photos = await makePhotos(photoDir);
  for (const p of photos) {
    const buf = await readFile(path.join(photoDir, p.file));
    const hash = sha256(buf);
    const ext = path.extname(p.file);
    const objectKey = `${BUSINESS_ID}/${p.kind}-${hash.slice(0, 12)}${ext}`;
    await putAsset(objectKey, buf, ext === '.png' ? 'image/png' : 'image/jpeg');
    await db.insert(schema.assets).values({
      businessId: BUSINESS_ID, objectKey, hash,
      sourceUrl: `https://anemi-fixture.example.gr/img/${p.file}`,
      sourceType: 'enrichment',
      contentType: ext === '.png' ? 'image/png' : 'image/jpeg',
      width: p.w, height: p.h, intendedUsage: p.kind, rights: 'private_demo_only',
    });
  }

  await db.insert(schema.websiteAudits).values({
    businessId: BUSINESS_ID,
    endpointMatrix: [{ url: 'https://anemi-fixture.example.gr/', status: 200, finalUrl: 'https://anemi-fixture.example.gr/', tlsOk: true, error: null }],
    bestEndpoint: 'https://anemi-fixture.example.gr/',
    verdict: 'working_but_dated', meaningfulContent: true,
    notes: 'Synthetic fixture audit.',
  });

  console.log(`seeded ${BUSINESS_ID} (${photos.length} assets, ${facts.length} facts, 3 contacts)`);
}

async function runChain(): Promise<void> {
  await ensureDemoServer();
  const t0 = Date.now();

  console.log('\n=== stage 9: content brief + design ===');
  await contentDesignHandler({ businessId: BUSINESS_ID, campaignId: CAMPAIGN_ID });
  const [project] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.businessId, BUSINESS_ID));
  if (!project) throw new Error('no site project created');
  console.log(`project ${project.id}: direction="${project.designDirection}" score=${project.designScore}`);

  console.log('\n=== stage 10-11: build + QA loop ===');
  let iteration = 0;
  let projectState = project.state;
  while (iteration < 10) {
    const [current] = await db.select().from(schema.siteProjects)
      .where(eq(schema.siteProjects.id, project.id));
    projectState = current!.state;
    if (projectState === 'ready' || projectState === 'deployed' || projectState === 'needs_human_review') break;

    await buildSiteHandler({
      businessId: BUSINESS_ID, campaignId: CAMPAIGN_ID, projectId: project.id, iteration,
    });
    // The builder enqueues visual-qa with the provenance findings; call it directly
    // with the same payload shape a queue round-trip would have produced.
    const provenanceIssues: string[] = [];
    await visualQaHandler({
      businessId: BUSINESS_ID, campaignId: CAMPAIGN_ID, projectId: project.id, iteration,
      provenanceIssues,
    }).catch((err) => {
      if (err?.code === 'NEEDS_HUMAN') { console.log(`QA exhausted: ${err.message}`); return; }
      throw err;
    });
    iteration++;
  }

  const [afterQa] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.id, project.id));
  console.log(`after QA: state=${afterQa!.state} iterations=${afterQa!.qaIterations} openIssues=${(afterQa!.openIssues ?? []).length}`);

  if (afterQa!.state !== 'ready') {
    console.log('not ready; skipping deploy');
    return;
  }

  console.log('\n=== stage 12: deploy ===');
  await deployHandler({ businessId: BUSINESS_ID, campaignId: CAMPAIGN_ID, projectId: project.id });
  const [deployed] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.id, project.id));
  console.log(`deployed: ${deployed!.deployUrl}`);
  console.log(`\ntotal wall time: ${Math.round((Date.now() - t0) / 1000)}s`);
}

if (args.has('--clean')) {
  await clean();
} else {
  if (args.has('--seed') || args.has('--run')) await seed();
  if (args.has('--run')) await runChain();
  if (!args.has('--seed') && !args.has('--run')) {
    console.log('usage: phaseC-fixture.ts [--seed | --run | --clean]');
  }
}
await pool.end();
