import Link from "next/link";
import { notFound } from "next/navigation";
import HoldingRow from "@/components/HoldingRow";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import type { HoldingQuery } from "@/lib/assets/types";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate } from "@/lib/format";

/**
 * Company-wide holding history: who had what, from when to when.
 *
 * Lists holdings rather than assets, so the same laptop appears once per person
 * who has had it. That is the point — the register answers "where is it now",
 * and this answers "who had it then".
 *
 * The date filter matches any holding that *overlaps* the window rather than one
 * that began inside it. Asked who had something in August, an operator means
 * anyone who had it during August, including the person who took it in July and
 * still has it.
 */

const PAGE_SIZE = 25;

type Params = {
  q?: string;
  view?: string;
  from?: string;
  to?: string;
  page?: string;
};

const VIEWS = new Set(["all", "open", "closed"]);

export default async function AssetHistory({
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

  const view = (VIEWS.has(sp.view ?? "") ? sp.view : "all") as HoldingQuery["view"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: HoldingQuery = {
    company: company.slug,
    q: sp.q,
    view,
    from: sp.from,
    to: sp.to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const listed = await tryTable(() => db.searchHoldings(query));
  if (!listed.ok) return <ModuleUnavailable module="Assets" />;

  const { rows, total } = listed.value;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || sp.from || sp.to || view !== "all");

  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][],
    );
    next.set(key, value);
    return `?${next.toString()}`;
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Holding history</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Who had which {company.name} asset, and for how long.
          </p>
        </div>
        <p className="mono text-[13px] text-ink-soft">
          {total} {total === 1 ? "holding" : "holdings"}
          {filtered ? " matching" : ""}
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
              placeholder="Employee, employee no., asset no., asset…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="view">
              Show
            </label>
            <select id="view" name="view" defaultValue={view} className="input">
              <option value="all">All holdings</option>
              <option value="open">Still out</option>
              <option value="closed">Returned</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label mb-1.5" htmlFor="from">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={sp.from ?? ""}
                className="input"
              />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="to">
                To
              </label>
              <input id="to" name="to" type="date" defaultValue={sp.to ?? ""} className="input" />
            </div>
          </div>

          <div className="flex items-end gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            {filtered ? (
              <Link href={`/${company.slug}/assets/history`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>

          {sp.from || sp.to ? (
            <p className="self-end text-[12.5px] leading-snug text-ink-soft sm:col-span-2">
              Anyone who held something between {formatDate(sp.from) || "the beginning"} and{" "}
              {formatDate(sp.to) || "now"}, including holdings that started earlier.
            </p>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">
            {filtered ? "No holdings match those filters." : "No holdings yet."}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            {filtered
              ? "Try widening the date range, or showing all holdings."
              : `Every ${company.name} asset you allot will leave a line here.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((holding) => (
              <HoldingRow key={holding.id} holding={holding} company={company.slug} />
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
