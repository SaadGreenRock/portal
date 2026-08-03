import Link from "next/link";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";

/**
 * Landing screen. Choosing a company is the top-level act — the two workspaces
 * share nothing downstream, so this is a fork in the road rather than a filter.
 */
export default async function Landing() {
  const authed = await isAuthenticated();

  // Outstanding work is the one thing worth surfacing before you pick: which
  // workspace has vouchers waiting on a signed scan, and which has orders still
  // out with a vendor.
  const counts = authed
    ? await (async () => {
        const db = await store();
        const entries = await Promise.all(
          COMPANY_LIST.map(
            async (c) =>
              [
                c.slug,
                {
                  vouchers: await db.counts(c.slug),
                  // Tolerated: an unmigrated purchase order module must not
                  // stop the landing page from listing the companies.
                  po: await tryTable(() => db.poCounts(c.slug)),
                },
              ] as const,
          ),
        );
        return Object.fromEntries(entries);
      })()
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-5 py-16">
      <header className="mb-10">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">
          Company Portal
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft">
          Choose a company to open its workspace.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {COMPANY_LIST.map((company) => {
          const c = counts?.[company.slug];
          return (
            <Link
              key={company.slug}
              href={authed ? `/${company.slug}/vouchers/new` : `/login?next=/${company.slug}/vouchers/new`}
              className="group card flex flex-col gap-5 p-6 transition-shadow hover:shadow-[0_2px_16px_rgba(0,0,0,0.08)]"
              style={{ borderColor: "#e4e4e4" }}
            >
              <div
                className="flex h-20 items-center justify-center rounded-lg px-5"
                style={{ background: company.theme.headerBar ?? "#f4f4f2" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={company.logo}
                  alt={company.name}
                  className="max-h-11 w-auto max-w-full object-contain"
                />
              </div>

              <div>
                <div className="text-[17px] font-semibold">{company.name}</div>
                <div className="mono mt-1 text-[13px] text-ink-soft">
                  Vouchers · Purchase orders
                </div>
              </div>

              {c ? (
                <div className="space-y-1 text-[13px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={
                        c.vouchers.pending > 0 ? "font-semibold text-amber-700" : "text-ink-soft"
                      }
                    >
                      {c.vouchers.pending} awaiting signature
                    </span>
                    <span className="mono text-ink-soft">{c.vouchers.total}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={
                        c.po.ok && c.po.value.open > 0 ? "font-semibold text-ink" : "text-ink-soft"
                      }
                    >
                      {c.po.ok
                        ? `${c.po.value.open} open ${c.po.value.open === 1 ? "order" : "orders"}`
                        : "purchase orders not set up"}
                    </span>
                    <span className="mono text-ink-soft">{c.po.ok ? c.po.value.total : "—"}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[13px] text-ink-soft">Open workspace →</div>
              )}
            </Link>
          );
        })}
      </div>

      {authed ? (
        <Link
          href="/spend"
          className="card mt-4 flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_2px_16px_rgba(0,0,0,0.08)]"
        >
          <div>
            <div className="text-[15px] font-semibold">Expenditure</div>
            <div className="mt-0.5 text-[13px] text-ink-soft">
              Both companies together, and each on its own.
            </div>
          </div>
          <span className="shrink-0 text-[13px] text-ink-soft">Open →</span>
        </Link>
      ) : null}
    </main>
  );
}
