/** Business-card action bar: one shot per state it can be in. */
import { chromium, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/romankudin/Developer/websites-factory';
const OUT = path.join(ROOT, 'docs/evidence');
const BASE = 'http://localhost:3000';

const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const PASSWORD = /^UI_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';

/**
 * One business per state the action bar treats differently.
 *
 * Named after the STATE, not the salon: the point of the shot is what the header
 * offers in that state. Which business happens to be in it changes with every
 * pipeline run, so check the ids still resolve before trusting a re-run.
 */
const CARDS: Array<{ id: string; name: string }> = [
  { id: 'gr-patras-m-k-hair-studio-mykoniatis-konstantinos', name: 'mk-building' },
  { id: 'gr-patras-trendy-hair-a-a', name: 'site-in-progress' },
  { id: 'gr-patras-pagoulatos-luxury-hair-salon', name: 'site-ready' },
  { id: 'gr-patras-health-beauty', name: 'production-ready' },
  { id: 'gr-patras-female-secrets', name: 'needs-review-gaps' },
];

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 });
}

async function run(width: number, height: number, suffix: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${String(e).slice(0, 200)}`));

  await login(page);

  for (const c of CARDS) {
    await page.goto(`${BASE}/businesses/${c.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // Above the fold: the whole point is that the actions are here without scrolling.
    await page.screenshot({
      path: path.join(OUT, `ui3-card-${c.name}-${suffix}.png`),
      fullPage: false,
    });
  }

  // The «Інше…» sheet, opened from the header link.
  await page.goto(`${BASE}/businesses/${CARDS[0]!.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Інше…' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `ui3-card-other-${suffix}.png`), fullPage: false });

  console.log(`[${suffix}] console errors:`, errs.length ? errs : 'none');
  await browser.close();
}

async function main() {
  await run(1280, 900, '1280');
  await run(390, 844, '390');
  console.log('done');
}
main();
