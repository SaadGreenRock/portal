import { NextResponse } from "next/server";
import { touchSession } from "@/lib/auth";

/**
 * Pushes the idle window out while somebody is actually using the portal.
 *
 * The counterpart to `IdleLock` in the browser, and the only thing in the portal
 * that renews a session. It exists as a route rather than living inside the
 * pages because a page cannot write a cookie — and because it must be reachable
 * *only* on purpose. Renewing on every request that arrived would renew on
 * prefetches and background revalidations, which are the framework being busy
 * rather than a person being present, and a portal that stays unlocked because
 * a tab is open is the thing this was built to stop.
 *
 * POST, not GET, for the same reason: nothing should be able to extend a session
 * by being navigated to, embedded, or prefetched.
 *
 * 401 is the answer that matters. It means the window had already closed, the
 * cookie was not renewed, and the browser should lock the screen — see
 * `touchSession` for why an expired session is never revived.
 */
export async function POST() {
  const alive = await touchSession();

  return NextResponse.json(
    { alive },
    {
      status: alive ? 200 : 401,
      // Never cached anywhere: the answer is about this instant, and a stored
      // 200 would tell a locked tab it was fine.
      headers: { "cache-control": "no-store" },
    },
  );
}
