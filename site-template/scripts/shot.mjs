/**
 * Self-screenshot: the builder agent's own eyes.
 *
 * Serves the static export (`out/`) on loopback and captures desktop + mobile
 * full-page screenshots into `_shots/`. The agent is REQUIRED to run this after
 * `pnpm build` and to Read the PNGs before writing result.json — the first
 * shipped demo was built without the agent ever seeing its own page (or any
 * reference image), and it showed.
 *
 * playwright-core only: no browser download at install time. The factory image
 * carries the browsers at PLAYWRIGHT_BROWSERS_PATH (/ms-playwright); on a host
 * without them this exits non-zero with a plain explanation, and the agent is
 * told that a failed shot is reportable, not fixable — do not fight the
 * environment, say so in result.json's selfReview.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const OUT = path.resolve('out');
const SHOTS = path.resolve('_shots');

if (!existsSync(path.join(OUT, 'index.html'))) {
  console.error('shot: out/index.html не існує — спершу `pnpm build`.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let p = path.join(OUT, decodeURIComponent(url.pathname));
    if (!p.startsWith(OUT)) { res.writeHead(403).end(); return; }
    if (p.endsWith('/') || !path.extname(p)) {
      p = existsSync(p + '.html') ? p + '.html' : path.join(p, 'index.html');
    }
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.error(
    'shot: браузер недоступний на цьому хості — крок самоперевірки пропущено. '
    + 'Це НЕ помилка збірки: напиши про це в selfReview і продовжуй. '
    + `(${String(err).split('\n')[0]})`,
  );
  server.close();
  process.exit(2);
}

await mkdir(SHOTS, { recursive: true });

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  // Walk the page so scroll-triggered reveals fire; then settle.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  await page.close();
  console.log(`shot: _shots/${name}.png готовий`);
}

await browser.close();
server.close();
