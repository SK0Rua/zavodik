/**
 * Evidence shot: the Факти tab, in Ukrainian.
 *
 *   pnpm tsx scripts/shoot-facts-ua.ts [businessId] [outPath]
 *
 * Read-only against the running UI — it logs in, opens one business card's
 * Факти tab, and captures it. It enqueues nothing and writes nothing to the
 * database.
 *
 * It also fails loudly if the panels it is shooting still contain Greek or a
 * run of English words, so the screenshot cannot quietly show the old state.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const businessId = process.argv[2] ?? 'GR-patras-beautify-laser-beauty-more';
const outPath = process.argv[3] ?? 'docs/evidence/ui4-facts-ua.png';
const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const PASSWORD = process.env.UI_PASSWORD ?? '';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
if (await page.locator('input[type="password"]').count()) {
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

await page.goto(`${BASE}/businesses/${businessId}`, { waitUntil: 'networkidle' });
// The tab is a client control; click it by its label rather than by an index.
const tab = page.getByRole('button', { name: /Факти/ }).first();
if (await tab.count()) await tab.click();
await page.waitForTimeout(1_200);

const bodyText = await page.evaluate(() => document.body?.innerText ?? '');

/**
 * Guard against a green run on the wrong page.
 *
 * The first version of this script "passed" against a 404: the business id no
 * longer resolved, none of the panels were on the page, the per-panel loop had
 * nothing to iterate, and it printed a tick over a screenshot of «Не знайдено».
 * A check that cannot fail when its subject is missing is not a check — so the
 * page must PROVE it is a business card before anything is asserted about it.
 */
if (/Не знайдено|Такої сторінки/.test(bodyText)) {
  console.error(`❌ ${businessId} does not resolve — the page is a 404, not a business card`);
  await browser.close();
  process.exit(1);
}
if (!bodyText.includes('Факти')) {
  console.error('❌ no Факти tab on the page — wrong page, or the card failed to render');
  await browser.close();
  process.exit(1);
}

/** Panels whose text must now be Ukrainian, by their heading. */
const PANELS = ['Що фабрика не знайшла', 'Перевірка фактів', 'Їхній нинішній сайт'];
// At least one of them must actually be present, or there is nothing to prove.
if (!PANELS.some((h) => bodyText.includes(h))) {
  console.error(
    `❌ none of the note panels are on this card (${PANELS.join(' / ')}) — `
    + 'pick a business that has gaps, an audit or a QA report',
  );
  await browser.close();
  process.exit(1);
}

const problems: string[] = [];
for (const heading of PANELS) {
  if (!bodyText.includes(heading)) continue;
  const start = bodyText.indexOf(heading);
  // Up to the next panel heading, or 1200 chars — enough to cover one panel.
  const rest = bodyText.slice(start + heading.length, start + 1_200);
  const visible = rest.split('оригінал')[0] ?? rest;   // the fold is meant to be foreign
  if (/[Ͱ-Ͽ]/.test(visible)) problems.push(`${heading}: Greek text still visible`);
  // Four+ consecutive English words = an untranslated sentence, not a brand name.
  const english = visible.match(/\b[A-Za-z][a-z]{2,}\b(?:\s+\b[A-Za-z][a-z]{2,}\b){3,}/);
  if (english) problems.push(`${heading}: English run "${english[0].slice(0, 60)}"`);
}

await mkdir(path.dirname(outPath), { recursive: true });
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`shot: ${outPath}`);
if (problems.length) {
  console.error(`\n❌ untranslated text still on the page:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('✅ Факти panels are Ukrainian (originals folded away)');
