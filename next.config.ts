import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must stay outside the bundle. It is
  // only reachable when BACKEND=local; on Vercel the Supabase backend is used
  // and this never loads.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
