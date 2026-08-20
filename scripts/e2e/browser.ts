/**
 * Playwright plumbing shared by the page checks.
 *
 * Two things worth stating, because both are the difference between a gate that
 * catches regressions and one that produces noise:
 *
 *  - EVERY page visit records console errors and failed requests. The sweep
 *    found no JS errors anywhere; that is a property worth keeping, and it is
 *    only kept if every navigation is watched rather than a chosen few.
 *
 *  - The raw-enum scan runs over `innerText`, not over the HTML. Machine values
 *    legitimately live in `title` tooltips and `value` attributes all over this
 *    console (the filter chips carry the raw enum as a tooltip on purpose — the
 *    sweep called that out as well done). Scanning markup would flag those; the
 *    question the check actually asks is "did Roman SEE an English enum".
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const DEMO_BASE = process.env.E2E_DEMO_URL ?? 'http://localhost:8788';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

export function uiPassword(): string {
  if (process.env.UI_PASSWORD) return process.env.UI_PASSWORD;
  const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
  return /^UI_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
}

export interface PageProbe {
  page: Page;
  consoleErrors: string[];
  failedRequests: string[];
}

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

export async function newContext(browser: Browser, viewport = { width: 1280, height: 900 }): Promise<BrowserContext> {
  return browser.newContext({ viewport, locale: 'uk-UA' });
}

export async function login(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="password"]', uiPassword());
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
  return page;
}

/** Attach error collectors to a page and return them alongside it. */
export function watch(page: Page): PageProbe {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // A 404 on a route the check DELIBERATELY requests (privacy probes) surfaces
    // here as a console error too; those are asserted on the response instead.
    consoleErrors.push(text.slice(0, 240));
  });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 240)}`));
  page.on('requestfailed', (r) => {
    if (isBenignAbort(r.url(), r.failure()?.errorText ?? '')) return;
    failedRequests.push(`${r.url().slice(0, 160)} ${r.failure()?.errorText ?? ''}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 160)}`);
  });
  return { page, consoleErrors, failedRequests };
}

/**
 * A cancelled Next.js route prefetch is not a broken request.
 *
 * `<Link>` speculatively fetches the RSC payload of every nav target it can see
 * (`?_rsc=<hash>`), and the browser aborts those in flight the moment the user
 * navigates. Playwright reports the abort as `requestfailed`, so a naive
 * "0 failed requests" assertion fails on every single page — a gate that cries
 * wolf on its own framework teaches the reader to ignore it.
 *
 * The exemption is deliberately narrow: ONLY an abort (never a 4xx/5xx, which
 * still arrives via the `response` handler above), and only on a URL carrying
 * the `_rsc` prefetch marker. A genuinely broken page still fails the check.
 */
function isBenignAbort(url: string, errorText: string): boolean {
  return errorText.includes('ERR_ABORTED') && /[?&]_rsc=/.test(url);
}

/**
 * Raw machine values that must never reach the operator's eyes.
 *
 * The pattern is snake_case ASCII words and SCREAMING_CASE enums, which is what
 * every leak the sweep found looked like (`no_website`, `dry_run — симуляція`,
 * `manual_pending`, `assets_min3`, `FAILED`). The allowlist exists because some
 * machine-shaped strings are legitimately on screen: ids Roman uses to tell two
 * identically named campaigns apart, URLs, and file keys shown as evidence.
 */
const RAW_ENUM_RE = /\b(?:[a-z][a-z0-9]*_[a-z0-9_]+|[A-Z]{3,}(?:_[A-Z0-9]+)+)\b/g;

const ENUM_ALLOWLIST: RegExp[] = [
  // Business and campaign ids ARE shown on purpose (sweep P1-4 asked for it).
  /^gr[_-]/, /^e2e[_-]/, /^legacy[_-]website[_-]offers$/,
  // Storage keys and evidence paths are the proof link's own text.
  /^raw[_-]object[_-]key$/,
  // Settings keys are the thing being configured — the label IS the key.
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/,
];

export interface EnumLeak {
  token: string;
  context: string;
}

export async function scanRawEnums(page: Page): Promise<EnumLeak[]> {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const leaks: EnumLeak[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(RAW_ENUM_RE)) {
    const token = m[0];
    if (seen.has(token)) continue;
    if (ENUM_ALLOWLIST.some((re) => re.test(token))) continue;
    seen.add(token);
    const at = m.index ?? 0;
    leaks.push({ token, context: text.slice(Math.max(0, at - 40), at + token.length + 40).replace(/\s+/g, ' ') });
  }
  return leaks;
}

/**
 * Ukrainian status phrases that never resolved — the «???» case.
 *
 * `humanStatus` and friends fall back to returning the raw value, so a missing
 * map entry shows up as the enum itself rather than as a placeholder. The enum
 * scan above catches those; this catches the other direction — an explicit
 * unresolved marker rendered into the page.
 */
export async function scanUnresolved(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const hits: string[] = [];
  if (text.includes('???')) hits.push('literal ???');
  if (/\bundefined\b/.test(text)) hits.push('literal undefined');
  if (/\bNaN\b/.test(text)) hits.push('literal NaN');
  if (/\[object Object\]/.test(text)) hits.push('[object Object]');
  return hits;
}

/** True when the document scrolls sideways — the phone-overflow failure. */
export async function hasHorizontalOverflow(page: Page): Promise<{ overflow: boolean; scrollW: number; clientW: number }> {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
}

/**
 * Is this control actually usable by a thumb?
 *
 * `visible` alone was not enough to catch sweep P0-4: the buttons were in the
 * DOM and merely zero-sized. The test is therefore geometric — a non-zero box,
 * inside the viewport, at least 24 px tall.
 */
export async function tappable(page: Page, selector: string): Promise<Array<{ text: string; w: number; h: number; inViewport: boolean }>> {
  return page.evaluate((sel) => {
    const out: Array<{ text: string; w: number; h: number; inViewport: boolean }> = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      out.push({
        text: (el.textContent ?? '').trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
        inViewport: r.left >= -1 && r.right <= window.innerWidth + 1,
      });
    }
    return out;
  }, selector);
}

/** Natural sizes of every <img> — a 0 means a broken image (sweep P0-5). */
export async function imageSizes(page: Page): Promise<Array<{ src: string; w: number; h: number }>> {
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images)
      .filter((i) => !i.complete)
      .map((i) => new Promise((r) => { i.onload = r; i.onerror = r; })));
  });
  return page.evaluate(() => Array.from(document.images).map((i) => ({
    src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight,
  })));
}

/** Every in-page link, absolute, deduped, same-origin only. */
export async function links(page: Page): Promise<string[]> {
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
    .map((a) => (a as HTMLAnchorElement).href));
  return [...new Set(hrefs)].filter((h) => h.startsWith('http'));
}
