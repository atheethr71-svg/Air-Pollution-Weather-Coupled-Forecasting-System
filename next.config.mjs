/** @type {import('next').NextConfig} */
const FORECAST_API_URL = process.env.FORECAST_API_URL ?? 'http://127.0.0.1:8000';

const nextConfig = {
  reactStrictMode: true,
  // Proxy /api/* to the FastAPI forecast service so the browser sees a
  // same-origin API and no CORS configuration is needed in development.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${FORECAST_API_URL}/api/:path*`,
      },
    ];
  },
  // Deck.gl ships ESM with modern syntax; letting Next transpile it avoids
  // "unexpected token" failures in older browsers/build pipelines.
  transpilePackages: [
    'deck.gl',
    '@deck.gl/core',
    '@deck.gl/layers',
    '@deck.gl/aggregation-layers',
    '@deck.gl/mapbox',
  ],
};

export default nextConfig;
