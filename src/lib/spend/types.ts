import { portalToday } from "../clock";
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
 * A miscellaneous payment is money that has left with nobody signing for it —
 * the parking fee, the courier — and it gets a line of its own for exactly that
 * reason. Folded in with vouchers it would inflate the figure that is supposed
 * to mean "we hold a signature for this", which is the one thing the voucher
 * line is worth reading for.
 *
 * Nothing is ever summed across currencies. Adding SAR to PKR produces a figure
 * that looks authoritative and is meaningless.
 */

/** One document, reduced to what a total needs. */
export interface SpendRow {
  kind: "voucher" | "po" | "food" | "misc";
  /**
   * null on food, which belongs to neither workspace — roughly a quarter of the
   * entries are one lunch ordered for both companies. Rather than split those on
   * a rule nobody agreed to, food is reported as a single combined figure and
   * left out of the per-company cards entirely.
   */
  company: CompanySlug | null;
  /**
   * Voucher: pending | completed. Order: draft | issued | closed | cancelled.
   * Food: pending | paid.
   *
   * Misc: proof | no-proof. A miscellaneous payment has no lifecycle — the money
   * had already gone before the row was typed — so the one thing left worth
   * reporting is whether it can be evidenced. It changes no total; it is the
   * caveat printed beside them.
   */
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
  /**
   * Food and refreshments, counted in full whether settled or not.
   *
   * A third claim, and neither of the two above. Unlike a voucher the money may
   * not have moved — most of it is on a café's tab — and unlike a purchase order
   * it is not a promise about the future: the food was eaten, so the expense was
   * incurred. What is still owed is reported separately, under `foodPending`.
   */
  food: number;
  /**
   * Miscellaneous payments — money out with no document behind it.
   *
   * Counted in full, and never conditional on proof. A missing receipt is a
   * gap in the evidence, not a doubt about whether the money left: the entry
   * exists because somebody watched it go. Holding those back until a document
   * turned up would understate spend, which is the one direction these figures
   * must not fail in — and how many lack proof is reported separately, under
   * `counts.miscWithoutProof`.
   */
  misc: number;
  /** paid + committed + food + misc. Drafts and cancellations are excluded. */
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
    foodEntries: number;
    /** Food entries still owed to a vendor or an employee, and how much. */
    foodPending: number;
    foodPendingAmount: number;
    miscPayments: number;
    /**
     * Miscellaneous payments with no receipt on file. Counted in the figure
     * above — this says how much of it cannot be evidenced, not how much of it
     * is in doubt.
     */
    miscWithoutProof: number;
  };
}

/**
 * Inclusive date bounds for a range, or null for no bound.
 *
 * "This month" and "this year" are the desk's month and year — see `clock.ts`.
 * Taken from the host's calendar instead, a report run in the small hours of the
 * 1st would open on the month just gone and quietly leave today's entries out.
 */
export function rangeBounds(range: SpendRange, now = new Date()): { from: string | null } {
  const today = portalToday(now);
  if (range === "month") return { from: `${today.slice(0, 7)}-01` };
  if (range === "year") return { from: `${today.slice(0, 4)}-01-01` };
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
      t = { currency, paid: 0, committed: 0, draft: 0, food: 0, misc: 0, total: 0 };
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
    foodEntries: 0,
    foodPending: 0,
    foodPendingAmount: 0,
    miscPayments: 0,
    miscWithoutProof: 0,
  };

  for (const row of rows) {
    // Food counts in full regardless of status. A pending entry is food already
    // eaten on a café's tab — the expense happened, only the settlement has not.
    if (row.kind === "food") {
      counts.foodEntries += 1;
      bucket(row.currency).food += row.amount ?? 0;
      if (row.status === "pending") {
        counts.foodPending += 1;
        counts.foodPendingAmount += row.amount ?? 0;
      }
      continue;
    }

    // Counted in full whether or not a receipt exists, and the missing ones are
    // reported rather than withheld — see `CurrencyTotal.misc`.
    if (row.kind === "misc") {
      counts.miscPayments += 1;
      if (row.status === "no-proof") counts.miscWithoutProof += 1;
      bucket(row.currency).misc += row.amount ?? 0;
      continue;
    }

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
      food: money(t.food),
      misc: money(t.misc),
      total: money(t.paid + t.committed + t.food + t.misc),
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
