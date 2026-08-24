import Link from "next/link";
import { redirect } from "next/navigation";
import FundingNav from "@/components/FundingNav";
import HeaderControls from "@/components/HeaderControls";
import HomeButton from "@/components/HomeButton";
import { isAuthenticated } from "@/lib/auth";
import { allocatableItems } from "@/lib/db/per-request";
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
  // Read through per-request. This is the heaviest query in the portal, and
  // four of the five screens under this shell read it again — so they join this
  // one rather than opening a second.
  const items = await tryTable(() => allocatableItems());
  const queued = items.ok ? queue(items.value).length : 0;

  return (
    <div>
      {/* sticky: Lock and the section tabs stay reachable down a long ledger,
          rather than scrolling away with it. */}
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* The way back, at the start of the header rather than the end of
                it — see HomeButton. The negative margin pulls the glyph out to
                the container's own left edge, so it lines up with the content
                below rather than sitting a padding-width inside it. */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <HomeButton className="btn btn-quiet -ml-2.5 p-2.5" />
              <div className="min-w-0">
                <h1 className="text-[20px] font-bold tracking-tight">Funding &amp; tranches</h1>
                <p className="mt-0.5 text-[13.5px] text-ink-soft">
                  Dollars in, rupees out, and what each tranche paid for.
                </p>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href="/funding/new" className="btn btn-primary">
                New tranche
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
