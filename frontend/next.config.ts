import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both routes are fully client-rendered (all data comes from the Go
  // backend at runtime) — no API routes, no middleware, no server-only
  // features — so a static export deploys as a plain CDN static site
  // instead of needing a Node server. "next dev" is unaffected; this only
  // changes what "next build" produces.
  output: 'export',
  images: {
    unoptimized: true,
  },
  devIndicators: false,
};

export default nextConfig;
