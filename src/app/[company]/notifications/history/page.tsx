import Link from "next/link";
import { notFound } from "next/navigation";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import NotificationRow from "@/components/NotificationRow";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { NOTIFICATION_TAGS, TAG_LABELS, type NotificationQuery } from "@/lib/notifications/types";

const PAGE_SIZE = 25;

type Params = {
  q?: string;
  deleted?: string;
  tag?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};

const TAGS = new Set<string>(NOTIFICATION_TAGS);

export default async function NotificationHistory({
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

  const tag = (TAGS.has(sp.tag ?? "") ? sp.tag : "all") as NotificationQuery["tag"];
  const status = (sp.status === "deleted" ? "deleted" : "all") as NotificationQuery["status"];
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: NotificationQuery = {
    company: company.slug,
    q: sp.q,
    tag,
    status,
    from: sp.from,
    to: sp.to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const listed = await tryTable(() => db.searchNotifications(query));
  if (!listed.ok) return <ModuleUnavailable module="Notifications" />;
  const { rows, total } = listed.value;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || sp.from || sp.to || tag !== "all" || status === "deleted");

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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">
            <span className="mono font-semibold">{sp.deleted}</span> was deleted. Its number
            stays spent and will not be reissued.
          </p>
          <Link
            href={`/${company.slug}/notifications/history?status=deleted`}
            className="btn btn-ghost px-3 py-1.5 text-[13px]"
          >
            View deleted
          </Link>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Notification history</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Every notification ever composed for {company.name}.
          </p>
        </div>
        <p className="mono text-[13px] text-ink-soft">
          {total} {total === 1 ? "notification" : "notifications"}
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
              placeholder="Notification no., headline, sender…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="tag">
              Tag
            </label>
            <select id="tag" name="tag" defaultValue={tag} className="input">
              <option value="all">All</option>
              {NOTIFICATION_TAGS.map((t) => (
                <option key={t} value={t}>
                  {TAG_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="status">
              View
            </label>
            <select id="status" name="status" defaultValue={status} className="input">
              <option value="all">All</option>
              <option value="deleted">Deleted</option>
            </select>
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
              <Link href={`/${company.slug}/notifications/history`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">
            {filtered ? "No notifications match those filters." : "No notifications composed yet."}
          </p>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {filtered
              ? "Try widening the date range or clearing the tag."
              : `The first ${company.name} notification will appear here once composed.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((n) => (
              <NotificationRow key={n.id} notification={n} company={company.slug} />
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
