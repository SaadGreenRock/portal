import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and puppeteer-core are native/node-only — keep them out of the bundle.
  serverExternalPackages: ["better-sqlite3", "puppeteer-core", "@sparticuz/chromium"],
  experimental: {
    // Signed scans from a phone camera can be several MB.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
