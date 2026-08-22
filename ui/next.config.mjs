/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver; keep it external so the server bundle uses the
  // real module rather than a webpack-mangled copy.
  serverExternalPackages: ['pg', 'drizzle-orm'],
  // The hero wow-clip upload (`uploadHeroClip`) posts an mp4 through a server
  // action; the default 1MB body cap would reject every real video.
  experimental: { serverActions: { bodySizeLimit: '200mb' } },
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
