/**
 * Automated QA + visual critique loop.
 * Deterministic checks: console errors, broken assets, overflow, 3 viewports.
 * Then an independent visual-critique agent LOOKS at the screenshots.
 * Builder gets concrete issues back into its workspace; MAX_QA_ITERATIONS then
 * needs_human_review, never an infinite loop.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { serveDir } from '../lib/serveDir.js';
import { config } from '../config.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { buildClientSnapshot } from './snapshot.js';
import { siteOutputDir, collectSourceFiles } from './builder.js';
import { notifyTelegram } from '../telegram/notify.js';
import { log } from '../lib/logger.js';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

export async function visualQaHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const projectId = payload.projectId as number;
  const iteration = (payload.iteration as number | undefined) ?? 0;
  const [project] = await db.select().from(schema.siteProjects).where(eq(schema.siteProjects.id, projectId));
  if (!project) throw new Error(`site project not found: ${projectId}`);

  const outputDir = siteOutputDir(project.dir);
  const { url, close } = await serveDir(outputDir);

  const issues: string[] = [];
  const screenshotKeys: string[] = [];
  const screenshots: Array<{ name: string; buf: Buffer }> = [];

  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
      page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(url)) failedRequests.push(r.url()); });

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(2000);

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      if (overflow) issues.push(`horizontal overflow at ${vp.name} (${vp.width}px)`);
      if (consoleErrors.length) issues.push(`console errors at ${vp.name}: ${consoleErrors.slice(0, 3).join(' | ')}`);
      if (failedRequests.length) issues.push(`broken assets/links at ${vp.name}: ${failedRequests.slice(0, 3).map((u) => path.basename(u)).join(', ')}`);

      const shot = await page.screenshot({ fullPage: true });
      screenshots.push({ name: vp.name, buf: shot });
      screenshotKeys.push(await putRaw(`sites/${businessId}/qa-${iteration}/${vp.name}`, shot, 'image/png'));
      await ctx.close();
    }

    // factual check: page must contain the snapshot's primary contact somewhere
    const snapshot = await buildClientSnapshot(businessId);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const pageText = await page.evaluate(() => document.body?.innerText ?? '');
    if (snapshot.phone && !pageText.replace(/\s/g, '').includes(snapshot.phone.replace(/\s/g, ''))) {
      issues.push('primary phone from snapshot not visible on the page (CTA may be weak)');
    }
    await ctx.close();

    // independent visual critique (multimodal)
    if (config.anthropic.apiKey) {
      try {
        const client = new Anthropic({ apiKey: config.anthropic.apiKey });
        const res = await client.messages.create({
          model: config.anthropic.modelHeavy,
          max_tokens: 2000,
          system: `You are a ruthless independent design critic reviewing a demo website for a local business.
You did not build it. List ONLY concrete, actionable visual issues (layout, hierarchy, contrast, spacing, typography,
awkward image crops, unfinished-looking sections). If the design is genuinely good, approve it.
Reply as JSON: {"approved": boolean, "issues": string[]}`,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `Business: ${snapshot.name} (${snapshot.category}). Screenshots: desktop, tablet, mobile.` },
              ...screenshots.map((s) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/png' as const, data: s.buf.toString('base64') },
              })),
            ],
          }],
        });
        const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
        const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
        if (parsed.approved === false && Array.isArray(parsed.issues)) {
          issues.push(...parsed.issues.slice(0, 8).map((i: string) => `visual: ${i}`));
        }
      } catch (err) {
        log.warn('visual critique failed, relying on deterministic checks', { businessId, err: String(err).slice(0, 200) });
      }
    }
  } finally {
    await browser.close();
    close();
  }

  const qaReportKey = await putRaw(`sites/${businessId}/qa-${iteration}/report`,
    JSON.stringify({ iteration, issues, screenshotKeys }, null, 2), 'application/json');

  await db.update(schema.siteProjects)
    .set({ qaIterations: iteration + 1, qaReportKey, screenshotKeys })
    .where(eq(schema.siteProjects.id, projectId));

  if (issues.length === 0) {
    await db.update(schema.siteProjects).set({ state: 'ready' }).where(eq(schema.siteProjects.id, projectId));
    await enqueue('deploy-demo', { businessId, projectId, campaignId: payload.campaignId });
    log.info('QA passed', { businessId, iteration });
    return;
  }

  if (iteration + 1 >= config.maxQaIterations) {
    const snapshot = await buildClientSnapshot(businessId);
    await db.update(schema.siteProjects).set({ state: 'needs_human_review' }).where(eq(schema.siteProjects.id, projectId));
    await transition(businessId, 'needs_review', 'visual-qa', `QA limit reached; ${issues.length} open issues`);
    await notifyTelegram(`🔍 Site for <b>${snapshot.name}</b> needs human review after ${config.maxQaIterations} QA iterations.\nOpen issues:\n${issues.slice(0, 6).map((i) => `• ${i}`).join('\n')}`);
    return;
  }

  // feed concrete issues back to the builder (same workspace in claude-code mode)
  const previousFiles = config.agentRuntime === 'api' ? await collectSourceFiles(project.dir) : undefined;
  await enqueue('build-site', {
    businessId, projectId, campaignId: payload.campaignId,
    iteration: iteration + 1, issues, previousFiles,
    idempotencyKey: `build-site:${businessId}:${iteration + 1}`,
  });
  log.info('QA issues found, iterating', { businessId, iteration, issues: issues.length });
}
