import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import HeaderControls from "@/components/HeaderControls";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST, type Company } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatMoney } from "@/lib/money";
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
 * and food is money already eaten whether settled or not. A single blended
 * number would read as authoritative and mean three things at once.
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
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">Expenditure</h1>
              <p className="mt-1 text-[14px] text-ink-soft">
                Both companies together, and each on its own. From vouchers, purchase orders and
                the food log.
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
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

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        Cancelled orders and anything deleted are excluded. Drafts are shown but not counted —
        nothing has been promised to a vendor yet. Food is counted whether it has been settled or
        not, and belongs to neither company on its own, so it appears only in the combined figure.
        Currencies are never added together.
      </p>
    </>
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
      counts.foodPending > 0 ? (
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
