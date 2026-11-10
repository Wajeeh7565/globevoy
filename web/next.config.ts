import type { NextConfig } from 'next';
import path from 'node:path';
import fs from 'node:fs';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/react',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  webpack(config, { webpack }) {
    const productionPolicy = process.env.GLOBEVOY_PRODUCTION_POLICY_MODULE;
    if (productionPolicy) {
      if (!path.isAbsolute(productionPolicy) || !fs.existsSync(productionPolicy)) {
        throw new Error('Production policy module must exist at an absolute build-time path.');
      }
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /(?:^|[\\/])frontend[\\/]runtime[\\/]environment-policy\.js$/,
        (resource: { request: string }) => { resource.request = productionPolicy; }
      ));
    }
    return config;
  }
};

export default nextConfig;
