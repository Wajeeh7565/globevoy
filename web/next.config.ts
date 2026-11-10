import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/react',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false
};

export default nextConfig;
