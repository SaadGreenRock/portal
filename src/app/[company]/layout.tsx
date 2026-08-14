import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import LockButton from "@/components/LockButton";
import ThemeToggle from "@/components/ThemeToggle";
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

  const db = await store();
  // Both counts in one pass: the nav badges need them on every screen, and two
  // sequential round trips on a serverless request is a visible pause.
  //
  // The purchase order count is tolerated rather than awaited outright. It is
  // decoration on a tab; if that module isn't migrated on this database, the
  // badge disappears and vouchers carry on working.
  const [counts, poCounts, rfqCounts] = await Promise.all([
    db.counts(company.slug),
    tryTable(() => db.poCounts(company.slug)),
    tryTable(() => db.rfqCounts(company.slug)),
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
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
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

          <Link
            href={`/${company.slug}`}
            className="min-w-0 flex-1 rounded-md transition-opacity hover:opacity-80"
          >
            <div className="truncate text-[14px] font-semibold leading-tight">{company.name}</div>
            <div className="text-[11.5px] leading-tight text-ink-soft">Company portal</div>
          </Link>

          <ThemeToggle />
          <LockButton />
        </div>

        <WorkspaceNav
          slug={company.slug}
          badges={{
            vouchers: counts.pending,
            po: poCounts.ok ? poCounts.value.open : 0,
            rfq: rfqCounts.ok ? rfqCounts.value.open : 0,
          }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
