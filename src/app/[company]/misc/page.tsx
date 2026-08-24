import Link from "next/link";
import { notFound } from "next/navigation";
import MiscPaymentRow from "@/components/MiscPaymentRow";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { periodOf } from "@/lib/db/shared";
import { tryTable } from "@/lib/db/resilience";
import type { MiscQuery } from "@/lib/misc/types";
import { formatMoney } from "@/lib/money";

/**
 * The miscellaneous payment log: everything this company paid out with no
 * document behind it, newest first.
 *
 * Sorted by the date the money went out rather than by when the row was typed.
 * These are caught up on at the end of a week the way the food log is, and
 * sorting by creation would bury Tuesday's parking fee under Friday's session
 * of typing five of them in.
 *
 * Two figures across the top rather than four. There is no "owed" here — the
 * money has already gone — so the only questions left are how much of it there
 * was, and how much of it can be evidenced.
 */

const PAGE_SIZE = 25;

type Params = {
  q?: string;
  view?: string;
  from?: string;
  to?: string;
  page?: string;
  deleted?: string;
};

const VIEWS = new Set(["all", "with-proof", "no-proof", "deleted"]);

export default async function MiscLog({
  params,
  searchParams,
}: {
  params: Promise<{ company: string }>;
  searchParams: Promise<Params>;
}) {
  const { company: slug } = await params;
  const sp = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const view = (VIEWS.has(sp.view ?? "") ? sp.view : "all") as MiscQuery["view"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: MiscQuery = {
    company: company.slug,
    q: sp.q,
    view,
    from: sp.from,
    to: sp.to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const [listed, counted] = await Promise.all([
    tryTable(() => db.searchMisc(query)),
    tryTable(() => db.miscCounts(company.slug)),
  ]);
  if (!listed.ok || !counted.ok) return <ModuleUnavailable module="Miscellaneous payments" />;

  const { rows, total } = listed.value;
  const counts = counted.value;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || sp.from || sp.to || view !== "all");

  /** Keeps the current filters while changing one parameter (used for paging). */
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][],
    );
    next.set(key, value);
    return `?${next.toString()}`;
  };

  return (
    <>
      {sp.deleted ? (
        <div className="mb-5 rounded-xl border border-ink-line bg-card p-4">
          <p className="text-[13.5px]">
            <span className="mono font-semibold">{sp.deleted}</span> was deleted. Its number stays
            spent, and it no longer counts towards any total.
          </p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Miscellaneous payments</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Money out of {company.name} with no document behind it. Every one of these counts
            towards{" "}
            <Link href="/spend" className="underline">
              expenditure
            </Link>
            .
          </p>
        </div>
        <Link href={`/${company.slug}/misc/new`} className="btn btn-primary">
          New payment
        </Link>
      </div>

      {counts.total > 0 ? (
        <dl className="card mb-5 grid grid-cols-2 divide-ink-line sm:divide-x">
          <Stat
            label={counts.total === 1 ? "Payment logged" : "Payments logged"}
            value={
              // One line per currency, never a sum across them — Green Rock pays
              // some things in Riyals, so this is not hypothetical.
              counts.byCurrency.length === 0
                ? String(counts.total)
                : counts.byCurrency
                    .map((t) => `${t.currency} ${formatMoney(t.amount, t.currency)}`)
                    .join("  ·  ")
            }
          />
          {/* Not urgent, and deliberately not styled as a warning. Most of these
              will never have a receipt — that is the point of the module — so
              this is a fact about the file, not a queue to work through. */}
          <Stat
            label="Without a receipt"
            value={`${counts.withoutProof} of ${counts.total}`}
            href={counts.withoutProof > 0 ? "?view=no-proof" : undefined}
            company={company.slug}
          />
        </dl>
      ) : null}

      {/* GET form: filters live in the URL, so any view can be bookmarked. */}
      <form className="card mb-5 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label mb-1.5" htmlFor="q">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Payment no., or anything in the note…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="view">
              Show
            </label>
            <select id="view" name="view" defaultValue={view} className="input">
              <option value="all">Everything</option>
              <option value="with-proof">With a receipt</option>
              <option value="no-proof">Without a receipt</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {filtered ? (
              <Link href={`/${company.slug}/misc`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="from">
              Paid from
            </label>
            <input id="from" name="from" type="date" defaultValue={sp.from ?? ""} className="input" />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="to">
              Paid to
            </label>
            <input id="to" name="to" type="date" defaultValue={sp.to ?? ""} className="input" />
          </div>

          <p className="mono self-end text-[13px] text-ink-soft sm:col-span-2 lg:text-right">
            {total} {total === 1 ? "payment" : "payments"}
            {filtered ? " matching" : ""}
          </p>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">
            {view === "deleted"
              ? "Nothing in the bin."
              : filtered
                ? "No payments match those filters."
                : "Nothing logged yet."}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            {view === "deleted"
              ? "Deleted payments would appear here, with their numbers still spent."
              : filtered
                ? "Try a different search, or show everything."
                : `For the small payments nobody signs for. The first gets the number ${company.prefix}-MP-${periodOf()}-001.`}
          </p>
          {view === "deleted" || filtered ? null : (
            <Link href={`/${company.slug}/misc/new`} className="btn btn-primary mt-5">
              New payment
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((payment) => (
              <MiscPaymentRow key={payment.id} payment={payment} company={company.slug} />
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="mt-5 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link href={withParam("page", String(page - 1))} className="btn btn-ghost">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="mono text-[13px] text-ink-soft">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={withParam("page", String(page + 1))} className="btn btn-ghost">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

/** A figure, linked to the view that acts on it where that helps. */
function Stat({
  label,
  value,
  href,
  company,
}: {
  label: string;
  value: string;
  href?: string;
  company?: string;
}) {
  const body = (
    <>
      <dt className="label">{label}</dt>
      <dd className="mono mt-1 text-[13.5px]">{value}</dd>
    </>
  );

  if (href && company) {
    return (
      <Link href={`/${company}/misc${href}`} className="px-5 py-3.5 hover:bg-wash-soft">
        {body}
      </Link>
    );
  }
  return <div className="px-5 py-3.5">{body}</div>;
}
