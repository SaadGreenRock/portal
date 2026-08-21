import Link from "next/link";
import { notFound } from "next/navigation";
import EmployeeRow from "@/components/EmployeeRow";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import type { EmployeeQuery } from "@/lib/employees/types";

/**
 * The register: everybody who works for this company.
 *
 * Per company and only this company. There is no screen anywhere that lists both
 * registers together, which is the point — the two are separate sequences of
 * separate people, and somebody who works for both is two records.
 */

const PAGE_SIZE = 25;

const VIEWS = new Set(["all", "active", "left", "deleted"]);

export default async function EmployeeRegister({
  params,
  searchParams,
}: {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ q?: string; view?: string; page?: string; deleted?: string }>;
}) {
  const { company: slug } = await params;
  const sp = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const view = (VIEWS.has(sp.view ?? "") ? sp.view : "all") as EmployeeQuery["view"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const db = await store();
  const [listed, counted] = await Promise.all([
    tryTable(() =>
      db.searchEmployees({
        company: company.slug,
        q: sp.q,
        view,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    ),
    tryTable(() => db.employeeCounts(company.slug)),
  ]);
  if (!listed.ok || !counted.ok) return <ModuleUnavailable module="Employees" />;

  const { rows, total } = listed.value;
  const counts = counted.value;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || view !== "all");

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
          <p className="text-[13.5px] leading-relaxed">
            <span className="font-semibold">{sp.deleted}</span> was deleted. Their record is kept
            so nothing that referred to them points into nothing — but their employee number is
            free to use again, unlike every other number in the portal, because you typed it and
            a typo has to be undoable.
          </p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Employees</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Who works at {company.name}, and how to reach them.
          </p>
        </div>
        <Link href={`/${company.slug}/employees/new`} className="btn btn-primary">
          New employee
        </Link>
      </div>

      {counts.total > 0 ? (
        <dl className="card mb-5 grid grid-cols-2 divide-ink-line sm:grid-cols-3 sm:divide-x">
          <Stat label="On the register" value={String(counts.total)} />
          <Stat label="Active" value={String(counts.active)} href="?view=active" slug={slug} />
          <Stat label="Left" value={String(counts.left)} href="?view=left" slug={slug} />
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
              placeholder="Name, employee no., CNIC, phone…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="view">
              Show
            </label>
            <select id="view" name="view" defaultValue={view} className="input">
              <option value="all">Everyone</option>
              <option value="active">Active</option>
              <option value="left">Left</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {filtered ? (
              <Link href={`/${company.slug}/employees`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>

          <p className="mono self-end text-[13px] text-ink-soft sm:col-span-2 lg:col-span-4 lg:text-right">
            {total} {total === 1 ? "employee" : "employees"}
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
                ? "Nobody matches those filters."
                : "Nobody on the register yet."}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
            {view === "deleted"
              ? "Deleted employees would appear here. Their records are kept; their numbers are not."
              : filtered
                ? "Try a different search, or show everyone."
                : `A name and the number ${company.name} issued are all that is needed. Everything else — CNIC, phone, address, next of kin — can be filled in whenever you have it.`}
          </p>
          {view === "deleted" || filtered ? null : (
            <Link href={`/${company.slug}/employees/new`} className="btn btn-primary mt-5">
              New employee
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((employee) => (
              <EmployeeRow key={employee.id} employee={employee} company={company.slug} />
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
}: {
  label: string;
  value: string;
  href?: string;
  slug?: string;
}) {
  const body = (
    <>
      <dt className="label">{label}</dt>
      <dd className="mono mt-1 text-[13.5px]">{value}</dd>
    </>
  );

  if (href && slug) {
    return (
      <Link href={`/${slug}/employees${href}`} className="px-5 py-3.5 hover:bg-wash-soft">
        {body}
      </Link>
    );
  }
  return <div className="px-5 py-3.5">{body}</div>;
}
