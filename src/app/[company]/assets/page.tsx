import Link from "next/link";
import { notFound } from "next/navigation";
import AssetRow from "@/components/AssetRow";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import type { AssetQuery } from "@/lib/assets/types";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";

/**
 * The register: every asset the company owns, and who has it now.
 *
 * Current state only. What happened before lives on the History tab, which lists
 * holdings rather than assets — the two questions are "where is our stuff" and
 * "who had it", and one list cannot be sorted for both at once.
 */

const PAGE_SIZE = 25;

type Params = {
  q?: string;
  view?: string;
  page?: string;
  deleted?: string;
};

const VIEWS = new Set(["all", "out", "stock", "deleted"]);

export default async function AssetRegister({
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

  const view = (VIEWS.has(sp.view ?? "") ? sp.view : "all") as AssetQuery["view"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: AssetQuery = {
    company: company.slug,
    q: sp.q,
    view,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const [listed, counted, directory] = await Promise.all([
    tryTable(() => db.searchAssets(query)),
    tryTable(() => db.assetCounts(company.slug)),
    // Tolerated on its own: an unmigrated employee register must not stop the
    // asset register from listing assets. Without it the leaver flags simply do
    // not appear, which is the same bargain every other badge here makes.
    tryTable(() => db.employeeDirectory(company.slug)),
  ]);
  if (!listed.ok || !counted.ok) return <ModuleUnavailable module="Assets" />;

  const leavers = new Set(
    (directory.ok ? directory.value : []).filter((e) => e.status === "left").map((e) => e.id),
  );

  const { rows, total } = listed.value;
  const counts = counted.value;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || view !== "all");

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
            spent and will not be given to another asset, and its history is kept.
          </p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Asset register</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            What {company.name} owns, and who is holding it.
          </p>
        </div>
        <Link href={`/${company.slug}/assets/new`} className="btn btn-primary">
          New asset
        </Link>
      </div>

      {counts.total > 0 ? (
        <dl className="card mb-5 grid grid-cols-2 divide-ink-line sm:grid-cols-4 sm:divide-x">
          <Stat label="Out with somebody" value={String(counts.out)} href={`?view=out`} slug={slug} />
          <Stat label="In stock" value={String(counts.stock)} href={`?view=stock`} slug={slug} />
          <Stat
            label={counts.employees === 1 ? "Employee holding" : "Employees holding"}
            value={String(counts.employees)}
          />
          <Stat
            label="Damaged or lost"
            value={String(counts.flagged)}
            urgent={counts.flagged > 0}
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
              placeholder="Asset no., asset, current holder…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="view">
              Show
            </label>
            <select id="view" name="view" defaultValue={view} className="input">
              <option value="all">Everything</option>
              <option value="out">Out with somebody</option>
              <option value="stock">In stock</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {filtered ? (
              <Link href={`/${company.slug}/assets`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>

          <p className="mono self-end text-[13px] text-ink-soft sm:col-span-2 lg:col-span-4 lg:text-right">
            {total} {total === 1 ? "asset" : "assets"}
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
                ? "No assets match those filters."
                : "Nothing on the register yet."}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            {view === "deleted"
              ? "Deleted assets would appear here, with their numbers still spent."
              : filtered
                ? "Try a different search, or show everything."
                : `The first ${company.name} asset gets the number ${company.prefix}-A-001.`}
          </p>
          {view === "deleted" || filtered ? null : (
            <Link href={`/${company.slug}/assets/new`} className="btn btn-primary mt-5">
              New asset
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                company={company.slug}
                leavers={leavers}
              />
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

/** A count, linked to the filter that shows what it counts where that helps. */
function Stat({
  label,
  value,
  href,
  slug,
  urgent,
}: {
  label: string;
  value: string;
  href?: string;
  slug?: string;
  urgent?: boolean;
}) {
  const body = (
    <>
      <dt className="label">{label}</dt>
      <dd
        className={`mono mt-1 text-[13.5px] ${urgent ? "font-semibold text-amber-700" : ""}`}
      >
        {value}
      </dd>
    </>
  );

  if (href && slug) {
    return (
      <Link href={`/${slug}/assets${href}`} className="px-5 py-3.5 hover:bg-wash-soft">
        {body}
      </Link>
    );
  }
  return <div className="px-5 py-3.5">{body}</div>;
}
