/**
 * Drive the real console: click «Переглянути збірку» on the M.K card and prove
 * the preview iframe renders a STYLED page (not a blank/unstyled 200).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/romankudin/Developer/websites-factory';
const BASE = 'http://localhost:3000';
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const PASSWORD = /^UI_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const failed: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'));

  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await page.click('text=Переглянути збірку');
  await page.waitForSelector('iframe[title*="Збірка"]', { timeout: 30_000 });
  await page.waitForTimeout(4000);

  const frame = page.frames().find((f) => f.url().includes('/preview-'));
  if (!frame) throw new Error('preview frame did not appear');

  // Styled means: the stylesheet applied. A body that kept the UA default
  // background and a zero-height first section is the "200 but unstyled" case.
  const probe = await frame.evaluate(() => {
    const b = document.body;
    const cs = getComputedStyle(b);
    const h1 = document.querySelector('h1');
    return {
      url: location.href,
      sheets: document.styleSheets.length,
      bodyBg: cs.backgroundColor,
      bodyFont: cs.fontFamily.slice(0, 60),
      scrollHeight: b.scrollHeight,
      h1Text: (h1?.textContent ?? '').trim().slice(0, 60),
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      imgs: document.images.length,
      brokenImgs: Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length,
    };
  });

  console.log('PREVIEW PROBE', JSON.stringify(probe, null, 2));
  console.log('failed requests:', failed.length ? failed.slice(0, 8) : 'none');

  await page.screenshot({
    path: path.join(ROOT, 'docs/evidence/ui2-preview-mk.png'),
    fullPage: false,
  });

  await browser.close();
}
main();
