/**
 * BreachLoop — Next.js configuration
 *
 * The app is fully self-contained: the SOC console and every `/api/*` route are
 * served by a single Next.js runtime (Vercel serverless functions on the edge,
 * `next start` locally). No companion process, no proxy, no CORS hop.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Standalone output is opt-in: it is what a container image wants, but it makes
  // `next start` print a warning and is not needed on Vercel (which traces each
  // route itself). Set NEXT_OUTPUT=standalone for Docker-style deploys.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,

  // Scenario JSON is imported statically so it is traced into every API bundle;
  // `scenarios/` on disk stays the single source of truth.
  serverExternalPackages: [],

  eslint: {
    // Lint is a separate, explicit `npm run lint` step so a style-only finding
    // can never fail a production build or blank the SOC console.
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // API responses are consumed by the browser on the same origin only.
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'Access-Control-Allow-Origin', value: process.env.BREACHLOOP_API_CORS_ORIGIN ?? '' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
        ].filter((h) => h.value !== ''),
      },
    ];
  },
};

export default nextConfig;
