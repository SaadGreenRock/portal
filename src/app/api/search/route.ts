import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { searchEverything } from "@/lib/search/run";

/**
 * What the search palette calls on every keystroke the debounce lets through.
 *
 * A route rather than a server action, because this is a read that returns data
 * to a component that stays put. Server actions are for writes and for
 * navigations; using one here would mean a POST per keystroke and a router
 * round-trip to render nothing new.
 *
 * Behind the same password gate as every screen. A 401 rather than a redirect:
 * the caller is fetch, not a browser following links, and an HTML lock screen
 * arriving where JSON was expected is the kind of thing that shows up as a
 * parse error three layers away.
 *
 * Never cached. The whole point is that a voucher written a minute ago is
 * findable, and a cached search is a search that lies about what exists.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Locked" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";

  try {
    const hits = await searchEverything(await store(), q);
    return Response.json({ hits });
  } catch (err) {
    // A module missing its tables is already tolerated inside searchEverything;
    // reaching here means something real. Say so with a status the palette can
    // show rather than letting it render an empty result, which reads as "there
    // is nothing" instead of "this did not work".
    const message = err instanceof Error ? err.message : "Search failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
