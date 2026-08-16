/**
 * Website audit: full URL matrix (http/https x www/non-www), real browser render,
 * desktop + mobile screenshots, meaningful-content check.
 * One TLS error never means "no website" (the Get Nailed lesson).
 */
import { chromium } from 'playwright';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

type Verdict = 'none' | 'unreachable_all_endpoints' | 'working_with_https_issue' | 'working_but_dated' | 'acceptable' | 'strong_modern';

interface EndpointResult { url: string; status: number | null; finalUrl: string | null; tlsOk: boolean | null; error: string | null }

async function probe(url: string): Promise<EndpointResult> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    return { url, status: res.status, finalUrl: res.url, tlsOk: url.startsWith('https') ? true : null, error: null };
  } catch (err: any) {
    const msg = String(err?.cause?.code ?? err?.message ?? err);
    const tlsIssue = /CERT|TLS|SSL|EPROTO|HANDSHAKE/i.test(msg);
    return { url, status: null, finalUrl: null, tlsOk: tlsIssue ? false : null, error: msg.slice(0, 200) };
  }
}

export async function auditHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);

  let verdict: Verdict = 'none';
  let matrix: EndpointResult[] = [];
  let bestEndpoint: string | null = null;
  let desktopKey: string | null = null;
  let mobileKey: string | null = null;
  let meaningful: boolean | null = null;
  let notes = '';

  if (biz.domain) {
    const bare = biz.domain;
    const candidates = [
      `https://${bare}`, `https://www.${bare}`,
      `http://${bare}`, `http://www.${bare}`,
    ];
    matrix = await Promise.all(candidates.map(probe));
    const ok = matrix.filter((m) => m.status !== null && m.status < 500);
    const httpsOk = ok.some((m) => m.url.startsWith('https'));
    bestEndpoint = ok.find((m) => m.url.startsWith('https'))?.finalUrl
      ?? ok[0]?.finalUrl ?? null;

    if (!bestEndpoint) {
      verdict = 'unreachable_all_endpoints';
    } else {
      const browser = await chromium.launch({ headless: true });
      try {
        // desktop
        const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
        const dPage = await dCtx.newPage();
        const consoleErrors: string[] = [];
        dPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 150)); });
        await dPage.goto(bestEndpoint, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await dPage.waitForTimeout(2500);
        const textLen = await dPage.evaluate(() => document.body?.innerText?.trim().length ?? 0);
        meaningful = textLen > 300;
        const dShot = await dPage.screenshot({ fullPage: false });
        desktopKey = await putRaw(`audits/${businessId}/desktop`, dShot, 'image/png');

        // mobile
        const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, ignoreHTTPSErrors: true });
        const mPage = await mCtx.newPage();
        await mPage.goto(bestEndpoint, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await mPage.waitForTimeout(2000);
        const mShot = await mPage.screenshot({ fullPage: false });
        mobileKey = await putRaw(`audits/${businessId}/mobile`, mShot, 'image/png');

        const hasViewportMeta = await dPage.evaluate(() => !!document.querySelector('meta[name="viewport"]'));
        const modernSignals = await dPage.evaluate(() => {
          const gen = (document.querySelector('meta[name="generator"]') as HTMLMetaElement)?.content ?? '';
          const dated = /wordpress 4|joomla|frontpage|wix.*2015/i.test(gen);
          const hasFlash = !!document.querySelector('object[type*="flash"], embed[type*="flash"]');
          const tables = document.querySelectorAll('table').length;
          return { dated, hasFlash, tables };
        });

        if (!meaningful) {
          verdict = 'working_but_dated';
          notes = `low meaningful content (${textLen} chars)`;
        } else if (!httpsOk) {
          verdict = 'working_with_https_issue';
        } else if (!hasViewportMeta || modernSignals.hasFlash || modernSignals.dated) {
          verdict = 'working_but_dated';
        } else if (consoleErrors.length > 3 || modernSignals.tables > 5) {
          verdict = 'acceptable';
        } else {
          verdict = 'acceptable'; // strong_modern only after cross-check below
        }
        notes += consoleErrors.length ? ` console_errors=${consoleErrors.length}` : '';
      } finally {
        await browser.close();
      }
    }
  }

  // cross-check with enrichment: if agent extracted services from a site but audit says none -> needs_review
  const siteFacts = await db.select().from(schema.businessFacts)
    .where(eq(schema.businessFacts.businessId, businessId));
  const hadSiteContent = siteFacts.some((f) => f.key === 'service');
  if ((verdict === 'none' || verdict === 'unreachable_all_endpoints') && biz.websiteUrl && hadSiteContent) {
    notes += ' CONTRADICTION: enrichment extracted content but audit unreachable';
  }

  await db.insert(schema.websiteAudits).values({
    businessId, endpointMatrix: matrix, bestEndpoint, verdict,
    desktopScreenshotKey: desktopKey, mobileScreenshotKey: mobileKey,
    meaningfulContent: meaningful, notes: notes.trim() || null,
  });
  log.info('audit done', { businessId, verdict, bestEndpoint });

  if (notes.includes('CONTRADICTION')) {
    await transition(businessId, 'needs_review', 'audit-worker', notes.trim());
    return;
  }
  await enqueue('score-and-qa', { businessId, campaignId: biz.campaignId });
}
