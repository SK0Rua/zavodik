import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export. The factory serves the resulting out/ directory directly,
  // so NO server features are available: no route handlers, no server actions,
  // no ISR, no middleware, no next/image optimization.
  output: 'export',

  // Required with output: 'export' — there is no image optimization server.
  images: { unoptimized: true },

  trailingSlash: true,

  // This workspace gets copied to sites/<business_id>/ and built there, often
  // with other lockfiles above it in the tree. Pinning the tracing root to this
  // directory stops Next from walking up and picking a foreign lockfile as the
  // workspace root.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
