/** @type {import('next').NextConfig} */
const FORECAST_API_URL = process.env.FORECAST_API_URL;

const nextConfig = {
  reactStrictMode: true,
  // If FORECAST_API_URL is configured (e.g. pointing to a deployed FastAPI service),
  // proxy /api/* directly to it. Otherwise, Next.js App Router route handlers
  // in app/api/forecast/* serve the endpoints natively (ideal for Vercel deployments).
  async rewrites() {
    if (FORECAST_API_URL) {
      return [
        {
          source: '/api/:path*',
          destination: `${FORECAST_API_URL}/api/:path*`,
        },
      ];
    }
    return [];
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
