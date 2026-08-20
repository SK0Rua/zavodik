/** Check the header band's interactive states: the iterate form and mobile stickiness. */
import { chromium, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/romankudin/Developer/websites-factory';
const OUT = path.join(ROOT, 'docs/evidence');
const BASE = 'http://localhost:3000';
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const PASSWORD = /^UI_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 });
}

async function main() {
  const browser = await chromium.launch();

  // Desktop: the "another try" form opens in place of the button row.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE}/businesses/ui3-shot-demo`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ще спроба' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'ui3-card-iterate-1280.png'), fullPage: false });

  // Phone: scroll deep into the tabs — the band must still be on screen.
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await mob.newPage();
  await login(mp);
  await mp.goto(`${BASE}/businesses/ui3-shot-demo`, { waitUntil: 'networkidle' });
  await mp.evaluate(() => window.scrollTo(0, 900));
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: path.join(OUT, 'ui3-card-sticky-390.png'), fullPage: false });

  await browser.close();
  console.log('done');
}
main();
