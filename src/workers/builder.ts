/**
 * Site builder. Two runtimes (AGENT_RUNTIME):
 *
 *  claude-code (default): a real Claude Code agent (Agent SDK) gets an isolated
 *    workspace with the Next.js template, the immutable client snapshot, content
 *    brief, chosen design contract and local assets. It writes the site, runs
 *    `pnpm install` + `pnpm build` itself, fixes its own build errors, and ships
 *    a static export in out/. QA issues come back into the SAME workspace.
 *
 *  api: single-shot structured API call producing a static HTML/CSS/JS site.
 *    Cheap fallback; no self-iteration.
 *
 * Either way the builder sees ONLY the verified client package: no web access
 * to "find" facts. Missing content returns the package to enrichment, not fantasy.
 */
import { cp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getObject } from '../lib/storage.js';
import { config } from '../config.js';
import { runAgent, z } from '../agents/agent.js';
import { runCodeAgent } from '../agents/codeAgent.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { buildClientSnapshot } from './snapshot.js';
import { log } from '../lib/logger.js';

export const SITES_ROOT = path.resolve('sites');
const TEMPLATE_DIR = path.resolve('site-template');

/** Directory that actually gets served/QA'd/deployed. */
export function siteOutputDir(projectDir: string): string {
  const out = path.join(projectDir, 'out');
  return existsSync(path.join(out, 'index.html')) ? out : projectDir;
}

const BuildResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  pagesBuilt: z.array(z.string()).optional(),
});

const StaticSiteSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  notes: z.string(),
});

async function prepareWorkspace(businessId: string, siteDir: string): Promise<void> {
  await mkdir(path.join(siteDir, 'input'), { recursive: true });
  await mkdir(path.join(siteDir, 'public', 'assets'), { recursive: true });
  const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));
  for (const a of assetRows) {
    const buf = await getObject('assets', a.objectKey);
    await writeFile(path.join(siteDir, 'public', 'assets', a.objectKey.split('/').pop()!), buf);
  }
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
  const iteration = (payload.iteration as number | undefined) ?? 0;

  const siteDir = path.join(SITES_ROOT, businessId);

  if (config.agentRuntime === 'claude-code') {
    const isFix = issues.length > 0 && existsSync(path.join(siteDir, 'package.json'));
    if (!isFix) {
      await mkdir(siteDir, { recursive: true });
      await cp(TEMPLATE_DIR, siteDir, { recursive: true });
      await prepareWorkspace(businessId, siteDir);
      await writeFile(path.join(siteDir, 'input', 'snapshot.json'), JSON.stringify(snapshot, null, 2));
      await writeFile(path.join(siteDir, 'input', 'brief.json'), JSON.stringify(brief, null, 2));
      await writeFile(path.join(siteDir, 'input', 'design.json'), JSON.stringify(design.chosen, null, 2));
    }

    const rules = `HARD RULES (violating any of these fails the job):
- Every fact on the site (services, prices, reviews, phone, address, hours) must come from input/snapshot.json. Никаких invented claims, awards, or "since 19XX".
- Use ONLY images under public/assets/ (reference as /assets/<file>).
- The site language is "${snapshot.language}" for all visible copy.
- Keep robots noindex (already in layout metadata). This is a PRIVATE demo.
- Fully responsive: 390px, 768px, 1440px. Zero horizontal overflow.
- Respect prefers-reduced-motion (globals.css already does; don't undo it).
- Follow input/design.json faithfully: its layout concept, typography, palette and motion. This must NOT look like a generic template.
- Primary CTA uses the real contact from the snapshot.
- Do NOT fetch anything from the internet except pnpm packages.
- Finish with a green \`pnpm build\` producing a static export in out/.`;

    const prompt = isFix
      ? `You previously built this Next.js demo site. QA found concrete issues. Fix ONLY these issues, keep everything else intact, then re-run \`pnpm build\` until green.

ISSUES (iteration ${iteration}):
${issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}

${rules}

result.json schema: {"ok": boolean, "summary": string, "pagesBuilt": string[]}`
      : `Build a personalized demo website for a real local business inside this Next.js workspace (static export already configured).

Inputs in the workspace:
- input/snapshot.json  — verified facts (the ONLY source of truth)
- input/brief.json     — content brief: sections, offer, CTA, tone
- input/design.json    — the chosen art direction to implement
- public/assets/       — the ONLY allowed images

Steps: study inputs, replace app/page.tsx + layout metadata + globals.css with the real site (add components/ as needed), run \`pnpm install\` then \`pnpm build\`, fix any errors yourself, verify out/index.html exists.

${rules}

result.json schema: {"ok": boolean, "summary": string, "pagesBuilt": string[]}`;

    const result = await runCodeAgent(
      { name: `site-builder:${businessId}`, cwd: siteDir, prompt, heavy: true, maxTurns: 120 },
      BuildResultSchema,
    );
    if (!result.ok) throw new Error(`builder agent reported failure: ${result.summary.slice(0, 300)}`);
    if (!existsSync(path.join(siteDir, 'out', 'index.html'))) {
      throw new Error('builder agent finished but out/index.html is missing');
    }
    log.info('site built (claude-code)', { businessId, iteration, summary: result.summary.slice(0, 200) });
  } else {
    // api fallback: single-shot static site
    const previousFiles = payload.previousFiles as Array<{ path: string; content: string }> | undefined;
    const userContent = issues.length && previousFiles
      ? `Fix ONLY these QA issues, keep everything else intact.\n\nISSUES:\n${issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}\n\nEXISTING FILES:\n${JSON.stringify(previousFiles)}\n\nSNAPSHOT:\n${JSON.stringify(snapshot)}\n\nBRIEF:\n${JSON.stringify(brief)}\n\nDESIGN:\n${JSON.stringify(design.chosen)}`
      : `SNAPSHOT:\n${JSON.stringify(snapshot, null, 2)}\n\nBRIEF:\n${JSON.stringify(brief, null, 2)}\n\nDESIGN:\n${JSON.stringify(design.chosen, null, 2)}`;

    const site = await runAgent(
      'site-builder-api',
      `You are an elite web designer-developer building a personalized DEMO website (static HTML/CSS/JS, single page, index.html required).
Use ONLY snapshot facts and assets/ images. Responsive 390/768/1440, no overflow, noindex meta, prefers-reduced-motion respected, copy in the snapshot language, follow the design contract faithfully.`,
      userContent,
      StaticSiteSchema,
      { heavy: true, maxTokens: 32_000, retries: 1 },
    );
    await mkdir(path.join(siteDir, 'assets'), { recursive: true });
    for (const f of site.files) {
      const target = path.join(siteDir, f.path);
      if (!target.startsWith(siteDir)) throw new Error(`path traversal attempt: ${f.path}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, f.content, 'utf8');
    }
    const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));
    for (const a of assetRows) {
      const buf = await getObject('assets', a.objectKey);
      await writeFile(path.join(siteDir, 'assets', a.objectKey.split('/').pop()!), buf);
    }
    log.info('site built (api)', { businessId, iteration, files: site.files.length });
  }

  await db.update(schema.siteProjects)
    .set({ state: 'qa', dir: siteDir, buildOk: true })
    .where(eq(schema.siteProjects.id, projectId));

  await enqueue('visual-qa', {
    businessId, projectId, campaignId: payload.campaignId,
    iteration,
    idempotencyKey: `visual-qa:${businessId}:${iteration}`,
  });
}

/** Collect current source files (api runtime) to feed back into a fix iteration. */
export async function collectSourceFiles(dir: string): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for (const f of await readdir(dir, { recursive: true }) as string[]) {
    if (f.includes('node_modules') || f.startsWith('assets') || f.startsWith('public') || f.startsWith('out') || f.startsWith('.next') || f.startsWith('input')) continue;
    if (!/\.(html|css|js)$/.test(f)) continue;
    files.push({ path: f, content: await readFile(path.join(dir, f), 'utf8') });
  }
  return files;
}
