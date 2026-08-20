/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver; keep it external so the server bundle uses the
  // real module rather than a webpack-mangled copy.
  serverExternalPackages: ['pg', 'drizzle-orm'],
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
