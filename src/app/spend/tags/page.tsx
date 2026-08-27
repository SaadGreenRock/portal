import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import HeaderControls from "@/components/HeaderControls";
import HomeButton from "@/components/HomeButton";
import TagBreakdown from "@/components/TagBreakdown";
import TagEditor from "@/components/TagEditor";
import TagPicker from "@/components/TagPicker";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST, getCompany, type CompanySlug } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate } from "@/lib/format";
import { formatMoney, formatQty } from "@/lib/money";
import { PO_STATUS_LABELS } from "@/lib/po/types";
import { addSpendTag } from "@/lib/spend/tag-actions";
import { summariseTags, tagFigures, type SpendTag, type TaggedItem } from "@/lib/spend/tags";

/**
 * Where the tags are kept, and where every line item gets one.
 *
 * A page of its own rather than a section of /spend, for two reasons that point
 * the same way. It is a working screen: the figures on Expenditure are read, and
 * this is worked *down*, a few hundred rows of it, with filters and paging that
 * would be clutter beside a panel of totals. And it is expensive in a way that
 * panel is not — every committed order's stored document, read to get at the
 * lines inside it — which is a cost worth paying when the list is the point and
 * not when a total is.
 *
 * Everything here is all-time, with no range filter. Tagging is a job that gets
 * finished, not a period that gets reported: a line item bought in March needs
 * its tag exactly as much as one bought yesterday, and a range filter on this
 * screen would hide the oldest untagged rows — the ones most likely to have been
 * missed — behind a control nobody would think to change. The range filters
 * belong on /spend, where they bound a figure being read.
 *
 * Nothing on this page writes to a purchase order. The list reads them, and the
 * tag it sets lives in its own table keyed on the order and the line's own id.
 */

/**
 * Orders per page, not line items.
 *
 * A page boundary through the middle of an order would put four of its lines at
 * the foot of one page and three at the head of the next — and the order is the
 * context that makes a line item readable at all. Twenty is a screenful at any
 * realistic line count.
 */
const PAGE_ORDERS = 20;

type Params = {
  /** "all", "untagged", or a tag's id. */
  view?: string;
  company?: string;
  q?: string;
  page?: string;
};

export default async function SpendTags({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(await isAuthenticated())) redirect("/login");
  const sp = await searchParams;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            {/* Home at the far left and the step back up to Expenditure above
                the title — the two journeys the report page keeps apart, kept
                apart here for the same reason. */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <HomeButton className="btn btn-quiet -ml-2.5 p-2.5" />
              <div className="min-w-0">
                <p className="label mb-1">
                  <Link href="/spend" className="hover:text-ink">
                    ← Expenditure
                  </Link>
                </p>
                <h1 className="text-[22px] font-bold tracking-tight">Tags</h1>
                <p className="mt-1 text-[14px] text-ink-soft">
                  What each thing you bought was for. Every line of every issued and closed
                  purchase order, both companies.
                </p>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <HeaderControls />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* One boundary for the whole screen, unlike /spend. There is no half of
            this page worth showing without the other: the tag list needs the
            figures beside each name, and those come from the same read that
            fills the item list. */}
        <Suspense fallback={<Skeleton />}>
          <Body params={sp} />
        </Suspense>
      </main>
    </>
  );
}

async function Body({ params: sp }: { params: Params }) {
  const db = await store();
  const [itemsResult, tagsResult] = await Promise.all([
    tryTable(() => db.taggedItems()),
    tryTable(() => db.listSpendTags()),
  ]);

  if (!itemsResult.ok || !tagsResult.ok) {
    return (
      <div className="card px-6 py-14 text-center">
        <p className="text-[15px] font-medium">Tags are not set up on this deployment.</p>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          The two tables this screen needs arrived with it. Run{" "}
          <code className="mono">supabase/migration.sql</code> in the Supabase SQL editor — it is
          safe to re-run, every statement in it is guarded — and this page will fill in. Nothing
          else in the portal is affected.
        </p>
      </div>
    );
  }

  const tags = tagsResult.value;
  const items = itemsResult.value;
  // All time, and over every item rather than the filtered set: the figure
  // beside a tag's name is what has been spent on it, not what is on this page.
  const summary = summariseTags(items, tags);
  const orders = countOrders(items);

  const view = viewOf(sp.view, tags);
  const companyFilter = sp.company && getCompany(sp.company) ? (sp.company as CompanySlug) : null;
  const needle = (sp.q ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filtering = view !== "all" || companyFilter != null || needle.length > 0;

  const matched = items.filter((item) => {
    if (view === "untagged" && item.tagId != null) return false;
    if (view !== "all" && view !== "untagged" && item.tagId !== view) return false;
    if (companyFilter && item.company !== companyFilter) return false;
    if (
      needle &&
      !`${item.poNo} ${item.vendor} ${item.code} ${item.description}`.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });

  const groups = groupByOrder(matched);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_ORDERS));
  const shown = groups.slice((page - 1) * PAGE_ORDERS, page * PAGE_ORDERS);

  /** Keeps the filters while changing one parameter. */
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change of filter starts again at the first page. The old page number
    // would otherwise land on an empty one, which reads as "no results".
    if (key !== "page") next.delete("page");
    const query = next.toString();
    return query ? `/spend/tags?${query}` : "/spend/tags";
  };

  return (
    <>
      {/* ---- the vocabulary ----------------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <h2 className="text-[16px] font-semibold">Your tags</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
            Whatever you buy in — laptop, phone, stationery. Add one whenever something does not fit
            the list; a tag is only a name, so there is no cost to having a few.
          </p>
        </header>

        {tags.length > 0 ? (
          <ul className="divide-y divide-ink-line">
            {tags.map((tag) => {
              const figures = tagFigures(summary, tag.id);
              return (
                <TagEditor
                  key={tag.id}
                  tag={tag}
                  items={figures.reduce((n, f) => n + f.items, 0)}
                  figures={figures.map((f) => `${f.currency} ${formatMoney(f.amount, f.currency)}`)}
                />
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-[13.5px] text-ink-soft">
            No tags yet. Add the first one below — the categories that fit what you actually buy are
            the ones worth having.
          </p>
        )}

        {/* A plain form and a server action: one field, no JavaScript needed. */}
        <form action={addSpendTag} className="flex gap-2 border-t border-ink-line px-5 py-4">
          <input
            name="name"
            required
            maxLength={40}
            placeholder="Laptop, phone, stationery…"
            aria-label="New tag name"
            className="input max-w-[20rem]"
          />
          <button type="submit" className="btn btn-primary shrink-0">
            Add tag
          </button>
        </form>
      </section>

      {/* ---- the payoff, on the same screen as the work ------------------- */}
      {tags.length > 0 ? (
        <section className="card mb-5 overflow-hidden">
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ink-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold">What it went on</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                All time, both companies. Unfiltered by anything below.
              </p>
            </div>
            <Link href="/spend" className="shrink-0 text-[13px] text-ink-soft hover:text-ink">
              This month, this year →
            </Link>
          </header>
          <TagBreakdown summary={summary} />
        </section>
      ) : null}

      {/* ---- the work ---------------------------------------------------- */}
      <section className="card overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold">Line items</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                {summary.items} {summary.items === 1 ? "line" : "lines"} across {orders}{" "}
                {orders === 1 ? "order" : "orders"}
                {summary.untaggedItems > 0
                  ? `, ${summary.untaggedItems} still untagged`
                  : summary.items > 0
                    ? ", all tagged"
                    : ""}
                .
              </p>
            </div>
            {filtering ? (
              <p className="mono shrink-0 text-[13px] text-ink-soft">
                {matched.length} {matched.length === 1 ? "line" : "lines"} matching
              </p>
            ) : null}
          </div>

          {/* Filters live in the URL, so a view can be bookmarked — the same
              choice the range pills on /spend make. */}
          <nav className="mt-3.5 flex flex-wrap gap-1.5">
            <Chip href={withParam("view", "")} active={view === "all"}>
              Everything
            </Chip>
            <Chip href={withParam("view", "untagged")} active={view === "untagged"}>
              Untagged{summary.untaggedItems > 0 ? ` · ${summary.untaggedItems}` : ""}
            </Chip>
            {tags.map((tag) => (
              <Chip key={tag.id} href={withParam("view", tag.id)} active={view === tag.id}>
                {tag.name}
              </Chip>
            ))}
          </nav>

          <form className="mt-3 flex flex-wrap items-end gap-2">
            {/* The view survives a search: they are two filters, and typing in
                one should not silently clear the other. */}
            {sp.view ? <input type="hidden" name="view" value={sp.view} /> : null}
            <div className="min-w-[14rem] flex-1">
              <label className="label mb-1.5" htmlFor="q">
                Search
              </label>
              <input
                id="q"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Order no., vendor, item code or description…"
                className="input"
              />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="company">
                Company
              </label>
              <select id="company" name="company" defaultValue={companyFilter ?? ""} className="input">
                <option value="">Both</option>
                {COMPANY_LIST.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-ghost">
              Apply
            </button>
            {filtering ? (
              <Link href="/spend/tags" className="btn btn-quiet">
                Clear
              </Link>
            ) : null}
          </form>
        </header>

        {shown.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-[15px] font-medium">
              {view === "untagged" && summary.items > 0
                ? "Everything is tagged."
                : filtering
                  ? "No line items match those filters."
                  : "Nothing to tag yet."}
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
              {view === "untagged" && summary.items > 0
                ? "Every line of every committed order has a tag. Nothing here is waiting on you."
                : filtering
                  ? "Try a different search, or show everything."
                  : "Line items appear here once an order has been issued. A draft is promised to nobody yet, so it is neither counted nor listed."}
            </p>
            {filtering ? (
              <Link href="/spend/tags" className="btn btn-ghost mt-5">
                Show everything
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-ink-line">
            {shown.map((group) => (
              <OrderGroup key={group.poId} group={group} tags={tags} />
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <nav className="flex items-center justify-between gap-3 border-t border-ink-line px-5 py-4">
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
      </section>

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        One tag per line — two would count the same money twice, and the breakdown would add up to
        more than was spent. Each line carries its share of its order’s tax, shipping and discount,
        spread by line value, so the tags add up to the Purchase orders figure on Expenditure.
        Drafts, cancelled and deleted orders are not listed, exactly as they are not counted.
        Tagging changes nothing about a purchase order: the document, its PDF and its totals are
        untouched.
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------
 * One order, and its lines
 * ---------------------------------------------------------------------------*/

interface OrderGroupData {
  poId: string;
  poNo: string;
  company: CompanySlug;
  status: TaggedItem["status"];
  date: string;
  vendor: string;
  currency: string;
  rows: TaggedItem[];
  /** The lines shown, added up — not the order's own total. See below. */
  total: number;
}

/**
 * Grouped under the order, not listed flat.
 *
 * "Cable, 3 pcs, 1,200" is unreadable on its own — the vendor and the order it
 * came from are what place it, and a flat list would either repeat both on every
 * row or carry neither.
 */
function groupByOrder(items: TaggedItem[]): OrderGroupData[] {
  const groups: OrderGroupData[] = [];
  const at = new Map<string, number>();

  for (const item of items) {
    let index = at.get(item.poId);
    if (index == null) {
      index = groups.length;
      at.set(item.poId, index);
      groups.push({
        poId: item.poId,
        poNo: item.poNo,
        company: item.company,
        status: item.status,
        date: item.date,
        vendor: item.vendor,
        currency: item.currency,
        rows: [],
        total: 0,
      });
    }
    groups[index].rows.push(item);
    // The lines shown, not the order's own total. Under a filter this is a
    // subset, and printing the order's full total beside four of its seven lines
    // would read as those four adding up to it.
    groups[index].total = Math.round((groups[index].total + item.amount) * 100) / 100;
  }

  return groups;
}

const countOrders = (items: TaggedItem[]) => new Set(items.map((i) => i.poId)).size;

function OrderGroup({ group, tags }: { group: OrderGroupData; tags: SpendTag[] }) {
  const company = getCompany(group.company);

  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-wash-soft px-5 py-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* The company's own brand, given its night value too — Sportech's
              near-black dot is otherwise a dot nobody can see. */}
          <span
            aria-hidden
            className="swatch block h-2 w-2 shrink-0 rounded-full"
            style={
              {
                "--swatch": company?.theme.ui,
                "--swatch-dark": company?.theme.uiDark,
              } as React.CSSProperties
            }
          />
          {/* Through to the order itself, because the answer to "what is this
              line?" is often the document it came off. */}
          <Link
            href={`/${group.company}/po/${group.poId}`}
            className="mono text-[13px] font-semibold hover:underline"
          >
            {group.poNo}
          </Link>
          <span className="text-[12.5px] text-ink-soft">{formatDate(group.date)}</span>
          <span className="truncate text-[13px]">{group.vendor || "—"}</span>
          {/* Only on a closed order. "Issued" is the ordinary state of a
              committed order, and a chip on every row would say nothing. */}
          {group.status === "closed" ? (
            <span className="chip chip-neutral">{PO_STATUS_LABELS.closed}</span>
          ) : null}
        </div>
        <span className="mono shrink-0 text-[12.5px] text-ink-soft">
          {group.rows.length} {group.rows.length === 1 ? "line" : "lines"} · {group.currency}{" "}
          {formatMoney(group.total, group.currency)}
        </span>
      </div>

      <ul className="divide-y divide-ink-line/60">
        {group.rows.map((item) => (
          <li
            key={item.itemId}
            className="grid gap-x-4 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_12rem] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-[13.5px] leading-snug">
                {item.description || <span className="text-ink-soft">no description</span>}
              </p>
              {item.code ? <p className="mono mt-0.5 text-[12px] text-ink-soft">{item.code}</p> : null}
            </div>

            <div className="flex items-baseline gap-3 sm:justify-end">
              <span className="mono whitespace-nowrap text-[12.5px] text-ink-soft">
                {formatQty(item.qty)}
                {item.unit ? ` ${item.unit}` : ""} × {formatMoney(item.unitPrice, item.currency)}
              </span>
              {/* The attributed figure, not the printed line amount — this is
                  what the tag totals are built from. The two differ by this
                  line's share of the order's tax and shipping, and showing the
                  line amount here would leave the panel above unexplainable. */}
              <span className="mono whitespace-nowrap text-[13.5px] font-semibold">
                {item.currency} {formatMoney(item.amount, item.currency)}
              </span>
            </div>

            <TagPicker
              poId={item.poId}
              itemId={item.itemId}
              tagId={item.tagId}
              tags={tags}
              label={`${item.description || item.code || "line"} on ${item.poNo}`}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

/* -------------------------------------------------------------------------
 * Bits
 * ---------------------------------------------------------------------------*/

/** "all", "untagged", or a tag id that still exists. Anything else is "all". */
function viewOf(raw: string | undefined, tags: SpendTag[]): string {
  if (raw === "untagged") return "untagged";
  if (raw && tags.some((t) => t.id === raw)) return raw;
  return "all";
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // The same pill the range filters on /spend and the workspace nav draw,
      // stated in the portal's accent rather than a hex, so it is the right teal
      // by day and the lifted one at night.
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        active
          ? "bg-[var(--accent)] text-[var(--accent-text)]"
          : "text-ink-soft hover:bg-wash-strong hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * The wash of the screen: the tag list, and the first few line items under their
 * order.
 */
function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <section className="card mb-5 overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <div className="h-4 w-24 rounded bg-wash-strong" />
          <div className="mt-2 h-3 w-72 max-w-full rounded bg-wash" />
        </header>
        <div className="divide-y divide-ink-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="h-3.5 w-28 rounded bg-wash" />
              <div className="h-3 w-24 rounded bg-wash-soft" />
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <div className="h-4 w-24 rounded bg-wash-strong" />
          <div className="mt-2 h-3 w-56 max-w-full rounded bg-wash" />
        </header>
        {[0, 1].map((g) => (
          <div key={g}>
            <div className="flex items-center justify-between gap-4 bg-wash-soft px-5 py-2.5">
              <div className="h-3 w-44 rounded bg-wash" />
              <div className="h-3 w-24 rounded bg-wash-soft" />
            </div>
            {[0, 1].map((r) => (
              <div
                key={r}
                className="grid gap-4 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_12rem] sm:items-center"
              >
                <div className="h-3 w-56 max-w-full rounded bg-wash" />
                <div className="h-3 w-28 rounded bg-wash-soft" />
                <div className="h-8 w-full rounded-lg bg-wash" />
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
