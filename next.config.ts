import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must stay outside the bundle. It is
  // only reachable when BACKEND=local; on Vercel the Supabase backend is used
  // and this never loads.
  serverExternalPackages: ["better-sqlite3"],

  experimental: {
    serverActions: {
      /**
       * Scans and invoices are uploaded through a server action, and the
       * framework default of 1 MB rejects an ordinary phone photo outright.
       *
       * 4.5 MB is not a preference — it is Vercel's hard ceiling on a function
       * request body, so there is no point allowing more. Photographs are
       * re-encoded in the browser to land far below it (see shrink-image.ts);
       * this only has to be high enough that our own 4 MB check is what refuses
       * an oversized file, with a message a person can act on, rather than the
       * framework refusing it with one they can't.
       */
      bodySizeLimit: "4.5mb",
    },
  },

  /**
   * The voucher screens used to sit directly under /[company]. They moved under
   * /[company]/vouchers when purchase orders arrived and the workspace needed
   * more than one module. These keep existing bookmarks and phone shortcuts
   * working — :company matches a single segment, so /green-rock/po/… can never
   * be caught by them.
   */
  async redirects() {
    return [
      { source: "/:company/new", destination: "/:company/vouchers/new", permanent: true },
      { source: "/:company/pending", destination: "/:company/vouchers/pending", permanent: true },
      { source: "/:company/history", destination: "/:company/vouchers/history", permanent: true },
      { source: "/:company/v/:id", destination: "/:company/vouchers/:id", permanent: true },
    ];
  },
};

export default nextConfig;
