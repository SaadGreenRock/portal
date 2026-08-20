import Link from "next/link";
import { redirect } from "next/navigation";
import FundingNav from "@/components/FundingNav";
import HeaderControls from "@/components/HeaderControls";
import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { queue } from "@/lib/tranches/types";

/**
 * The funding section's shell.
 *
 * Outside /[company] for the same reason /spend and /food are: a tranche pays
 * for expenses in both companies, so nesting it under one would force every
 * bucket to pick a side it does not have.
 *
 * A layout rather than a guard repeated inline, because this is six screens: the
 * auth check and the tabs would otherwise be copied six times, and the sixth
 * copy is where one gets forgotten.
 *
 * The accent is inherited rather than set. Outside a workspace there is no
 * company theme to take one from, so `--accent` stays at the portal's own teal,
 * which globals.css already states in both themes — restating it here would
 * restate only the light half and pin the section to it.
 */

export const metadata = {
  title: "Funding & tranches",
};

export default async function FundingLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");

  // Tolerated: an unmigrated funding table must not stop the section from
  // rendering. The pages below say so properly through ModuleUnavailable, and a
  // badge is not the place to break that news.
  const db = await store();
  const items = await tryTable(() => db.allocatable());
  const queued = items.ok ? queue(items.value).length : 0;

  return (
    <div>
      {/* sticky: Lock and the section tabs stay reachable down a long ledger,
          rather than scrolling away with it. */}
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[20px] font-bold tracking-tight">Funding &amp; tranches</h1>
              <p className="mt-0.5 text-[13.5px] text-ink-soft">
                Dollars in, rupees out, and what each tranche paid for.
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href="/funding/new" className="btn btn-primary">
                New tranche
              </Link>
              <Link href="/" className="btn btn-ghost">
                ← Companies
              </Link>
              <HeaderControls />
            </div>
          </div>

          <div className="mt-4">
            <FundingNav queued={queued} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
