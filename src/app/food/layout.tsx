import Link from "next/link";
import { redirect } from "next/navigation";
import FoodNav from "@/components/FoodNav";
import HeaderControls from "@/components/HeaderControls";
import { isAuthenticated } from "@/lib/auth";
import { foodCounts } from "@/lib/db/per-request";
import { tryTable } from "@/lib/db/resilience";

/**
 * The food section's shell.
 *
 * Deliberately outside /[company], for the same reason /spend is: roughly a
 * quarter of the entries are one lunch ordered for both companies, so an entry
 * belongs to neither workspace and nesting the section under one would force
 * every shared order to pick a side.
 *
 * It has a layout where /spend does its guard inline because it is five screens
 * rather than one — the auth check and the tabs would otherwise be copied five
 * times, and the fifth copy is where one gets forgotten.
 *
 * The accent is inherited rather than set. Outside a workspace there is no
 * company theme to take one from, so `--accent` is left at the portal's own
 * teal — which globals.css already states, in both themes. Restating it here
 * would restate only the light half, and pin the section to it.
 */

export const metadata = {
  title: "Food & refreshments",
};

export default async function FoodLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");

  // Tolerated: an unmigrated food table must not stop the section from
  // rendering — the pages below say so properly, and a badge is not the place
  // to break the news.
  // Read through per-request: the log below reports these same figures in full,
  // so it joins this query rather than repeating it.
  const counts = await tryTable(() => foodCounts());
  const pending = counts.ok ? counts.value.pending : 0;

  return (
    <div>
      {/* sticky: Lock and the section tabs stay reachable on a long log,
          rather than scrolling away with it. */}
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[20px] font-bold tracking-tight">Food &amp; refreshments</h1>
              <p className="mt-0.5 text-[13.5px] text-ink-soft">
                Lunches, snacks and drinks. Both companies, one log.
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href="/food/new" className="btn btn-primary">
                New entry
              </Link>
              <HeaderControls />
            </div>
          </div>

          <div className="mt-4">
            <FoodNav pending={pending} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
