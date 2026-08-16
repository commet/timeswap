import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@timeswap/engine'],
  output: 'export',
};

export default nextConfig;
