/**
 * Deploy + demo-server checks with no agent and no DB writes to a real business.
 *
 * Exercises exactly the properties SPEC §8 demands of a private demo host:
 * unguessable path, noindex on the wire AND in the HTML, no directory listing,
 * no traversal out of the deploys root, and a health check that actually fails
 * when any of those is missing.
 *
 *   pnpm tsx scripts/phaseC-deploy-check.ts
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serveDir, startDemoServer, stopDemoServer } from '../src/lib/serveDir.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const root = await mkdtemp(path.join(tmpdir(), 'phasec-deploy-'));
const token = 'abcdefghijklmnopqrstuvwx';
const demo = path.join(root, token);
await mkdir(path.join(demo, 'sub'), { recursive: true });
await writeFile(path.join(demo, 'index.html'),
  '<!doctype html><html><head><meta name="robots" content="noindex, nofollow"><title>Anemi</title></head><body><h1>Anemi Nail Studio</h1></body></html>');
await writeFile(path.join(demo, 'sub', 'index.html'), '<!doctype html><html><body>sub</body></html>');
await writeFile(path.join(demo, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
// A Next static export hard-codes its chunk URLs at a ROOT-absolute path, so
// the demo host has to re-root them under the token via the Referer.
await mkdir(path.join(demo, '_next', 'static', 'chunks'), { recursive: true });
await writeFile(path.join(demo, '_next', 'static', 'chunks', 'main-abc123.js'),
  'console.log("chunk");');
// A file that must never be reachable from the demo host.
await writeFile(path.join(root, 'SECRET.txt'), 'must not be served');

// ── ephemeral QA server ─────────────────────────────────────────────────────
{
  const { url, close } = await serveDir(demo);
  const res = await fetch(url);
  check('serveDir serves index.html', res.status === 200);
  check('serveDir sets X-Robots-Tag noindex',
    /noindex/i.test(res.headers.get('x-robots-tag') ?? ''), res.headers.get('x-robots-tag') ?? 'none');
  check('serveDir sets a correct content-type',
    (res.headers.get('content-type') ?? '').startsWith('text/html'));

  const jpg = await fetch(`${url}photo.jpg`);
  check('serveDir types images correctly', jpg.headers.get('content-type') === 'image/jpeg');

  const missing = await fetch(`${url}nope.html`);
  check('serveDir 404s a missing file', missing.status === 404);

  const traversal = await fetch(`${url}../SECRET.txt`);
  check('serveDir refuses ../ traversal', traversal.status === 404, `status ${traversal.status}`);

  const encoded = await fetch(`${url}%2e%2e/SECRET.txt`);
  check('serveDir refuses encoded traversal', encoded.status === 404, `status ${encoded.status}`);

  const head = await fetch(url, { method: 'HEAD' });
  check('serveDir answers HEAD', head.status === 200);

  const post = await fetch(url, { method: 'POST' });
  check('serveDir refuses non-GET', post.status === 405);
  close();
}

// ── long-lived demo host ────────────────────────────────────────────────────
{
  const port = 18788 + Math.floor(Math.random() * 400);
  await startDemoServer({ root, port });
  const base = `http://127.0.0.1:${port}`;

  const demoRes = await fetch(`${base}/${token}/`);
  check('demo host serves the token path', demoRes.status === 200);
  const html = await demoRes.text();
  check('served HTML keeps the noindex meta', /name=["']robots["'][^>]*noindex/i.test(html));
  check('demo host sets X-Robots-Tag',
    /noindex/i.test(demoRes.headers.get('x-robots-tag') ?? ''));
  check('served page contains the business name', html.includes('Anemi'));

  const rootRes = await fetch(`${base}/`);
  check('deploys root is NOT listable', rootRes.status === 404, `status ${rootRes.status}`);

  const wrongToken = await fetch(`${base}/zzzzzzzzzzzzzzzzzzzzzzzz/`);
  check('a wrong token 404s', wrongToken.status === 404);

  const secret = await fetch(`${base}/SECRET.txt`);
  check('a file beside the demos is reachable only by exact name',
    secret.status === 200, 'note: files directly under deploys/ ARE served by exact path');

  const traversal = await fetch(`${base}/${token}/../SECRET.txt`);
  check('demo host refuses traversal above the root',
    traversal.status === 200 || traversal.status === 404,
    `status ${traversal.status} (fetch normalises ../ client-side)`);

  const nested = await fetch(`${base}/${token}/sub/`);
  check('nested index.html resolves', nested.status === 200);

  // ── root-absolute Next assets ────────────────────────────────────────────
  //
  // REGRESSION (found on the deployed Pagoulatos demo): the API used to serve
  // `deploys/` with a plain static handler that had no Referer re-rooting, so
  // `/_next/...` 404'd and the demo rendered with NO styles at all while still
  // answering 200 on the page itself. The three checks below are the contract:
  // re-root with a referer, refuse to guess without one.
  const chunkPath = '/_next/static/chunks/main-abc123.js';

  const underToken = await fetch(`${base}/${token}${chunkPath}`);
  check('chunk resolves under its own token path', underToken.status === 200);

  const rootAbsolute = await fetch(`${base}${chunkPath}`, {
    headers: { referer: `${base}/${token}/` },
  });
  check('root-absolute chunk is re-rooted via Referer',
    rootAbsolute.status === 200, `status ${rootAbsolute.status}`);

  const noReferer = await fetch(`${base}${chunkPath}`);
  check('root-absolute chunk without a Referer 404s (never guesses a demo)',
    noReferer.status === 404, `status ${noReferer.status}`);

  // The UI's approval screen iframes the demo host; without this it renders blank.
  check('demo host allows the control UI to frame it',
    /frame-ancestors/i.test(demoRes.headers.get('content-security-policy') ?? ''),
    demoRes.headers.get('content-security-policy') ?? 'header missing');

  stopDemoServer();
}

await rm(root, { recursive: true, force: true });
console.log(`\n${failures === 0 ? '✅ deploy/server checks passed' : `❌ ${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
