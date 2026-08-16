/**
 * Site builder agent (isolated): receives ONLY the immutable snapshot, content
 * brief and chosen design contract. Produces a self-contained static site
 * (multi-section single page + optional extra pages) with local assets.
 *
 * v1 deliberately generates static HTML/CSS/JS (Motion One / GSAP via CDN opt-in)
 * instead of a per-site Next.js build: zero build-failure modes, instant deploys,
 * fast QA loop. The Next.js template path (like the Get Nailed pilot) can be added
 * as an alternative builder later without touching the pipeline.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getObject } from '../lib/storage.js';
import { runAgent, z } from '../agents/agent.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { buildClientSnapshot } from './snapshot.js';
import { log } from '../lib/logger.js';

const SiteSchema = z.object({
  files: z.array(z.object({
    path: z.string(),    // e.g. "index.html", "styles.css", "app.js"
    content: z.string(),
  })),
  notes: z.string(),
});

export const SITES_ROOT = path.resolve('sites');

export function builderSystemPrompt(): string {
  return `You are an elite web designer-developer building a personalized DEMO website for a local business.

HARD RULES:
- Use ONLY facts from the provided snapshot/brief. Every service, price, review, phone, address on the page must exist in the snapshot. No invented claims, no fake awards, no "since 19XX".
- Reference images ONLY via the relative paths listed in snapshot.assets (they are already downloaded next to the site).
- Output a complete static site: index.html required; styles.css and app.js as needed. No build step, no external frameworks except CDN links (fonts, Motion One or GSAP if the design contract asks for motion).
- Must be fully responsive (mobile 390px, tablet 768px, desktop 1440px), no horizontal overflow.
- Include <meta name="robots" content="noindex, nofollow">.
- Respect prefers-reduced-motion.
- Write all visible copy in the snapshot language.
- Follow the chosen design direction's layout/typography/motion concept faithfully; this must NOT look like a generic template.
- Include a clear primary CTA (call/WhatsApp/visit) using the real contact from the snapshot.`;
}

export async function buildSiteHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const projectId = payload.projectId as number;
  const [project] = await db.select().from(schema.siteProjects).where(eq(schema.siteProjects.id, projectId));
  if (!project) throw new Error(`site project not found: ${projectId}`);

  const snapshot = await buildClientSnapshot(businessId);
  const brief = JSON.parse((await getObject('raw', project.contentBriefKey!)).toString());
  const design = JSON.parse((await getObject('raw', project.designContractKey!)).toString());

  const issues = (payload.issues as string[] | undefined) ?? [];
  const previousFiles = payload.previousFiles as Array<{ path: string; content: string }> | undefined;

  const userContent = issues.length && previousFiles
    ? `Fix ONLY these QA issues in the existing site, keeping everything else intact.\n\nISSUES:\n${issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}\n\nEXISTING FILES:\n${JSON.stringify(previousFiles)}\n\nSNAPSHOT:\n${JSON.stringify(snapshot)}\n\nBRIEF:\n${JSON.stringify(brief)}\n\nDESIGN (chosen):\n${JSON.stringify(design.chosen)}`
    : `SNAPSHOT:\n${JSON.stringify(snapshot, null, 2)}\n\nCONTENT BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nDESIGN CONTRACT (chosen direction):\n${JSON.stringify(design.chosen, null, 2)}`;

  const site = await runAgent('site-builder', builderSystemPrompt(), userContent, SiteSchema, {
    heavy: true, maxTokens: 32_000, retries: 1,
  });

  const siteDir = path.join(SITES_ROOT, businessId);
  await mkdir(path.join(siteDir, 'assets'), { recursive: true });

  // materialize agent files (path traversal guard)
  for (const f of site.files) {
    const target = path.join(siteDir, f.path);
    if (!target.startsWith(siteDir)) throw new Error(`path traversal attempt: ${f.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, f.content, 'utf8');
  }

  // copy allowed assets locally
  const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));
  for (const a of assetRows) {
    const buf = await getObject('assets', a.objectKey);
    await writeFile(path.join(siteDir, 'assets', a.objectKey.split('/').pop()!), buf);
  }

  await db.update(schema.siteProjects)
    .set({ state: 'qa', dir: siteDir, buildOk: true })
    .where(eq(schema.siteProjects.id, projectId));

  log.info('site built', { businessId, files: site.files.length, iteration: (payload.iteration as number | undefined) ?? 0 });
  await enqueue('visual-qa', {
    businessId, projectId, campaignId: payload.campaignId,
    iteration: ((payload.iteration as number | undefined) ?? 0),
    idempotencyKey: `visual-qa:${businessId}:${(payload.iteration as number | undefined) ?? 0}`,
  });
}
