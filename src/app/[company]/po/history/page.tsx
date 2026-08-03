import Link from "next/link";
import { notFound } from "next/navigation";
import PoRow from "@/components/PoRow";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import type { PoQuery, PoStatus } from "@/lib/po/types";

const PAGE_SIZE = 25;

type Params = {
  q?: string;
  deleted?: string;
  status?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  page?: string;
};

const num = (v: string | undefined): number | undefined => {
  if (!v?.trim()) return undefined;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const STATUSES = new Set<string>(["draft", "issued", "closed", "cancelled", "open", "deleted"]);

export default async function PoHistory({
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

  const status = (STATUSES.has(sp.status ?? "") ? sp.status : "all") as PoQuery["status"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: PoQuery = {
    company: company.slug,
    q: sp.q,
    status,
    from: sp.from,
    to: sp.to,
    minAmount: num(sp.min),
    maxAmount: num(sp.max),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const { rows, total } = await db.searchPos(query);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || sp.from || sp.to || sp.min || sp.max || status !== "all");

  /** Keeps the current filters while changing one parameter (used for paging). */
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][],
    );
    next.set(key, value);
    return `?${next.toString()}`;
  };

  // Only meaningful when one currency is in play; mixing them would be nonsense.
  const currencies = new Set(rows.map((r) => r.doc.currency));
  const pageValue = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <>
      {sp.deleted ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">
            <span className="mono font-semibold">{sp.deleted}</span> was deleted. Its number
            stays spent and will not be reissued.
          </p>
          <Link
            href={`/${company.slug}/po/history?status=deleted`}
            className="btn btn-ghost px-3 py-1.5 text-[13px]"
          >
            View deleted
          </Link>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Purchase order history</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Every order ever raised for {company.name}.
          </p>
        </div>
        <p className="mono text-[13px] text-ink-soft">
          {total} {total === 1 ? "order" : "orders"}
          {filtered ? " matching" : ""}
          {currencies.size === 1 && pageValue > 0
            ? ` · this page ${[...currencies][0]} ${formatMoney(pageValue, [...currencies][0])}`
            : ""}
        </p>
      </div>

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
              placeholder="PO no., vendor, subject, note…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status} className="input">
              <option value="all">All</option>
              <option value="open">Open (draft + issued)</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label mb-1.5" htmlFor="min">
                Min total
              </label>
              <input id="min" name="min" defaultValue={sp.min ?? ""} inputMode="decimal" className="input" />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="max">
                Max total
              </label>
              <input id="max" name="max" defaultValue={sp.max ?? ""} inputMode="decimal" className="input" />
            </div>
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="from">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={sp.from ?? ""} className="input" />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="to">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={sp.to ?? ""} className="input" />
          </div>

          <div className="flex items-end gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            {filtered ? (
              <Link href={`/${company.slug}/po/history`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">
            {filtered ? "No orders match those filters." : "No purchase orders yet."}
          </p>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {filtered
              ? "Try widening the date or amount range."
              : `The first ${company.name} order will appear here once raised.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((po) => (
              <PoRow key={po.id} po={po} company={company.slug} />
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="mt-5 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link href={withParam("page", String(page - 1))} className="btn btn-ghost">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="mono text-[13px] text-ink-soft">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={withParam("page", String(page + 1))} className="btn btn-ghost">
                  Older →
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
