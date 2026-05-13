/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  async rewrites() {
    return [
      {
        source: '/api/image-assets/:path*',
        destination: 'http://127.0.0.1:8790/image-assets/:path*',
      },
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8787/:path*',
      },
      {
        source: '/image-api/:path*',
        destination: 'http://127.0.0.1:8790/:path*',
      },
      {
        source: '/control-api/:path*',
        destination: 'http://127.0.0.1:8790/:path*',
      },
      {
        source: '/hotspot-api/:path*',
        destination: 'http://127.0.0.1:8789/:path*',
      },
      {
        source: '/x-api/:path*',
        destination: 'http://127.0.0.1:8788/:path*',
      },
      {
        source: '/x-traditional-api/:path*',
        destination: 'http://127.0.0.1:8791/:path*',
      },
    ];
  },
};

export default nextConfig;
