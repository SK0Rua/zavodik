/**
 * Static file serving for demos.
 *
 * Two users:
 *   - `serveDir(dir)`     — ephemeral server on a random port, used by visual QA.
 *                           A Next.js export references absolute `/_next/...`
 *                           paths, so `file://` cannot be used.
 *   - `startDemoServer()` — the long-lived demo host on DEMO_PORT that serves
 *                           `deploys/<token>/` (SPEC §4 stage 12, §8).
 *
 * Both send `X-Robots-Tag: noindex, nofollow` on every response and refuse
 * directory listings. The demo server additionally refuses to serve the deploys
 * root itself, so the set of live tokens cannot be enumerated.
 *
 * ## The absolute-path problem (found by looking at a real deployed demo)
 *
 * A Next.js static export hard-codes its asset URLs with a LEADING SLASH:
 * `/_next/static/...`, and the page's own `/assets/...` and `/generated/...`.
 * Served from its own root that is correct. Served from `/<token>/` — which is
 * what an unguessable private URL requires — the browser asks for `/_next/...`
 * at the deploys root, where nothing exists. The result is a page that returns
 * HTTP 200 while rendering completely unstyled, with every font, chunk and photo
 * 404ing. A status-code health check sees nothing wrong.
 *
 * Rewriting the exported files does not fix it either: Next's client runtime
 * rebuilds chunk URLs from an internal assetPrefix at run time, so hydration
 * requests the absolute path regardless of what the HTML says.
 *
 * So it is fixed HERE, where the mapping is unambiguous: an absolute asset
 * request is resolved against the demo that the requesting page belongs to,
 * identified by the token in its Referer. No referer means no guess and a 404 —
 * guessing would serve one business's photos inside another's demo.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from './../config.js';
import { log } from './logger.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

/** Every demo response carries the same private-by-default headers. */
const PRIVATE_HEADERS = {
  'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
  'referrer-policy': 'no-referrer-when-downgrade', // same-origin referer is what re-roots assets
  'cache-control': 'private, max-age=0, must-revalidate',
} as const;

/**
 * The approval screen in the control UI embeds a demo in an iframe, so the demo
 * host must name that origin in `frame-ancestors` — but only the demo host:
 * `serveDir()` is an ephemeral QA server nobody frames. Read at request time,
 * because `config.*` are getters backed by the settings table (CLAUDE.md).
 */
function demoFrameAncestors(): string {
  return `frame-ancestors 'self' ${config.ui.baseUrl}`;
}

/** Paths a Next export emits root-absolutely; they must be re-rooted per demo. */
const ROOT_ABSOLUTE_ASSET = /^\/(_next|assets|generated)\//;

/**
 * A deploy token: the 24-char slug `deploy.ts` mints, or a `preview-<n>` mount.
 *
 * Previews are named rather than random on purpose: they are not private URLs
 * handed to anyone, they are a read-only window the authenticated console opens
 * onto a build that never deployed (`needs_human_review`). They are served from
 * the workspace's `out/`, which the GC keeps for exactly that state.
 */
const DEMO_TOKEN = /^(?:[a-z0-9]{16,}|preview-\d+)$/i;

/** `preview-<projectId>` → the workspace `out/` registered for that project. */
const previewRoots = new Map<string, string>();

/**
 * Publish a built workspace under `/preview-<projectId>/` on the demo server.
 *
 * Deliberately reuses the demo server rather than adding a second static host:
 * a Next export asks for its chunks at a ROOT-absolute `/_next/...`, and the
 * Referer-based re-rooting in this file is the only implementation that answers
 * those correctly from a sub-path. A preview served by anything else renders
 * completely unstyled — the exact failure `deploy.ts` documents.
 */
export function registerPreview(projectId: number, outDir: string): string {
  const token = `preview-${projectId}`;
  previewRoots.set(token, path.resolve(outDir));
  return token;
}

export function unregisterPreview(projectId: number): void {
  previewRoots.delete(`preview-${projectId}`);
}

/**
 * Resolve a request against a registered preview mount, when its first path
 * segment names one. Returns null for every other path, so this can be tried
 * before the deploys root without shadowing it.
 */
function resolvePreview(urlPath: string): string | null {
  const [token, ...rest] = urlPath.split('/').filter(Boolean);
  if (!token) return null;
  const root = previewRoots.get(token);
  if (!root) return null;
  return resolveFile(root, `/${rest.join('/')}`);
}

/**
 * Resolve a URL path inside `root`, refusing traversal. Returns null when the
 * request escapes the root or names nothing servable.
 */
function resolveFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]!.split('#')[0]!);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const candidate = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  // path.resolve + the separator check is what stops `../` and symlink-ish escapes.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  if (!existsSync(candidate)) {
    // Next.js `trailingSlash: true` exports `about/index.html`; also try `about.html`.
    const asHtml = `${candidate}.html`;
    return existsSync(asHtml) ? asHtml : null;
  }
  if (statSync(candidate).isDirectory()) {
    const index = path.join(candidate, 'index.html');
    return existsSync(index) ? index : null; // never list a directory
  }
  return candidate;
}

/**
 * Which demo an absolute asset request belongs to, from the Referer of the page
 * that asked for it. Null when there is no usable referer.
 */
function demoTokenFor(req: http.IncomingMessage): string | null {
  const referer = req.headers.referer;
  if (!referer) return null;
  try {
    const token = new URL(referer).pathname.split('/').filter(Boolean)[0];
    return token && DEMO_TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

type ExtraHeaders = Record<string, string>;

function sendFile(res: http.ServerResponse, filePath: string, extra: ExtraHeaders = {}): void {
  const stat = statSync(filePath);
  res.writeHead(200, {
    ...PRIVATE_HEADERS,
    ...extra,
    'content-type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
  });
  createReadStream(filePath).pipe(res);
}

function deny(res: http.ServerResponse, code: number, body = '', extra: ExtraHeaders = {}): void {
  res.writeHead(code, { ...PRIVATE_HEADERS, ...extra, 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function headOnly(res: http.ServerResponse, filePath: string, extra: ExtraHeaders = {}): void {
  res.writeHead(200, {
    ...PRIVATE_HEADERS,
    ...extra,
    'content-type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  });
  res.end();
}

/** Ephemeral server for one directory. Used by visual QA; closed after the run. */
export async function serveDir(root: string): Promise<{ url: string; port: number; close: () => void }> {
  const absRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405);
      const file = resolveFile(absRoot, req.url ?? '/');
      if (!file) return deny(res, 404, 'not found');
      if (req.method === 'HEAD') return headOnly(res, file);
      sendFile(res, file);
    } catch {
      deny(res, 500);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/`, port, close: () => server.close() };
}

let demoServer: http.Server | null = null;

/**
 * The demo host: serves `deploys/<token>/...` on DEMO_PORT, bound to loopback.
 * The deploys root itself 404s — knowing the host does not reveal the tokens.
 * Exposure to the internet is a tunnel/reverse-proxy decision (SPEC §8), never
 * something this process does on its own.
 */
export async function startDemoServer(opts: { root?: string; port?: number; host?: string } = {}): Promise<http.Server> {
  if (demoServer) return demoServer;
  const root = path.resolve(opts.root ?? process.env.DEPLOYS_DIR ?? 'deploys');
  const port = opts.port ?? config.demoPort;
  const host = opts.host ?? process.env.DEMO_HOST ?? '127.0.0.1';

  const server = http.createServer((req, res) => {
    const extra = { 'content-security-policy': demoFrameAncestors() };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, '', extra);
      const urlPath = (req.url ?? '/').split('?')[0]!;
      // A bare "/" (or anything that resolves to the root) must not enumerate demos.
      if (urlPath === '/' || urlPath === '') return deny(res, 404, 'not found', extra);

      // Preview mounts first: `/preview-<projectId>/...` is served from the
      // workspace `out/`, never from the deploys root.
      let file = resolvePreview(urlPath) ?? resolveFile(root, urlPath);

      // Root-absolute asset emitted by a Next export: re-root it under the demo
      // whose page issued the request. See the module header for why this cannot
      // be fixed by rewriting the exported files.
      if (!file && ROOT_ABSOLUTE_ASSET.test(urlPath)) {
        const token = demoTokenFor(req);
        // A preview page's assets resolve inside its own mount, a deployed
        // demo's inside the deploys root. Same mechanism, two roots.
        if (token) file = resolvePreview(`/${token}${urlPath}`) ?? resolveFile(root, `/${token}${urlPath}`);
      }

      if (!file) return deny(res, 404, 'not found', extra);
      if (req.method === 'HEAD') return headOnly(res, file, extra);
      sendFile(res, file, extra);
    } catch {
      deny(res, 500, '', extra);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
  });
  demoServer = server;
  log.info('demo server listening', { host, port, root });
  return server;
}

/**
 * Start the demo server if it is not already up in this process, and tolerate
 * the port being held by another process (the compose container, `pnpm all`) —
 * in that case the deploy health check still exercises the real server.
 */
export async function ensureDemoServer(): Promise<void> {
  if (demoServer) return;
  try {
    await startDemoServer();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
      log.info('demo port already served by another process', { port: config.demoPort });
      return;
    }
    throw err;
  }
}

export function stopDemoServer(): void {
  demoServer?.close();
  demoServer = null;
}
