import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { ageInDays, dueIn, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { MODULES, moduleCreateTab, moduleHome, modulePath, type ModuleKey } from "@/lib/modules";

/**
 * The workspace overview.
 *
 * Opening a company used to redirect straight to Generate, which quietly assumed
 * every visit was to write a voucher. This is the fork in the road instead — but
 * a page that only listed the modules would not be worth the click, since the
 * switcher above is on every screen anyway. So it answers "what needs me today"
 * and offers the way in as a side effect.
 *
 * Cards come from the module registry. A new module gets one for free, showing
 * its blurb and a link; give it a `summaries` entry when it has something worth
 * counting.
 */

interface Stat {
  label: string;
  value: string;
  /** Draws attention — something is late or waiting too long. */
  urgent?: boolean;
}

interface ModuleSummary {
  stats: Stat[];
  /** Empty means nothing to do, which is worth saying out loud. */
  allClear?: string;
}

export default async function WorkspaceOverview({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const [counts, pending, poCounts, openPos, rfqCounts, openRfqs, assetCounts, notificationCounts] =
    await Promise.all([
      db.counts(company.slug),
      db.listPending(company.slug),
      tryTable(() => db.poCounts(company.slug)),
      tryTable(() => db.searchPos({ company: company.slug, status: "open", limit: 200 })),
      tryTable(() => db.rfqCounts(company.slug)),
      tryTable(() => db.searchRfqs({ company: company.slug, status: "open", limit: 200 })),
      tryTable(() => db.assetCounts(company.slug)),
      tryTable(() => db.notificationCounts(company.slug)),
    ]);

  /* ---- vouchers ---------------------------------------------------------- */
  const oldestPending = pending[0];
  const voucherSummary: ModuleSummary = {
    stats: [
      {
        label: "awaiting signed scan",
        value: String(counts.pending),
        urgent: counts.pending > 0,
      },
      ...(oldestPending
        ? [{ label: "longest wait", value: ageInDays(oldestPending.createdAt) }]
        : []),
      { label: "issued in total", value: String(counts.total) },
    ],
    // "Every voucher has its signed copy" would be a strange thing to say about
    // a workspace that has never issued one.
    allClear:
      counts.total === 0
        ? "No vouchers issued yet."
        : counts.pending === 0
          ? "Every voucher has its signed copy on file."
          : undefined,
  };

  /* ---- purchase orders --------------------------------------------------- */
  let poSummary: ModuleSummary | null = null;
  if (poCounts.ok && openPos.ok) {
    const rows = openPos.value.rows;
    const overdue = rows.filter(
      (po) => po.status === "issued" && (dueIn(po.doc.deliveryDate)?.days ?? 0) < 0,
    ).length;

    // Per currency: adding SAR to PKR would be a meaningless number.
    const outstanding = new Map<string, number>();
    for (const po of rows) {
      if (po.status !== "issued") continue;
      outstanding.set(po.doc.currency, (outstanding.get(po.doc.currency) ?? 0) + po.total);
    }

    poSummary = {
      stats: [
        { label: "still open", value: String(poCounts.value.open) },
        ...(overdue > 0
          ? [{ label: "overdue on delivery", value: String(overdue), urgent: true }]
          : []),
        ...(poCounts.value.draft > 0
          ? [{ label: "not yet issued", value: String(poCounts.value.draft) }]
          : []),
        ...(outstanding.size > 0
          ? [
              {
                label: "value outstanding",
                value: [...outstanding.entries()]
                  .map(([code, sum]) => `${code} ${formatMoney(sum, code)}`)
                  .join("  ·  "),
              },
            ]
          : []),
      ],
      allClear:
        poCounts.value.total === 0
          ? "No orders raised yet."
          : poCounts.value.open === 0
            ? "No orders are open with a vendor."
            : undefined,
    };
  }

  /* ---- requests for quotation -------------------------------------------- */
  let rfqSummary: ModuleSummary | null = null;
  if (rfqCounts.ok && openRfqs.ok) {
    const rows = openRfqs.value.rows;
    const overdue = rows.filter(
      (rfq) => rfq.status === "sent" && (dueIn(rfq.doc.replyBy)?.days ?? 0) < 0,
    ).length;

    rfqSummary = {
      stats: [
        { label: "awaiting replies", value: String(rfqCounts.value.sent) },
        ...(overdue > 0
          ? [{ label: "past their deadline", value: String(overdue), urgent: true }]
          : []),
        ...(rfqCounts.value.draft > 0
          ? [{ label: "not yet sent", value: String(rfqCounts.value.draft) }]
          : []),
        { label: "raised in total", value: String(rfqCounts.value.total) },
      ],
      allClear:
        rfqCounts.value.total === 0
          ? "No requests raised yet."
          : rfqCounts.value.open === 0
            ? "No requests are out with vendors."
            : undefined,
    };
  }

  /* ---- asset register ---------------------------------------------------- */
  // An asset being out is not late — nothing here is a deadline. The one thing
  // worth flagging is a return that came back damaged or a loss, because that is
  // a fact somebody has to act on rather than a number to watch.
  let assetSummary: ModuleSummary | null = null;
  if (assetCounts.ok) {
    const c = assetCounts.value;
    assetSummary = {
      stats: [
        { label: "out with employees", value: String(c.out) },
        { label: "in stock", value: String(c.stock) },
        ...(c.flagged > 0
          ? [{ label: "damaged or lost", value: String(c.flagged), urgent: true }]
          : []),
        { label: "on the register", value: String(c.total) },
      ],
      allClear:
        c.total === 0
          ? "Nothing on the register yet."
          : c.out === 0
            ? "Every asset is back in stock."
            : undefined,
    };
  }

  /* ---- notifications ------------------------------------------------------ */
  // Nothing here is late or waiting — a notification is composed once and
  // never left pending — so the only thing worth saying is how many exist.
  let notificationSummary: ModuleSummary | null = null;
  if (notificationCounts.ok) {
    const c = notificationCounts.value;
    notificationSummary = {
      stats: [{ label: "composed in total", value: String(c.total) }],
      allClear: c.total === 0 ? "No notifications composed yet." : undefined,
    };
  }

  const summaries: Partial<Record<ModuleKey, ModuleSummary | null>> = {
    vouchers: voucherSummary,
    po: poSummary,
    rfq: rfqSummary,
    assets: assetSummary,
    notifications: notificationSummary,
  };

  const needsAttention =
    counts.pending > 0 ||
    (poCounts.ok && poCounts.value.open > 0) ||
    (rfqCounts.ok && rfqCounts.value.open > 0);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">{company.name}</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          {needsAttention
            ? "What needs attention, and where to pick up."
            : "Nothing outstanding. Pick where to start."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((module) => {
          const summary = summaries[module.key];
          const createTab = moduleCreateTab(module);

          return (
            <section key={module.key} className="card flex flex-col p-5">
              <Link
                href={moduleHome(slug, module)}
                className="group flex items-baseline justify-between gap-3"
              >
                <h2 className="text-[16px] font-semibold group-hover:underline">
                  {module.label}
                </h2>
                <span className="shrink-0 text-[13px] text-ink-soft">Open →</span>
              </Link>

              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{module.blurb}</p>

              {/* Not set up on this database — say so rather than showing zeroes. */}
              {summary === null ? (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900">
                  Not set up on this database yet. Open the tab to see what to run.
                </p>
              ) : summary ? (
                <>
                  <dl className="mt-4 flex-1 space-y-1.5">
                    {summary.stats.map((stat) => (
                      <div
                        key={stat.label}
                        className="flex items-baseline justify-between gap-3 text-[13.5px]"
                      >
                        <dt className="text-ink-soft">{stat.label}</dt>
                        <dd
                          className={`mono ${
                            stat.urgent ? "font-semibold text-amber-700" : "font-medium"
                          }`}
                        >
                          {stat.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {summary.allClear ? (
                    <p className="mt-3 text-[12.5px] text-ink-soft">{summary.allClear}</p>
                  ) : null}
                </>
              ) : (
                <div className="flex-1" />
              )}

              {/* Every tab the module has, so the overview is a way in and not a
                  detour through it.

                  The create tab is the filled one, whatever position it sits in.
                  The card's own heading already leads to the list, so making the
                  list primary here would spend the emphasis on a link that is
                  offered twice and leave the one action the card cannot
                  otherwise reach looking secondary. */}
              <div className="mt-4 flex flex-wrap gap-2">
                {module.tabs.map((tab) => (
                  <Link
                    key={tab.segment || "index"}
                    href={modulePath(slug, module, tab.segment)}
                    className={`btn px-3 py-2 text-[13px] ${
                      tab === createTab ? "btn-primary" : "btn-ghost"
                    }`}
                  >
                    {tab.label}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        Everything here is {company.name} only — numbering, history and settings are separate
        from the other workspace.
      </p>
    </>
  );
}
