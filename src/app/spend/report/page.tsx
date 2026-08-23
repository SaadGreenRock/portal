import Link from "next/link";
import { redirect } from "next/navigation";
import HeaderControls from "@/components/HeaderControls";
import PrintReportButton from "@/components/PrintReportButton";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST } from "@/lib/companies";
import { store } from "@/lib/db";
import { formatDate, stamp } from "@/lib/format";
import { formatMoneyFixed } from "@/lib/money";
import {
  buildReport,
  isoDate,
  type ReportGroup,
  type ReportSection,
  type ReportTotal,
} from "@/lib/spend/report";

/**
 * Every expense in the portal, in detail, for printing.
 *
 * The companion to /spend: that page is the figures, this is what they are made
 * of. It exists as a route rather than a download because the browser's own
 * print engine is what turns it into a PDF — see the print block at the foot of
 * globals.css for why that beats rendering one ourselves for a document this
 * shape.
 *
 * Nothing here is filed. The report is assembled on demand and carries the
 * moment it was generated, because a printed sheet with no date on it is a sheet
 * nobody can place six months later.
 *
 * Deliberately not streamed behind a Suspense boundary, unlike the figures on
 * /spend. A half-arrived report is one somebody can press print on, and a PDF
 * missing its last section looks exactly like a complete one.
 */

/** Column headings differ by document type; the shape of the table does not. */
const COLUMNS: Record<ReportSection["key"], { party: string; details: string }> = {
  vouchers: { party: "Paid to", details: "Description" },
  orders: { party: "Vendor", details: "Subject" },
  food: { party: "Vendor", details: "What was ordered" },
};

export default async function ExpenditureReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");

  const sp = await searchParams;
  const from = isoDate(sp.from);
  const to = isoDate(sp.to);
  const ranged = Boolean(from || to);

  const db = await store();
  const report = await buildReport(db, { from: from || null, to: to || null });

  const generatedAt = stamp(new Date().toISOString());
  const anything = report.totals.length > 0;

  return (
    <>
      {/* ---- the controls, which are not part of the report ---------------- */}
      <header className="border-b border-ink-line bg-card print:hidden">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label mb-1">
                <Link href="/spend" className="hover:text-ink">
                  ← Expenditure
                </Link>
              </p>
              <h1 className="text-[22px] font-bold tracking-tight">Expense report</h1>
              <p className="mt-1 text-[14px] text-ink-soft">
                Every expense in detail, for printing. Pick a period, or leave both dates empty
                for everything to date.
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <HeaderControls />
            </div>
          </div>

          {/* GET form: the period lives in the URL, so a report can be
              bookmarked and re-run next month by editing two dates. */}
          <form className="mt-4 flex flex-wrap items-end gap-3 pb-5">
            <div>
              <label className="label mb-1.5" htmlFor="from">
                From
              </label>
              <input id="from" name="from" type="date" defaultValue={from} className="input" />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="to">
                To
              </label>
              <input id="to" name="to" type="date" defaultValue={to} className="input" />
            </div>
            <button type="submit" className="btn btn-ghost">
              Apply
            </button>
            {/* The second of the two ways to ask for a period, rather than a
                reset button: everything there has ever been. */}
            {ranged ? (
              <Link href="/spend/report" className="btn btn-quiet">
                Everything to date
              </Link>
            ) : null}
            <span className="ml-auto">
              <PrintReportButton>Create report</PrintReportButton>
            </span>
          </form>
        </div>
      </header>

      {/* ---- the report ---------------------------------------------------- */}
      {/* `.on-paper` pins the whole token scale to its light values, so the
          sheet is white in both themes and a report printed at night does not
          come out as a black rectangle. `.report` is what the print stylesheet
          hangs its page-break and repeating-header rules on. */}
      <main className="report on-paper mx-auto max-w-4xl bg-card px-8 py-8 text-ink print:max-w-none print:px-0 print:py-0">
        {/* ---- masthead --------------------------------------------------- */}
        <header className="border-b-2 border-ink pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight">Expenditure report</h2>
              <p className="mt-1 text-[13px] font-semibold">{report.periodLabel}</p>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {COMPANY_LIST.map((c) => c.name).join(" and ")}
              </p>
            </div>
            <p className="mono text-right text-[11px] leading-relaxed text-ink-soft">
              Generated {generatedAt}
              <br />
              Dates inclusive
            </p>
          </div>
        </header>

        {!anything ? (
          <p className="py-14 text-center text-[14px] text-ink-soft">
            No expenses fall in this period.
          </p>
        ) : (
          <>
            <Summary report={report} />

            {report.sections.map((section, i) => (
              <Section
                key={section.key}
                section={section}
                // Every document type after the first opens a fresh sheet, so a
                // section can be pulled out and handed on by itself.
                breakBefore={i > 0}
              />
            ))}
          </>
        )}

        <Notes notes={report.notes} />
      </main>
    </>
  );
}

/**
 * The figures, grouped by currency and then by document type.
 *
 * Currency is the outer grouping rather than an extra column, because it is the
 * one thing that must never be added across: laid out this way there is no row
 * anywhere on the page where a Rupee figure and a Riyal figure could be summed
 * by eye.
 */
function Summary({ report }: { report: Awaited<ReturnType<typeof buildReport>> }) {
  return (
    <section className="mt-6">
      <h3 className="text-[14px] font-bold uppercase tracking-[0.08em]">Summary</h3>

      {report.totals.map((grand) => {
        const lines = report.sections
          .map((s) => ({
            title: s.title,
            total: s.totals.find((t) => t.currency === grand.currency),
          }))
          .filter((l) => l.total !== undefined);

        return (
          <table
            key={grand.currency}
            className="mt-3 w-full border-collapse text-[12.5px]"
          >
            <caption className="mb-1 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
              {grand.currency}
            </caption>
            <tbody>
              {lines.map(({ title, total }) => (
                <tr key={title} className="border-b border-ink-line">
                  <td className="py-1.5 pr-4">{title}</td>
                  <td className="mono py-1.5 pr-4 text-right text-ink-soft">
                    {total!.count} {total!.count === 1 ? "entry" : "entries"}
                  </td>
                  <td className="mono py-1.5 text-right font-semibold">
                    {formatMoneyFixed(total!.amount, grand.currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-b-2 border-ink">
                <td className="py-2 pr-4 text-[13.5px] font-bold">Total</td>
                <td />
                <td className="mono py-2 text-right text-[15px] font-bold">
                  {grand.currency} {formatMoneyFixed(grand.amount, grand.currency)}
                </td>
              </tr>
              {/* Included in the total above, and said so — this is how much of
                  it nobody has been paid for yet. */}
              {grand.owed > 0 ? (
                <tr>
                  <td className="py-1.5 pr-4 text-[12px] text-ink-soft" colSpan={2}>
                    Of which still to be paid
                  </td>
                  <td className="mono py-1.5 text-right text-[12px] font-semibold text-amber-800">
                    {formatMoneyFixed(grand.owed, grand.currency)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        );
      })}
    </section>
  );
}

function Section({
  section,
  breakBefore,
}: {
  section: ReportSection;
  breakBefore: boolean;
}) {
  const groups = section.groups.filter((g) => g.rows.length > 0);

  /**
   * A section total is worth printing only for a currency that more than one
   * group contributed to.
   *
   * Purchase orders are the case that makes this necessary: Green Rock buys in
   * Riyals and Sportech in Rupees, so an "all companies" line would restate each
   * group's own figure verbatim, one under the other — and a number repeated
   * under a wider heading reads as a second, larger fact rather than the same
   * one. Vouchers, both companies in Rupees, do have something to add up.
   */
  const shared = section.totals.filter(
    (t) =>
      groups.filter((g) => g.totals.some((gt) => gt.currency === t.currency)).length > 1,
  );

  return (
    <section className={`mt-8 ${breakBefore ? "section-break" : ""}`}>
      <h3 className="border-b border-ink pb-1 text-[15px] font-bold">{section.title}</h3>
      <p className="mt-1 text-[11.5px] text-ink-soft">{section.blurb}</p>

      {!section.available ? (
        <p className="mt-3 text-[12.5px] text-amber-800">
          This module is not set up on this deployment, so nothing is included here.
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-ink-soft">Nothing in this period.</p>
      ) : (
        <>
          {groups.map((group) => (
            <Group
              key={group.company?.slug ?? "combined"}
              group={group}
              columns={COLUMNS[section.key]}
            />
          ))}

          {shared.length > 0 ? (
            <TotalLines
              label={`${section.title} — all companies`}
              totals={shared}
              strong
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function Group({
  group,
  columns,
}: {
  group: ReportGroup;
  columns: { party: string; details: string };
}) {
  return (
    <div className="mt-4">
      {/* The brand stripe, set straight from the company's *day* accent rather
          than through `.swatch-top`. That helper swaps to the night value under
          `html.dark`, which keys off the theme and not off the sheet — so on a
          dark-themed browser it would lay Sportech's acid yellow onto white
          paper and the stripe would vanish. This is always on paper, so it
          always wants the colour chosen to be darkest on white. */}
      <h4
        className="border-t-[3px] border-ink-line pt-1.5 text-[12.5px] font-semibold"
        style={group.company ? { borderTopColor: group.company.theme.ui } : undefined}
      >
        {group.company ? group.company.name : "Both companies"}
        {group.company ? null : (
          <span className="ml-2 text-[11px] font-normal text-ink-soft">
            — ordered for either or both, never split between them
          </span>
        )}
      </h4>

      <table className="mt-1.5 w-full border-collapse text-[10.5px]">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[11%]" />
          <col className="w-[19%]" />
          <col />
          <col className="w-[14%]" />
          <col className="w-[13%]" />
        </colgroup>
        <thead>
          <tr className="border-y border-ink-rule bg-wash text-left">
            <th className="px-1.5 py-1.5 font-semibold">No.</th>
            <th className="px-1.5 py-1.5 font-semibold">Date</th>
            <th className="px-1.5 py-1.5 font-semibold">{columns.party}</th>
            <th className="px-1.5 py-1.5 font-semibold">{columns.details}</th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Amount</th>
            <th className="px-1.5 py-1.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <tr key={row.ref} className="border-b border-ink-line align-top">
              <td className="mono px-1.5 py-1">{row.ref}</td>
              <td className="mono px-1.5 py-1 whitespace-nowrap">{formatDate(row.date)}</td>
              <td className="px-1.5 py-1">{row.party}</td>
              <td className="px-1.5 py-1">{row.details}</td>
              <td className="mono px-1.5 py-1 text-right">
                {row.amount == null ? (
                  <span className="text-ink-soft">—</span>
                ) : (
                  formatMoneyFixed(row.amount, row.currency)
                )}
              </td>
              <td
                className={`px-1.5 py-1 ${
                  row.owed ? "font-semibold text-amber-800" : "text-ink-soft"
                }`}
              >
                {row.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Outside the table, not in a <tfoot>. A print engine treats tfoot as
          `table-footer-group` and repeats it at the bottom of every page the
          table spans — so on a food log long enough to run over, the closing
          total would print on each sheet, looking like a running subtotal while
          actually being the final figure restated. The food section is the one
          most likely to be long, so this is not hypothetical. */}
      <div className="totals-after-table">
        <TotalLines
          label={group.company?.name ?? "Food and refreshments"}
          totals={group.totals}
        />
      </div>
    </div>
  );
}

/** One line per currency. Never a line that adds two of them. */
function TotalLines({
  label,
  totals,
  strong,
}: {
  label: string;
  totals: ReportTotal[];
  strong?: boolean;
}) {
  return (
    <dl className={`ml-auto max-w-sm ${strong ? "mt-4" : ""}`}>
      {totals.map((t) => (
        <div
          key={t.currency}
          className={`flex items-baseline justify-between gap-4 border-t py-1 ${
            strong ? "border-ink" : "border-ink-rule"
          }`}
        >
          <dt className={`text-[11px] ${strong ? "font-bold" : "font-semibold"}`}>
            {label} · {t.currency}
          </dt>
          <dd className={`mono text-[12px] ${strong ? "font-bold" : "font-semibold"}`}>
            {formatMoneyFixed(t.amount, t.currency)}
            {t.blank > 0 ? (
              <span className="ml-1.5 font-normal text-ink-soft">
                (+{t.blank} blank)
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What would make a figure above misread, stated rather than left out.
 *
 * On screen the Expenditure page can afford to put a caveat next to the number
 * it qualifies. On paper the numbers travel without it, so they are gathered
 * here and printed with the report — the same discipline /spend keeps, carried
 * out of the building.
 */
function Notes({ notes }: { notes: string[] }) {
  return (
    <section className="mt-8 border-t border-ink pt-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em]">
        Notes on these figures
      </h3>
      <ul className="mt-2 space-y-1">
        {notes.map((note) => (
          <li key={note} className="text-[10.5px] leading-relaxed text-ink-soft">
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}
