import Link from "next/link";
import FoodEntryRow from "@/components/FoodEntryRow";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import type { FoodQuery } from "@/lib/food/types";
import { formatMoney } from "@/lib/money";

/**
 * The food log: every order, newest first.
 *
 * Sorted by the date the food was ordered rather than by when the row was typed.
 * The log is read as a diary and is often caught up on a few days late; sorting
 * by creation would bury Friday's lunch under Monday's catch-up.
 *
 * The four figures across the top are the ones the spreadsheet computed with
 * SUMIFS, in the order they are asked about: what we have spent, then what we
 * still owe and to whom.
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

const VIEWS = new Set(["all", "pending", "paid", "deleted"]);

export default async function FoodLog({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;

  const view = (VIEWS.has(sp.view ?? "") ? sp.view : "all") as FoodQuery["view"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: FoodQuery = {
    q: sp.q,
    view,
    from: sp.from,
    to: sp.to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const [listed, counted] = await Promise.all([
    tryTable(() => db.searchFood(query)),
    tryTable(() => db.foodCounts()),
  ]);
  if (!listed.ok || !counted.ok) return <ModuleUnavailable module="Food" />;

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
        <div className="mb-5 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">
            <span className="mono font-semibold">{sp.deleted}</span> was deleted. Its number stays
            spent, and it no longer counts towards any total.
          </p>
        </div>
      ) : null}

      {counts.total > 0 ? (
        <dl className="card mb-5 grid grid-cols-2 divide-ink-line sm:grid-cols-4 sm:divide-x">
          <Stat label="Spent to date" value={`₨ ${formatMoney(counts.spentAllTime)}`} />
          <Stat
            label="Owed to vendors"
            value={`₨ ${formatMoney(counts.owedToVendors)}`}
            urgent={counts.owedToVendors > 0}
            href="/food/outstanding"
          />
          <Stat
            label="Owed to employees"
            value={`₨ ${formatMoney(counts.owedToEmployees)}`}
            urgent={counts.owedToEmployees > 0}
            href="/food/outstanding"
          />
          <Stat
            label={counts.pending === 1 ? "Order pending" : "Orders pending"}
            value={String(counts.pending)}
            href="?view=pending"
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
              placeholder="Vendor, order, who it was for…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="view">
              Show
            </label>
            <select id="view" name="view" defaultValue={view} className="input">
              <option value="all">Everything</option>
              <option value="pending">Still owed</option>
              <option value="paid">Settled</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {filtered ? (
              <Link href="/food" className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="from">
              Ordered from
            </label>
            <input id="from" name="from" type="date" defaultValue={sp.from ?? ""} className="input" />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="to">
              Ordered to
            </label>
            <input id="to" name="to" type="date" defaultValue={sp.to ?? ""} className="input" />
          </div>

          <p className="mono self-end text-[13px] text-ink-soft sm:col-span-2 lg:text-right">
            {total} {total === 1 ? "entry" : "entries"}
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
                ? "No entries match those filters."
                : "Nothing logged yet."}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            {view === "deleted"
              ? "Deleted entries would appear here, with their numbers still spent."
              : filtered
                ? "Try a different search, or show everything."
                : "The first entry gets the number F-" +
                  new Date().getFullYear() +
                  String(new Date().getMonth() + 1).padStart(2, "0") +
                  "-001."}
          </p>
          {view === "deleted" || filtered ? null : (
            <Link href="/food/new" className="btn btn-primary mt-5">
              Log the first entry
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((entry) => (
              <FoodEntryRow key={entry.id} entry={entry} />
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

/** A figure, linked to whatever screen acts on it where that helps. */
function Stat({
  label,
  value,
  href,
  urgent,
}: {
  label: string;
  value: string;
  href?: string;
  urgent?: boolean;
}) {
  const body = (
    <>
      <dt className="label">{label}</dt>
      <dd className={`mono mt-1 text-[13.5px] ${urgent ? "font-semibold text-amber-700" : ""}`}>
        {value}
      </dd>
    </>
  );

  if (href) {
    return (
      <Link href={href.startsWith("?") ? `/food${href}` : href} className="px-5 py-3.5 hover:bg-[#fafaf8]">
        {body}
      </Link>
    );
  }
  return <div className="px-5 py-3.5">{body}</div>;
}
