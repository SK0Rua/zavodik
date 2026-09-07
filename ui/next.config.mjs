import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep standalone tracing scoped to this intentionally independent app.
  // Without this, an unrelated lockfile higher in the home directory can make
  // Next infer the wrong workspace root and omit or over-include runtime files.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  // `pg` is a native-ish driver; keep it external so the server bundle uses the
  // real module rather than a webpack-mangled copy.
  serverExternalPackages: ['pg', 'drizzle-orm'],
  // The hero wow-clip upload (`uploadHeroClip`) posts an mp4 through a server
  // action; the default 1MB body cap would reject every real video.
  experimental: { serverActions: { bodySizeLimit: '200mb' } },
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // factory/settings.ts imports './regions.js' (NodeNext-style extension, shared
  // verbatim with the backend build), but only regions.ts is copied into this
  // image (see ui/Dockerfile). Without this alias, webpack looks for a literal
  // regions.js file and fails.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.js', '.ts', '.tsx'],
    };
    return config;
  },
};

export default nextConfig;
