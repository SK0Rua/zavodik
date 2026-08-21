/**
 * Playwright page capture for enrichment (spec §4 stage 4).
 *
 * Every capture writes the FULL raw HTML to object storage and inserts a
 * `business_sources` row with the capture time — that row's id is the
 * `source_id` every downstream fact must point at. Raw objects are immutable
 * (the key embeds a content hash), so a re-capture is a new version, never an
 * overwrite (spec §5).
 *
 * Failure is never fatal: an unreachable page yields null and the caller
 * proceeds with whatever evidence it does have.
 */
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { log } from '../lib/logger.js';

export interface CapturedSource {
  /** Prompt-facing label (S1, S2, ...) so the agent can cite a source. */
  ref: string;
  sourceId: number;
  sourceType: string;
  url: string;
  finalUrl: string;
  /** Readable text for the agent's token budget. */
  text: string;
  /** Full page source, used by the deterministic contact detector. */
  html: string;
  rawObjectKey: string;
  capturedAt: Date;
}

export interface CaptureTarget {
  url: string;
  sourceType: 'owned_website' | 'instagram' | 'facebook' | 'tiktok' | 'telegram' | 'directory' | 'google_maps' | 'search';
}

const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 2_500;

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
}

/**
 * A plain desktop context. A realistic UA matters: several Greek salon sites
 * (and every social network) serve a stub page to obvious automation.
 */
export async function newCapturePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'el-GR',
    ignoreHTTPSErrors: true,
  });
  ctx.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  return ctx.newPage();
}

/**
 * Captures one URL as immutable evidence and returns the material the
 * enrichment agent is allowed to see. Returns null when the page is not
 * publicly reachable — that is a gap, never an invented fact.
 */
export async function capturePage(
  businessId: string,
  target: CaptureTarget,
  page: Page,
): Promise<CapturedSource | null> {
  try {
    const res = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    const status = res?.status() ?? null;
    if (status !== null && status >= 400) {
      log.warn('capture got error status', { businessId, url: target.url, status });
      return null;
    }

    const html = await page.content();
    // A login wall / "page isn't available" stub is not evidence about the business.
    if (isBlockedPage(html, target.sourceType)) {
      log.warn('capture blocked (login wall / unavailable)', { businessId, url: target.url, type: target.sourceType });
      return null;
    }

    const capturedAt = new Date();
    const rawObjectKey = await putRaw(`enrichment/${businessId}/${target.sourceType}`, html, 'text/html');
    // Raw objects are immutable and a re-capture is a NEW VERSION, never an
    // overwrite (spec §5). Version numbers make repeat captures of the same URL
    // legible as history instead of looking like accidental duplicates.
    const previous = await db.select({ version: schema.businessSources.version })
      .from(schema.businessSources)
      .where(and(
        eq(schema.businessSources.businessId, businessId),
        eq(schema.businessSources.url, page.url()),
      ));
    const version = previous.reduce((max, p) => Math.max(max, p.version), 0) + 1;
    const [src] = await db.insert(schema.businessSources).values({
      businessId,
      sourceType: target.sourceType,
      url: page.url(),
      method: 'playwright',
      rawObjectKey,
      capturedAt,
      version,
    }).returning();

    const text = await extractReadable(page);
    return {
      ref: '',
      sourceId: src.id,
      sourceType: target.sourceType,
      url: target.url,
      finalUrl: page.url(),
      text,
      html,
      rawObjectKey,
      capturedAt,
    };
  } catch (err) {
    log.warn('capture failed', { businessId, url: target.url, err: String(err).slice(0, 200) });
    return null;
  }
}

/** Detects login walls and "content unavailable" stubs, which carry no facts. */
export function isBlockedPage(html: string, sourceType: string): boolean {
  const lower = html.toLowerCase();
  if (sourceType === 'instagram') {
    if (lower.includes('login_required') || lower.includes("page isn't available")) return true;
    // an IG profile page always ships profile JSON; a bare consent wall does not
    if (!lower.includes('og:description') && !lower.includes('profilepage')) return true;
  }
  if (sourceType === 'facebook') {
    if (lower.includes('you must log in to continue') || lower.includes('login_required')) return true;
  }
  if (lower.length < 800) return true; // effectively empty document
  return false;
}

/**
 * Readable page text + image inventory. Scripts/styles are stripped so the
 * agent's context is business content, not framework noise.
 *
 * NOTE: the browser-side code is passed as a STRING, not a closure. tsx/esbuild
 * compiles this file with `keepNames`, which injects a `__name(...)` helper into
 * every named/arrow function; Playwright serializes the closure and the helper
 * is undefined in the page, so a closure form dies with
 * "ReferenceError: __name is not defined". A string body is never rewritten.
 */
const READABLE_JS = `(() => {
  const doc = document.cloneNode(true);
  doc.querySelectorAll('script,style,noscript,svg,iframe,template').forEach(function (el) { el.remove(); });
  const body = (doc.body && doc.body.innerText) || '';
  function meta(name) {
    const el = doc.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return (el && el.content) || '';
  }
  const head = [
    'TITLE: ' + doc.title,
    meta('description') ? 'META description: ' + meta('description') : '',
    meta('og:title') ? 'META og:title: ' + meta('og:title') : '',
    meta('og:description') ? 'META og:description: ' + meta('og:description') : ''
  ].filter(Boolean).join('\\n');
  const links = Array.prototype.slice.call(doc.querySelectorAll('a[href]'))
    .map(function (a) { return (a.getAttribute('href') || '').slice(0, 300); })
    .filter(function (h) { return /wa\\.me|whatsapp|viber|instagram\\.com|facebook\\.com|tiktok\\.com|mailto:|tel:/i.test(h); })
    .slice(0, 40);
  const imgs = Array.prototype.slice.call(document.images)
    .filter(function (i) { return i.naturalWidth >= 200; })
    .slice(0, 40)
    .map(function (i) {
      var src = i.currentSrc || i.src || '';
      // Inline data: URIs are megabytes of base64 — the URL itself is not
      // evidence, only the fact that an image exists. Never inline them.
      if (src.indexOf('data:') === 0) src = '[inline data URI]';
      if (src.length > 300) src = src.slice(0, 300) + '…';
      return 'IMG ' + src + ' (' + i.naturalWidth + 'x' + i.naturalHeight + ') alt="' + String(i.alt).slice(0, 120) + '"';
    });
  return [
    head,
    body.replace(/\\n{3,}/g, '\\n\\n').slice(0, 18000),
    links.length ? '\\nCONTACT LINKS:\\n' + links.join('\\n') : '',
    imgs.length ? '\\nIMAGES:\\n' + imgs.join('\\n') : ''
  ].filter(Boolean).join('\\n\\n');
})()`;

async function extractReadable(page: Page): Promise<string> {
  return page.evaluate(READABLE_JS) as Promise<string>;
}

/**
 * A viewport PNG of the page currently loaded, stored as raw evidence.
 *
 * WHY A SCREENSHOT AND NOT JUST THE HTML. The brand agent (`brandAgent.ts`)
 * judges an identity by LOOKING at it, and an Instagram profile's visual
 * identity — the grid's colour grading, the highlight covers, the typography of
 * the bio card — lives in rendered pixels, not in the markup. The stored HTML is
 * post-hydration and complete, but no model reads a brand off a React tree.
 *
 * Viewport rather than full page: a profile grid is thousands of pixels tall and
 * the identity is settled in the first screen. `deviceScaleFactor` is whatever
 * the capture context set; 1280-wide at 1x is enough for colour and layout.
 *
 * Returns null on any failure — a missing screenshot narrows what the agent can
 * see, it never fails a capture.
 */
export async function captureScreenshot(
  businessId: string,
  page: Page,
  prefix: string,
): Promise<string | null> {
  try {
    const buf = await page.screenshot({ fullPage: false });
    return await putRaw(`enrichment/${businessId}/${prefix}`, buf, 'image/png');
  } catch (err) {
    log.warn('screenshot capture failed', { businessId, prefix, err: String(err).slice(0, 200) });
    return null;
  }
}

/**
 * Image URLs present on a captured page, tagged with a best-guess usage.
 * The guess only decides where an asset is *offered*; nothing downstream
 * presents it as a verified fact.
 */
const PAGE_IMAGES_JS = `(() => {
  const out = [];
  const ogEl = document.querySelector('meta[property="og:image"]');
  if (ogEl && ogEl.content) out.push({ url: ogEl.content, kind: 'hero', width: 0, height: 0 });
  const imgs = Array.prototype.slice.call(document.images);
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const src = img.currentSrc || img.src;
    if (!src) continue;
    // Inline base64 images ARE collectable evidence (some sites embed their
    // real photos): pass the data URI through — the asset worker decodes it
    // locally instead of fetching. Tiny data URIs are icons; skip by size too.
    if (src.indexOf('data:') === 0 && src.length < 5000) continue;
    if (img.naturalWidth < 200 || img.naturalHeight < 150) continue;
    const hay = (src + ' ' + img.alt + ' ' + img.className).toLowerCase();
    const kind = /logo|brand/.test(hay)
      ? 'logo'
      : (img.naturalWidth >= 1000 && img.naturalWidth >= img.naturalHeight) ? 'hero' : 'gallery';
    out.push({ url: src, kind: kind, width: img.naturalWidth, height: img.naturalHeight });
  }
  return out.slice(0, 40);
})()`;

export async function collectPageImages(page: Page): Promise<Array<{ url: string; kind: 'hero' | 'logo' | 'gallery'; width: number; height: number }>> {
  return page.evaluate(PAGE_IMAGES_JS) as Promise<Array<{ url: string; kind: 'hero' | 'logo' | 'gallery'; width: number; height: number }>>;
}
