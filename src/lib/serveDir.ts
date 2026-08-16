/**
 * Tiny static file server for QA runs (Next.js export uses absolute /_next/...
 * paths, so file:// won't do). Serves a directory on an ephemeral port.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

export async function serveDir(root: string): Promise<{ url: string; close: () => void }> {
  const absRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let filePath = path.join(absRoot, urlPath);
      if (!filePath.startsWith(absRoot)) { res.writeHead(403); res.end(); return; }
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!existsSync(filePath)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'x-robots-tag': 'noindex, nofollow',
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500); res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}
