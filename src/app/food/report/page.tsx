import ModuleUnavailable from "@/components/ModuleUnavailable";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { summariseFood, totalsByOrderedFor, totalsByVendor } from "@/lib/food/types";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * Food spend: everything to date, and over any window you choose.
 *
 * Both bounds inclusive, matching the SUMIFS in the spreadsheet this replaces —
 * a range of 14 to 31 July counts both the 14th and the 31st, which is what
 * anybody typing those dates means.
 *
 * The breakdowns are by vendor and by the "ordered for" label. Neither is a cost
 * allocation: a lunch ordered for both companies appears whole under "Green Rock
 * + Sportech", never halved into each. Splitting it would invent a number nobody
 * agreed to, and the label is a record of what was written on the order.
 */

const isoDate = (v: string | undefined): string =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";

export default async function FoodReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const from = isoDate(sp.from);
  const to = isoDate(sp.to);
  const ranged = Boolean(from || to);

  const db = await store();
  const [all, windowed] = await Promise.all([
    tryTable(() => db.foodInRange(null, null)),
    ranged ? tryTable(() => db.foodInRange(from || null, to || null)) : Promise.resolve(null),
  ]);
  if (!all.ok) return <ModuleUnavailable module="Food" />;

  const everything = all.value;
  const total = summariseFood(everything);

  // The rows the breakdowns describe: the chosen window when there is one,
  // everything otherwise. Falling back to `everything` on a failed windowed read
  // would silently report the wrong period, so an error there is fatal.
  const selected = windowed ? (windowed.ok ? windowed.value : null) : everything;
  if (selected === null) return <ModuleUnavailable module="Food" />;

  const period = summariseFood(selected);
  const byVendor = totalsByVendor(selected);
  const byOrderedFor = totalsByOrderedFor(selected);

  return (
    <>
      <div className="mb-5">
        <h2 className="text-[20px] font-bold tracking-tight">Food spend</h2>
        <p className="mt-1 text-[14px] text-ink-soft">
          Total expenditure to date, and over any date range. Dates are inclusive.
        </p>
      </div>

      <dl className="card mb-5 grid grid-cols-1 divide-y divide-ink-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4">
          <dt className="label">Total spent to date</dt>
          <dd className="mono mt-1 text-[24px] font-bold">₨ {formatMoney(total.spentAllTime)}</dd>
          <dd className="mt-1 text-[12.5px] text-ink-soft">
            {total.total} {total.total === 1 ? "entry" : "entries"}, settled and pending
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="label">
            {ranged ? "Spent in the selected period" : "Selected period"}
          </dt>
          <dd className="mono mt-1 text-[24px] font-bold">
            {ranged ? `₨ ${formatMoney(period.spentAllTime)}` : "—"}
          </dd>
          <dd className="mt-1 text-[12.5px] text-ink-soft">
            {ranged
              ? `${period.total} ${period.total === 1 ? "entry" : "entries"} · ${
                  from ? formatDate(from) : "the beginning"
                } to ${to ? formatDate(to) : "today"}`
              : "Pick a range below."}
          </dd>
        </div>
      </dl>

      {/* GET form: the range lives in the URL, so a period can be bookmarked. */}
      <form className="card mb-6 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label mb-1.5" htmlFor="from">
              Start date
            </label>
            <input id="from" name="from" type="date" defaultValue={from} className="input" />
          </div>
          <div>
            <label className="label mb-1.5" htmlFor="to">
              End date
            </label>
            <input id="to" name="to" type="date" defaultValue={to} className="input" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {ranged ? (
              <a href="/food/report" className="btn btn-ghost">
                Clear
              </a>
            ) : null}
          </div>
        </div>
      </form>

      {selected.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Nothing in that period.</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            Try a wider range, or clear it to see everything.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Breakdown
            title="By vendor"
            blurb={ranged ? "In the selected period." : "All time."}
            rows={byVendor}
            total={period.spentAllTime}
          />
          <Breakdown
            title="By who it was for"
            blurb="A label, not a cost split. Shared orders are counted whole."
            rows={byOrderedFor}
            total={period.spentAllTime}
          />
        </div>
      )}

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        Every entry counts towards these totals whether it has been settled or not — the food was
        eaten, so the expense was incurred. What is still owed is on the{" "}
        <a href="/food/outstanding" className="underline">
          Outstanding
        </a>{" "}
        screen. Deleted entries are excluded.
      </p>
    </>
  );
}

function Breakdown({
  title,
  blurb,
  rows,
  total,
}: {
  title: string;
  blurb: string;
  rows: Array<{ name: string; amount: number; count: number }>;
  total: number;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-ink-line px-5 py-4">
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">{blurb}</p>
      </header>
      <ul className="divide-y divide-ink-line">
        {rows.map((row) => {
          const share = total > 0 ? Math.round((row.amount / total) * 100) : 0;
          return (
            <li key={row.name} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{row.name}</span>
                <span className="mono shrink-0 text-[13.5px] font-semibold">
                  ₨ {formatMoney(row.amount)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {/* A bar rather than a chart: one dimension, already sorted, and
                    it needs no legend to be read at a glance. */}
                <span
                  aria-hidden
                  className="block h-1 rounded-full bg-[var(--accent)] opacity-70"
                  style={{ width: `${Math.max(share, 1)}%` }}
                />
                <span className="mono text-[11.5px] text-ink-soft">
                  {share}% · {row.count} {row.count === 1 ? "order" : "orders"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
