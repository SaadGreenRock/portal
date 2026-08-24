import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { poCounts, rfqCounts, voucherCounts } from "@/lib/db/per-request";
import { tryTable } from "@/lib/db/resilience";
import HeaderControls from "@/components/HeaderControls";
import HomeButton from "@/components/HomeButton";
import WorkspaceNav from "@/components/WorkspaceNav";

/**
 * Workspace shell. Guards the password gate, resolves the company, and hands
 * the company's accent colours down as CSS variables so every screen inside
 * picks up the right brand without threading props around.
 *
 * Both of the company's accents go down, light and dark, and `.accent-scope`
 * in globals.css picks the one in force. Rendering here on the server, there is
 * no way to know which that is — the theme is settled in the browser before
 * paint — so the choice has to be left to CSS.
 */
export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  if (!(await isAuthenticated())) redirect("/login");

  // All three counts in one pass: the nav badges need them on every screen, and
  // sequential round trips on a serverless request are a visible pause.
  //
  // The purchase order count is tolerated rather than awaited outright. It is
  // decoration on a tab; if that module isn't migrated on this database, the
  // badge disappears and vouchers carry on working.
  //
  // Read through per-request, so the overview and Settings — which report these
  // same three figures in full — join these queries rather than repeating them.
  const [counts, orders, requests] = await Promise.all([
    voucherCounts(company.slug),
    tryTable(() => poCounts(company.slug)),
    tryTable(() => rfqCounts(company.slug)),
  ]);

  const t = company.theme;

  return (
    <div
      style={
        {
          "--accent-light": t.ui,
          "--accent-text-light": t.uiText,
          "--accent-wash-light": t.uiWash,
          "--accent-dark": t.uiDark,
          "--accent-text-dark": t.uiTextDark,
          "--accent-wash-dark": t.uiWashDark,
        } as React.CSSProperties
      }
      className="accent-scope min-h-dvh"
    >
      {/* sticky: the workspace nav and the Lock button stay reachable on a long
          history or expenditure list, rather than scrolling away with it. */}
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        {/* A tighter gap on a phone. This row carries the most of any header in
            the portal — a logo, the company, the clock and two buttons — and the
            eight pixels bought back here are eight the company's name keeps. */}
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          {/* The house leads here as it does on every other header, even though
              the logo beside it is also a link home. Two controls to one place
              is a wart, and the alternative was worse: this is the screen the
              operator is on all day, and it would have been the one place the
              way back was a company logo rather than the mark they have learned
              everywhere else. The redundancy costs a mis-click nothing — both
              doors open on the same room.

              Hidden below `sm`, which is the price of that and worth stating.
              This row carries more than any other header in the portal — a logo,
              the company, the clock and two buttons — and measured at a phone
              width the house takes the minimum this row needs from 373px to
              415px, which truncates "Green Rock" on anything narrower than a Pro
              Max. So on a phone the logo goes back to being the only door, which
              it already was and which sits in exactly this corner anyway. */}
          <HomeButton className="btn btn-quiet -ml-1.5 hidden shrink-0 p-2 sm:inline-flex" />

          <Link
            href="/"
            title="Switch company"
            // Both logos are drawn on transparency and neither is dark, so the
            // plate behind them is load-bearing rather than decorative: Green
            // Rock's is white and states its own dark teal, Sportech's is that
            // acid yellow and takes the theme's quiet fill — which is the pale
            // grey it has always had by day, and a dark one at night, where
            // yellow is finally the right way round.
            className={`flex h-9 shrink-0 items-center rounded-md px-2.5 ${
              t.headerBar ? "" : "bg-wash"
            }`}
            style={t.headerBar ? { background: t.headerBar } : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={company.logo} alt={company.name} className="h-5 w-auto object-contain" />
          </Link>

          {/* The company's name in words, and on a phone it goes too.
              Measured: with search in the header this row needs 413px to show
              "Green Rock" whole, so a 390px handset was clipping it to "Green
              Ro…". Of everything competing for that width this is the one piece
              that is already said twice — the logo immediately to its left reads
              GREEN ROCK — so it is what the search box is paid for with. The way
              to this company's overview is not lost with it: the Overview tab
              sits in the row directly below. */}
          <Link
            href={`/${company.slug}`}
            className="hidden min-w-0 flex-1 rounded-md transition-opacity hover:opacity-80 sm:block"
          >
            <div className="truncate text-[14px] font-semibold leading-tight">{company.name}</div>
            {/* Hidden on a phone, where it is the widest thing in this block and
                the least worth the room: it says "Company portal" underneath the
                company's own name, on a screen that is visibly the portal. Given
                `truncate` as well, so it can never spill out of a block it no
                longer fits — which it did, silently, before it had one. */}
            <div className="hidden truncate text-[11.5px] leading-tight text-ink-soft sm:block">
              Company portal
            </div>
          </Link>

          {/* Holds the controls at the right edge once the name above is gone,
              which is the only thing that was keeping them there. */}
          <span aria-hidden className="flex-1 sm:hidden" />

          <HeaderControls />
        </div>

        <WorkspaceNav
          slug={company.slug}
          badges={{
            vouchers: counts.pending,
            po: orders.ok ? orders.value.open : 0,
            rfq: requests.ok ? requests.value.open : 0,
          }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
