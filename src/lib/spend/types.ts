import type { CompanySlug } from "../companies";

/**
 * Expenditure across the companies.
 *
 * The one thing this module exists to avoid is a single confident number that
 * silently means two things. A voucher is money that has *left* — someone signed
 * for it. A purchase order is money *committed* but not necessarily paid, and a
 * draft order is not committed to anyone. So the two are reported on their own
 * lines and only then combined, and drafts and cancellations are shown rather
 * than quietly dropped.
 *
 * Nothing is ever summed across currencies. Adding SAR to PKR produces a figure
 * that looks authoritative and is meaningless.
 */

/** One document, reduced to what a total needs. */
export interface SpendRow {
  kind: "voucher" | "po";
  company: CompanySlug;
  /** Voucher: pending | completed. Order: draft | issued | closed | cancelled. */
  status: string;
  currency: string;
  /**
   * null means no amount was recorded at all — a voucher whose amount was left
   * blank to be filled in by hand. Those cannot be counted, and the summary
   * reports how many there are so the total is never mistaken for complete.
   */
  amount: number | null;
  /** The document's own date where it has one, else when it was created. ISO date. */
  date: string;
}

export type SpendRange = "all" | "year" | "month";

export const RANGE_LABELS: Record<SpendRange, string> = {
  all: "All time",
  year: "This year",
  month: "This month",
};

export interface CurrencyTotal {
  currency: string;
  /** Vouchers: money that has been handed over and signed for. */
  paid: number;
  /** Orders issued or closed: committed to a vendor. */
  committed: number;
  /** Orders still in draft. Shown, but deliberately not in the total. */
  draft: number;
  /** paid + committed. Drafts and cancellations are excluded. */
  total: number;
}

export interface SpendSummary {
  byCurrency: CurrencyTotal[];
  /** The single currency everything is in, or null when there is more than one. */
  soleCurrency: string | null;
  counts: {
    vouchers: number;
    /** Vouchers with no amount recorded — the gap in the figure above. */
    vouchersWithoutAmount: number;
    ordersCommitted: number;
    ordersDraft: number;
    ordersCancelled: number;
  };
}

/** Inclusive date bounds for a range, or null for no bound. */
export function rangeBounds(range: SpendRange, now = new Date()): { from: string | null } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (range === "month") return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01` };
  if (range === "year") return { from: `${now.getFullYear()}-01-01` };
  return { from: null };
}

export function withinRange(row: SpendRow, range: SpendRange, now = new Date()): boolean {
  const { from } = rangeBounds(range, now);
  return !from || row.date >= from;
}

/**
 * Rolls a set of documents up into totals, grouped by currency.
 *
 * Cancelled orders and every deleted record are already excluded before they get
 * here — a cancelled order was never spent, and a deleted one is in the bin.
 */
export function summarise(rows: SpendRow[]): SpendSummary {
  const byCurrency = new Map<string, CurrencyTotal>();
  const bucket = (currency: string): CurrencyTotal => {
    let t = byCurrency.get(currency);
    if (!t) {
      t = { currency, paid: 0, committed: 0, draft: 0, total: 0 };
      byCurrency.set(currency, t);
    }
    return t;
  };

  const counts = {
    vouchers: 0,
    vouchersWithoutAmount: 0,
    ordersCommitted: 0,
    ordersDraft: 0,
    ordersCancelled: 0,
  };

  for (const row of rows) {
    if (row.kind === "voucher") {
      counts.vouchers += 1;
      if (row.amount == null) {
        counts.vouchersWithoutAmount += 1;
        continue;
      }
      bucket(row.currency).paid += row.amount;
      continue;
    }

    if (row.status === "cancelled") {
      counts.ordersCancelled += 1;
      continue;
    }
    if (row.status === "draft") {
      counts.ordersDraft += 1;
      bucket(row.currency).draft += row.amount ?? 0;
      continue;
    }
    counts.ordersCommitted += 1;
    bucket(row.currency).committed += row.amount ?? 0;
  }

  const money = (n: number) => Math.round(n * 100) / 100;
  const totals = [...byCurrency.values()]
    .map((t) => ({
      currency: t.currency,
      paid: money(t.paid),
      committed: money(t.committed),
      draft: money(t.draft),
      total: money(t.paid + t.committed),
    }))
    // Largest first, so the currency that matters leads.
    .sort((a, b) => b.total - a.total);

  // A currency that only ever appeared on a cancelled order contributes nothing
  // and should not widen the report into a multi-currency one.
  const meaningful = totals.filter((t) => t.total > 0 || t.draft > 0);

  return {
    byCurrency: meaningful.length > 0 ? meaningful : totals,
    soleCurrency: meaningful.length === 1 ? meaningful[0].currency : null,
    counts,
  };
}
