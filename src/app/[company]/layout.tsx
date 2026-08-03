import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { endSession, isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import WorkspaceNav from "@/components/WorkspaceNav";

/**
 * Workspace shell. Guards the password gate, resolves the company, and hands
 * the company's accent colours down as CSS variables so every screen inside
 * picks up the right brand without threading props around.
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

  if (!(await isAuthenticated())) {
    redirect(`/login?next=${encodeURIComponent(`/${slug}/vouchers/new`)}`);
  }

  const db = await store();
  // Both counts in one pass: the nav badges need them on every screen, and two
  // sequential round trips on a serverless request is a visible pause.
  //
  // The purchase order count is tolerated rather than awaited outright. It is
  // decoration on a tab; if that module isn't migrated on this database, the
  // badge disappears and vouchers carry on working.
  const [counts, poCounts] = await Promise.all([
    db.counts(company.slug),
    tryTable(() => db.poCounts(company.slug)),
  ]);

  async function signOut() {
    "use server";
    await endSession();
    redirect("/");
  }

  const t = company.theme;

  return (
    <div
      style={
        {
          "--accent": t.ui,
          "--accent-text": t.uiText,
          "--accent-wash": t.uiWash,
        } as React.CSSProperties
      }
      className="min-h-dvh"
    >
      <header className="border-b border-ink-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            title="Switch company"
            className="flex h-9 shrink-0 items-center rounded-md px-2.5"
            style={{ background: t.headerBar ?? "#f4f4f2" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={company.logo} alt={company.name} className="h-5 w-auto object-contain" />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-tight">{company.name}</div>
            <div className="text-[11.5px] leading-tight text-ink-soft">Company portal</div>
          </div>

          <form action={signOut}>
            <button type="submit" className="btn btn-quiet px-3 py-1.5 text-[13px]">
              Lock
            </button>
          </form>
        </div>

        <WorkspaceNav
          slug={company.slug}
          badges={{ vouchers: counts.pending, po: poCounts.ok ? poCounts.value.open : 0 }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
