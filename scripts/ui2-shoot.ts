/** Drive the real console and capture evidence screenshots. */
import { chromium, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/romankudin/Developer/websites-factory';
const OUT = path.join(ROOT, 'docs/evidence');
const BASE = 'http://localhost:3000';

const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const PASSWORD = /^UI_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';

const MK = 'gr-patras-m-k-hair-studio-mykoniatis-konstantinos';

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 });
}

async function shoot(page: Page, url: string, name: string, opts: { full?: boolean } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: opts.full ?? true });
  const errs: string[] = [];
  return errs;
}

async function run(width: number, height: number, suffix: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 200)}`));

  await login(page);

  await shoot(page, '/inbox', `ui2-inbox-${suffix}`);
  await shoot(page, '/businesses', `ui2-businesses-${suffix}`);
  await shoot(page, `/businesses/${MK}`, `ui2-business-card-${suffix}`);
  await shoot(page, '/campaigns', `ui2-campaigns-${suffix}`);
  await shoot(page, '/settings', `ui2-settings-${suffix}`);
  await shoot(page, '/settings/system', `ui2-system-${suffix}`);

  console.log(`[${suffix}] console errors:`, consoleErrors.length ? consoleErrors : 'none');
  await browser.close();
}

async function main() {
  await run(1280, 900, 'desktop');
  await run(390, 844, 'phone');
  console.log('done');
}
main();
