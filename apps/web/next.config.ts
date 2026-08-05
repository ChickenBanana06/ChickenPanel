import type { NextConfig } from 'next';

const apiOrigin = process.env.NEXPANEL_API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
