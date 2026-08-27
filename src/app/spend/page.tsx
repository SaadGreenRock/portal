import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import HeaderControls from "@/components/HeaderControls";
import HomeButton from "@/components/HomeButton";
import TagBreakdown from "@/components/TagBreakdown";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST, type Company } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatMoney } from "@/lib/money";
import { itemWithinRange, summariseTags } from "@/lib/spend/tags";
import {
  RANGE_LABELS,
  summarise,
  withinRange,
  type SpendRange,
  type SpendRow,
  type SpendSummary,
} from "@/lib/spend/types";

/**
 * Expenditure across both companies.
 *
 * Deliberately outside /[company]: the point of the page is the combined figure,
 * which belongs to neither workspace. Each company's own total sits underneath,
 * so "separately, and together" is one screen rather than three.
 *
 * Each kind of document gets its own line before they are combined, because they
 * are different claims: a voucher is money that has left and been signed for, a
 * purchase order is money promised to a vendor that may not have been paid yet,
 * a miscellaneous payment is money that has left with nobody signing for it, and
 * food is money already eaten whether settled or not. A single blended number
 * would read as authoritative and mean four things at once.
 *
 * The lines are labelled with the document names alone — "Vouchers", not "Paid
 * out — vouchers". The reader knows what a voucher is; the gloss was the page
 * explaining itself in a place meant for figures.
 */

const RANGES: SpendRange[] = ["all", "year", "month"];

export default async function Expenditure({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");

  const { range: rangeParam } = await searchParams;
  const range: SpendRange = RANGES.includes(rangeParam as SpendRange)
    ? (rangeParam as SpendRange)
    : "all";

  return (
    <>
      {/* sticky: Lock and the range filters stay reachable while scrolling
          a long report, rather than scrolling away with it. */}
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            {/* The way back, at the start of the header rather than the end of
                it — see HomeButton. The negative margin pulls the glyph out to
                the container's own left edge, so it lines up with the content
                below rather than sitting a padding-width inside it. */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <HomeButton className="btn btn-quiet -ml-2.5 p-2.5" />
              <div className="min-w-0">
                <h1 className="text-[22px] font-bold tracking-tight">Expenditure</h1>
                <p className="mt-1 text-[14px] text-ink-soft">
                  Both companies together, and each on its own. From vouchers, purchase orders,
                  miscellaneous payments and the food log.
                </p>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Where the categories are kept and assigned. Beside the report
                  rather than inside the panel it feeds, because it is reached to
                  do a job — work down the untagged lines — and not while
                  reading the figures. */}
              <Link href="/spend/tags" className="btn btn-ghost">
                Assign tags
              </Link>
              {/* The detail behind these figures, laid out for printing. A link
                  rather than a button: the report is a page, and one worth being
                  able to bookmark with its period already in the URL. */}
              <Link href="/spend/report" className="btn btn-ghost">
                Create report
              </Link>
              <HeaderControls />
            </div>
          </div>

          {/* Range filters live in the URL, so a view can be bookmarked. */}
          <nav className="mt-4 flex flex-wrap gap-1.5 pb-4">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={r === "all" ? "/spend" : `/spend?range=${r}`}
                aria-current={r === range ? "page" : undefined}
                // The portal's accent rather than its hex, which is the same
                // teal by day and the lifted one at night — and the same pill
                // the workspace nav draws for the tab you are on.
                className={`rounded-lg px-3 py-1.5 text-[13.5px] font-semibold transition-colors ${
                  r === range
                    ? "bg-[var(--accent)] text-[var(--accent-text)]"
                    : "text-ink-soft hover:bg-wash-strong hover:text-ink"
                }`}
              >
                {RANGE_LABELS[r]}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Every figure on this page is a full sweep of both companies' rows
            plus the food log, filtered in memory — so the report waits, and the
            title, the range filters and the way back to the companies do not.
            Streaming one behind the other keeps the header put and puts the
            wait where the numbers are.

            A boundary here rather than a loading.tsx beside this file, because
            this screen carries its own header: there is no layout above it to
            hold the chrome while a route-level fallback stood in for the page,
            so a loading.tsx would take the range filters and the way out down
            with the figures. */}
        <Suspense fallback={<ReportSkeleton />}>
          <Report range={range} />
        </Suspense>

        {/* Its own boundary, and deliberately not folded into the one above.
            This panel reads every committed order's stored document to get at
            the line items; the figures above read five columns. Behind one
            boundary the cheap half would wait on the expensive half for no
            reason the reader could see. */}
        <Suspense fallback={<TagPanelSkeleton />}>
          <TagPanel range={range} />
        </Suspense>

        {/* Out here rather than at the foot of `Report`, so it is on the page
            from the first paint: it is fixed text about what counts, and it does
            not depend on a figure having arrived. */}
        <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
          Cancelled orders and anything deleted are excluded. Drafts are shown but not counted —
          nothing has been promised to a vendor yet. Miscellaneous payments are counted whether or
          not a receipt was kept. Food is counted whether it has been settled or not, and belongs
          to neither company on its own, so it appears only in the combined figure. Currencies are
          never added together.
        </p>
      </main>
    </>
  );
}

/**
 * The figures themselves.
 *
 * Split from the screen around it because this is the half that waits: every
 * spend row for both companies and the whole food log, fetched and then filtered
 * in memory. `range` comes down as a prop rather than being read again here —
 * the header above has already settled which one is in force, and reading the
 * search params twice is how the pills and the figures come to disagree.
 */
async function Report({ range }: { range: SpendRange }) {
  const db = await store();
  const now = new Date();

  // Tolerated per company: an unmigrated purchase order table must not stop the
  // voucher half of the report from being readable.
  // Both companies and the food log in one pass. Food used to wait on the two
  // companies having answered, which is a round trip spent for nothing: it is a
  // separate table and a separate question. Fetched once, not per company — a
  // lunch ordered for both belongs to neither, so it joins the combined figure
  // and stays out of the two cards.
  const [perCompany, foodResult] = await Promise.all([
    Promise.all(
      COMPANY_LIST.map(async (company) => {
        const result = await tryTable(() => db.spendRows(company.slug));
        const rows = (result.ok ? result.value : []).filter((r) => withinRange(r, range, now));
        return { company, rows, available: result.ok };
      }),
    ),
    tryTable(() => db.foodSpendRows()),
  ]);

  const foodRows = (foodResult.ok ? foodResult.value : []).filter((r) =>
    withinRange(r, range, now),
  );

  const everything: SpendRow[] = [...perCompany.flatMap((c) => c.rows), ...foodRows];
  const combined = summarise(everything);
  const anyMissing = perCompany.some((c) => !c.available);

  return (
    <>
      {anyMissing ? (
        <p className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13.5px] leading-relaxed text-amber-900">
          Purchase orders are not switched on yet, so these figures cover vouchers and food
          only. Ask whoever maintains the portal to enable them.
        </p>
      ) : null}

      {/* ---- both companies together ------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <h2 className="text-[16px] font-semibold">Both companies</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {RANGE_LABELS[range]}, across {COMPANY_LIST.map((c) => c.name).join(" and ")}.
          </p>
        </header>

        <Totals summary={combined} emphasis />

        {/* The breakdown that makes the combined figure checkable. Food has its
            own line rather than being left out: without it the two company
            figures no longer add up to Combined, and a total that cannot be
            checked against its parts is the one thing this page must not be. */}
        <div className="border-t border-ink-line">
          <p className="label px-5 pt-4">Split by company</p>
          <dl className="divide-y divide-ink-line">
            {perCompany.map(({ company, rows }) => {
              const s = summarise(rows);
              return (
                <div
                  key={company.slug}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3"
                >
                  <dt className="flex items-center gap-2.5 text-[13.5px] font-medium">
                    {/* The company's own brand, which is chosen to be the
                        darkest thing on white and therefore has to be given
                        its night value too — Sportech's near-black legend dot
                        would otherwise be a legend dot nobody can see. */}
                    <span
                      aria-hidden
                      className="swatch block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={
                        {
                          "--swatch": company.theme.ui,
                          "--swatch-dark": company.theme.uiDark,
                        } as React.CSSProperties
                      }
                    />
                    {company.name}
                  </dt>
                  <dd className="mono text-[13.5px] font-semibold">
                    {s.byCurrency.length === 0 ? (
                      <span className="font-normal text-ink-soft">nothing recorded</span>
                    ) : (
                      s.byCurrency
                        .map((t) => `${t.currency} ${formatMoney(t.total, t.currency)}`)
                        .join("  ·  ")
                    )}
                  </dd>
                </div>
              );
            })}

            {/* Not attributed to either workspace — see the note above. */}
            {foodRows.length > 0 ? (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                <dt className="flex items-center gap-2.5 text-[13.5px] font-medium">
                  {/* The same warm brown the food tile on the landing page
                      uses, and the same brown lifted for the dark theme. */}
                  <span
                    aria-hidden
                    className="swatch block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={
                      { "--swatch": "#b8894a", "--swatch-dark": "#d9a76a" } as React.CSSProperties
                    }
                  />
                  Food &amp; refreshments
                  <span className="text-[12.5px] font-normal text-ink-soft">
                    — both companies
                  </span>
                </dt>
                <dd className="mono text-[13.5px] font-semibold">
                  {summarise(foodRows)
                    .byCurrency.map((t) => `${t.currency} ${formatMoney(t.total, t.currency)}`)
                    .join("  ·  ")}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      {/* ---- each company on its own -------------------------------------- */}
      <div className="grid gap-5 sm:grid-cols-2">
        {perCompany.map(({ company, rows }) => (
          <CompanyCard key={company.slug} company={company} summary={summarise(rows)} range={range} />
        ))}
      </div>
    </>
  );
}

/**
 * What the purchase order money went on.
 *
 * The one cut of this page's figures that is not about a document type. A
 * voucher, an order and a lunch are different *claims*; a laptop and a phone are
 * different *things*, and until now nothing in the portal could tell you how
 * much of the money went on either — an order's total is the only figure stored
 * against it, and one order buys a laptop, a bag and three cables.
 *
 * So the unit here is the line item, and the totals are built from the stored
 * documents on read. Purchase orders only: they are the module where what was
 * bought is itemised. A voucher records who was paid, a miscellaneous payment
 * records that money left, and neither carries a list of things.
 *
 * It sits under the two company cards rather than above them because it answers
 * a later question. How much, then whose, then on what.
 */
async function TagPanel({ range }: { range: SpendRange }) {
  const db = await store();
  const now = new Date();

  const [itemsResult, tagsResult] = await Promise.all([
    tryTable(() => db.taggedItems()),
    tryTable(() => db.listSpendTags()),
  ]);

  // The two tables arrived with this panel, so a deployment whose migration has
  // not been re-run has the rest of the page working and this part missing.
  // Named rather than hidden, and it says what to run — the same courtesy
  // `ModuleUnavailable` does for a module inside a workspace.
  if (!itemsResult.ok || !tagsResult.ok) {
    return (
      <section className="card mt-5 overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <h2 className="text-[16px] font-semibold">What it went on</h2>
        </header>
        <p className="px-5 py-6 text-[13.5px] leading-relaxed text-ink-soft">
          Tags are not set up on this deployment yet. Whoever maintains the portal needs to run{" "}
          <code className="mono">supabase/migration.sql</code>, which is safe to re-run — every
          statement in it is guarded. Nothing else on this page is affected.
        </p>
      </section>
    );
  }

  const tags = tagsResult.value;
  const items = itemsResult.value.filter((i) => itemWithinRange(i, range, now));
  const summary = summariseTags(items, tags);

  return (
    <section className="card mt-5 overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ink-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold">What it went on</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {RANGE_LABELS[range]}, both companies. Purchase order line items, from issued and
            closed orders.
          </p>
        </div>
        <Link href="/spend/tags" className="shrink-0 text-[13px] text-ink-soft hover:text-ink">
          {summary.untaggedItems > 0
            ? `${summary.untaggedItems} untagged \u2192`
            : "Manage tags \u2192"}
        </Link>
      </header>

      {tags.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-[14px] font-medium">No tags yet.</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-soft">
            Add the categories you buy in — laptop, phone, stationery — then tag each line of each
            order. This panel becomes what you have spent on each of them.
          </p>
          <Link href="/spend/tags" className="btn btn-primary mt-5">
            Add the first tag
          </Link>
        </div>
      ) : (
        <>
          <TagBreakdown summary={summary} />
          <p className="border-t border-ink-line bg-wash-soft px-5 py-3 text-[12.5px] leading-snug text-ink-soft">
            Every line carries its share of its order’s tax, shipping and discount, so these add
            up to the Purchase orders figure above rather than to the orders’ subtotal.
            {summary.untaggedItems > 0 ? (
              <>
                {" "}
                <Link href="/spend/tags?view=untagged" className="underline">
                  {summary.untaggedItems}{" "}
                  {summary.untaggedItems === 1 ? "line has" : "lines have"} no tag yet
                </Link>
                .
              </>
            ) : null}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The wash of the tag panel: a heading, three rows with their proportion bars,
 * and the total under a rule.
 *
 * The bars are stood in for at a *fixed* width rather than a plausible one. A
 * skeleton bar of varying length reads as a proportion that has arrived and is
 * telling you something, which is the one thing it must not do.
 */
function TagPanelSkeleton() {
  return (
    <div className="skeleton mt-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <section className="card overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <div className="h-4 w-32 rounded bg-wash-strong" />
          <div className="mt-2 h-3 w-64 max-w-full rounded bg-wash" />
        </header>
        <div className="space-y-3 px-5 py-4">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="h-3 w-24 rounded bg-wash" />
                <div className="h-3 w-20 rounded bg-wash-soft" />
              </div>
              <div className="mt-1.5 h-1 w-1/3 rounded-full bg-wash" />
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 border-t border-ink-line pt-3">
            <div className="h-3.5 w-28 rounded bg-wash-strong" />
            <div className="h-4 w-28 rounded bg-wash" />
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The wash of the report: the combined panel, the two company cards under it,
 * and the note at the foot.
 *
 * The same three tones in the same order as the other skeletons in the portal —
 * strongest for a heading, middle for body, faintest for a figure. Currency
 * amounts are the one thing deliberately *not* stood in for at full width: a
 * long pale bar where a total goes reads as a number that has arrived and is
 * unreadable, rather than as one still coming.
 */
function ReportSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* ---- both companies together ------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <div className="h-4 w-36 rounded bg-wash-strong" />
          <div className="mt-2 h-3 w-56 max-w-full rounded bg-wash" />
        </header>

        <div className="space-y-2.5 px-5 py-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-baseline justify-between gap-4">
              <div className="h-3 w-28 rounded bg-wash" />
              <div className="h-3 w-20 rounded bg-wash-soft" />
            </div>
          ))}
          {/* The combined line, which is the biggest type on the real panel. */}
          <div className="flex items-baseline justify-between gap-4 border-t border-ink-line pt-3">
            <div className="h-4 w-24 rounded bg-wash-strong" />
            <div className="h-5 w-32 rounded bg-wash" />
          </div>
        </div>

        <div className="border-t border-ink-line">
          <div className="px-5 pt-4">
            <div className="h-2.5 w-24 rounded bg-wash" />
          </div>
          <div className="divide-y divide-ink-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 px-5 py-3">
                <div className="h-3 w-40 rounded bg-wash" />
                <div className="h-3 w-24 rounded bg-wash-soft" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- each company on its own ------------------------------------- */}
      <div className="grid gap-5 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <section
            key={i}
            className="card overflow-hidden"
          >
            {/* Standing in for the brand stripe as well as the header: the real
                card carries a 3px top border in the company's own colour, and
                without it here the two cards lose the only thing that tells
                them apart at a glance. */}
            <div className="flex items-center gap-3 border-b border-t-[3px] border-ink-line px-5 py-4">
              <div className="h-7 w-16 shrink-0 rounded bg-wash" />
              <div className="h-3.5 w-28 rounded bg-wash-strong" />
            </div>
            <div className="space-y-2.5 px-5 py-4">
              {[0, 1].map((j) => (
                <div key={j} className="flex items-baseline justify-between gap-4">
                  <div className="h-3 w-24 rounded bg-wash" />
                  <div className="h-3 w-20 rounded bg-wash-soft" />
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 border-t border-ink-line pt-2.5">
                <div className="h-3.5 w-20 rounded bg-wash-strong" />
                <div className="h-4 w-24 rounded bg-wash" />
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* The note at the foot, which is three lines of small grey type. */}
      <div
        className="mt-6 space-y-2"
      >
        <div className="h-2.5 w-full rounded bg-wash-soft" />
        <div className="h-2.5 w-full rounded bg-wash-soft" />
        <div className="h-2.5 w-2/3 rounded bg-wash-soft" />
      </div>
    </div>
  );
}

function CompanyCard({
  company,
  summary,
  range,
}: {
  company: Company;
  summary: SpendSummary;
  range: SpendRange;
}) {
  return (
    <section className="card overflow-hidden">
      {/* The brand stripe needs its night value like the legend dots do — left
          at the day one, Green Rock's teal goes muddy against the card and
          Sportech's near-black stripe is no stripe at all. */}
      <header
        className="swatch-top flex items-center gap-3 border-b border-t-[3px] border-ink-line px-5 py-4"
        style={
          {
            "--swatch": company.theme.ui,
            "--swatch-dark": company.theme.uiDark,
          } as React.CSSProperties
        }
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold">{company.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">{RANGE_LABELS[range]}</p>
        </div>
        <Link
          href={`/${company.slug}`}
          className="shrink-0 text-[13px] text-ink-soft hover:text-ink"
        >
          Open →
        </Link>
      </header>

      <Totals summary={summary} />
    </section>
  );
}

/**
 * One line per kind of document, per currency.
 *
 * They stay separate because they answer different questions, and the combined
 * line sits under a rule so it reads as their sum rather than as a further
 * independent figure.
 */
function Totals({ summary, emphasis }: { summary: SpendSummary; emphasis?: boolean }) {
  const { byCurrency, counts } = summary;

  if (byCurrency.length === 0) {
    return (
      <p className="px-5 py-6 text-[13.5px] text-ink-soft">
        Nothing recorded in this period.
      </p>
    );
  }

  return (
    <>
      {byCurrency.map((t) => (
        <div key={t.currency} className="border-b border-ink-line px-5 py-4 last:border-b-0">
          {byCurrency.length > 1 ? (
            <p className="label mb-2.5">{t.currency}</p>
          ) : null}

          <dl className="space-y-1.5">
            <Line label="Vouchers" value={t.paid} currency={t.currency} />
            <Line label="Purchase orders" value={t.committed} currency={t.currency} />
            {/* Its own line, not folded into Vouchers. Both are money that has
                left, but only one of them has a signature behind it, and that
                is the whole of what the voucher line is worth reading for. */}
            {t.misc > 0 ? (
              <Line label="Miscellaneous" value={t.misc} currency={t.currency} />
            ) : null}
            {/* Only when there is any. The per-company cards never receive food
                rows, so this line simply does not appear on them — which is
                right: food is not attributed to a company. */}
            {t.food > 0 ? (
              <Line label="Food & refreshments" value={t.food} currency={t.currency} />
            ) : null}

            <div className="flex items-baseline justify-between gap-4 border-t border-ink-line pt-2.5">
              <dt className={`font-semibold ${emphasis ? "text-[15px]" : "text-[13.5px]"}`}>
                Combined
              </dt>
              <dd className={`mono font-bold ${emphasis ? "text-[20px]" : "text-[16px]"}`}>
                {t.currency} {formatMoney(t.total, t.currency)}
              </dd>
            </div>

            {t.draft > 0 ? (
              <div className="flex items-baseline justify-between gap-4 pt-1 text-[12.5px] text-ink-soft">
                <dt>Draft orders, not counted</dt>
                <dd className="mono">
                  {t.currency} {formatMoney(t.draft, t.currency)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ))}

      {/* The gap in the figure, stated rather than hidden. */}
      {counts.vouchersWithoutAmount > 0 ||
      counts.ordersCancelled > 0 ||
      counts.foodPending > 0 ||
      counts.miscWithoutProof > 0 ? (
        <div className="border-t border-ink-line bg-wash-soft px-5 py-3">
          {counts.vouchersWithoutAmount > 0 ? (
            <p className="text-[12.5px] leading-snug text-amber-800">
              <strong className="font-semibold">
                {counts.vouchersWithoutAmount} of {counts.vouchers} vouchers
              </strong>{" "}
              had the amount left blank to be written by hand, so no figure was recorded and they
              are not in the total above.
            </p>
          ) : null}
          {counts.ordersCancelled > 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-soft">
              {counts.ordersCancelled} cancelled {counts.ordersCancelled === 1 ? "order" : "orders"}{" "}
              excluded.
            </p>
          ) : null}
          {/* Counted in the figure above, like the food line below and unlike
              the two caveats before it. This is a gap in the *evidence*, not in
              the total: the money left whether or not a receipt came back with
              it, and grey rather than amber because most of these never have
              one. */}
          {counts.miscWithoutProof > 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-soft">
              {counts.miscWithoutProof} of {counts.miscPayments} miscellaneous{" "}
              {counts.miscPayments === 1 ? "payment has" : "payments have"} no receipt on file.
              Counted in full above.
            </p>
          ) : null}
          {/* Counted in the figure above, unlike the two caveats before it —
              this says how much of it has not been handed over yet. */}
          {counts.foodPending > 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-soft">
              Food is counted in full when ordered.{" "}
              <Link href="/food/outstanding" className="underline">
                {counts.foodPending} {counts.foodPending === 1 ? "entry" : "entries"}
              </Link>{" "}
              of it, {formatMoney(counts.foodPendingAmount)}, is still owed.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Line({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="mono">
        {value > 0 ? (
          `${currency} ${formatMoney(value, currency)}`
        ) : (
          <span className="text-ink-soft">—</span>
        )}
      </dd>
    </div>
  );
}
