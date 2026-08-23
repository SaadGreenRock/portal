import { COMPANY_LIST, type Company } from "../companies";
import { tryTable } from "../db/resilience";
import type { Store } from "../db/types";
import type { FoodExpense } from "../food/types";
import type { PurchaseOrder } from "../po/types";
import { formatDate } from "../format";
import { toNumber } from "../money";
import type { ToggleKey, Voucher, VoucherFields } from "../types";

/**
 * The detail behind the expenditure figures, assembled for printing.
 *
 * `spend/types.ts` answers how much; this answers on what. The two have to agree
 * about what counts, so the rules that decide it are taken from there rather
 * than restated — the same document date, the same exclusion of deleted rows,
 * and the same refusal to add one currency to another.
 *
 * Three things it does differently on purpose, each because this leaves the
 * building and nobody is standing next to it to explain:
 *
 *   Purchase orders appear only once the vendor's invoice is on file. An issued
 *   order is a promise to a vendor, and a report that folds promises into a
 *   spend figure overstates what the period actually cost.
 *
 *   Food carries what is still owed on the row itself. The expense was incurred
 *   when the food was eaten; settling it is a later, separate event, and the row
 *   says which of the two has happened.
 *
 *   Direct entries from the funding section are absent, exactly as they are from
 *   the expenditure report — see the note above `DirectFields` in
 *   tranches/types.ts for why that is deliberate rather than an oversight.
 *
 * Nothing here is filed. The report is built on demand and printed; there is no
 * storage key, no sequence number and no row written, which is why every figure
 * carries the date it was generated instead.
 */

/** Inclusive bounds. Either end null for no bound — both null is "to date". */
export interface ReportRange {
  from: string | null;
  to: string | null;
}

/** One expense, reduced to what a printed row shows. */
export interface ReportRow {
  /** Voucher, order or entry number — the document's permanent label. */
  ref: string;
  /** The document's own date, ISO. */
  date: string;
  /** Recipient, or the vendor supplying it. */
  party: string;
  /** Printed description, order subject, or what was ordered. */
  details: string;
  currency: string;
  /**
   * null means no figure was recorded — a voucher whose amount was left blank
   * to be written in by hand at signing. Those cannot be added up, and the
   * report counts them separately rather than treating them as zero.
   */
  amount: number | null;
  /** Short label for the status column. */
  status: string;
  /** True while somebody is still waiting to be paid. Prints as an emphasis. */
  owed: boolean;
}

/** A set of rows added up in one currency. Never across two. */
export interface ReportTotal {
  currency: string;
  /** Everything with a figure recorded. */
  amount: number;
  /** How much of `amount` nobody has been paid for yet. */
  owed: number;
  /** Rows counted, including those with no figure. */
  count: number;
  /** Rows whose amount was left blank — the gap in `amount`. */
  blank: number;
}

/**
 * Rows under one heading within a section.
 *
 * `company` is null for food, which belongs to neither workspace: roughly a
 * quarter of the entries are one lunch ordered for both, and splitting those on
 * a rule nobody agreed to is exactly what the food log was built not to do.
 */
export interface ReportGroup {
  company: Company | null;
  rows: ReportRow[];
  totals: ReportTotal[];
}

export interface ReportSection {
  key: "vouchers" | "orders" | "food";
  title: string;
  /** What this section counts, in one line, printed under the heading. */
  blurb: string;
  groups: ReportGroup[];
  totals: ReportTotal[];
  /** False when the module's tables are not set up on this deployment. */
  available: boolean;
}

export interface ExpenseReport {
  range: ReportRange;
  /** "1 July 2026 to 31 July 2026", or "Everything to date". */
  periodLabel: string;
  sections: ReportSection[];
  /** Every section combined, still one figure per currency. */
  totals: ReportTotal[];
  /**
   * Anything that would make a figure here misread, in the report's own words.
   * Printed at the end, because a total nobody can check is the one thing this
   * must not produce.
   */
  notes: string[];
}

/* -------------------------------------------------------------------------
 * Dates
 *
 * A document's own date, not when it was typed. `spendRows` settles it the same
 * way, and it has to: if the report and the Expenditure page disagreed about
 * which month a voucher fell in, one of them would be wrong and there would be
 * no way to tell which.
 * ---------------------------------------------------------------------------*/

/** A yyyy-mm-dd, or "" for anything that isn't one. */
export function isoDate(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

const docDay = (own: string | null | undefined, createdAt: string): string =>
  (own || createdAt).slice(0, 10);

const within = (day: string, range: ReportRange): boolean =>
  (!range.from || day >= range.from) && (!range.to || day <= range.to);

export function periodLabel(range: ReportRange): string {
  if (!range.from && !range.to) return "Everything to date";
  if (range.from && range.to) return `${formatDate(range.from)} to ${formatDate(range.to)}`;
  if (range.from) return `${formatDate(range.from)} to date`;
  return `Up to ${formatDate(range.to!)}`;
}

/* -------------------------------------------------------------------------
 * Totals
 * ---------------------------------------------------------------------------*/

export function totalsOf(rows: ReportRow[]): ReportTotal[] {
  const byCurrency = new Map<string, ReportTotal>();

  for (const row of rows) {
    let t = byCurrency.get(row.currency);
    if (!t) {
      t = { currency: row.currency, amount: 0, owed: 0, count: 0, blank: 0 };
      byCurrency.set(row.currency, t);
    }
    t.count += 1;
    if (row.amount == null) {
      t.blank += 1;
      continue;
    }
    t.amount += row.amount;
    if (row.owed) t.owed += row.amount;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return [...byCurrency.values()]
    .map((t) => ({ ...t, amount: round(t.amount), owed: round(t.owed) }))
    // Largest first, so the currency that matters leads.
    .sort((a, b) => b.amount - a.amount);
}

/** Adds group totals into a section's, and section totals into the report's. */
function combine(sets: ReportTotal[][]): ReportTotal[] {
  const byCurrency = new Map<string, ReportTotal>();

  for (const set of sets) {
    for (const t of set) {
      const existing = byCurrency.get(t.currency);
      if (!existing) {
        byCurrency.set(t.currency, { ...t });
        continue;
      }
      existing.amount += t.amount;
      existing.owed += t.owed;
      existing.count += t.count;
      existing.blank += t.blank;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return [...byCurrency.values()]
    .map((t) => ({ ...t, amount: round(t.amount), owed: round(t.owed) }))
    .sort((a, b) => b.amount - a.amount);
}

/* -------------------------------------------------------------------------
 * Rows
 * ---------------------------------------------------------------------------*/

/**
 * Vouchers are money that has already left, whichever status they carry.
 *
 * `pending` here means the signed copy has not been scanned back in — a
 * statement about paperwork, not about whether the money moved. So `owed` stays
 * false on both, and the status column says which piece of paper is missing
 * rather than implying a debt. The note at the end of the report says so too,
 * because "awaiting signature" in a money column invites exactly that misread.
 */
/**
 * What a voucher actually printed, read defensively.
 *
 * Deliberately not `denormalize()` from db/shared, which this used to call.
 * That function reads `fields.on.amount` directly, and it gets away with it
 * because it only ever runs on a document being written — where the toggle block
 * has just come off the form. This report is the first thing in the portal to
 * run over *every stored voucher*, including ones written before that block
 * existed, and on those `fields.on` is undefined and the read throws. History
 * never hit it because History reads the denormalised columns instead.
 *
 * A missing toggle counts as ON rather than OFF. A legacy row stored the values
 * it printed, so treating them as absent would quietly drop real money out of
 * the total — and understating spend is the one direction this report must not
 * fail in.
 */
function voucherValues(fields: VoucherFields | null | undefined) {
  const f = fields ?? ({} as VoucherFields);
  const on = (f.on ?? {}) as Partial<Record<ToggleKey, boolean>>;
  const shown = (key: ToggleKey) => on[key] ?? true;

  const amount = shown("amount") ? toNumber(f.amount) : null;
  return {
    recipientName: shown("recipientName") ? (f.recipientName ?? "").trim() : "",
    description: shown("description") ? (f.description ?? "").trim() : "",
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    voucherDate: shown("voucherDate") ? f.voucherDate || null : null,
  };
}

function voucherRows(vouchers: Voucher[], range: ReportRange): ReportRow[] {
  return vouchers
    .map((v) => {
      const flat = voucherValues(v.fields);
      return {
        ref: v.voucherNo,
        date: docDay(flat.voucherDate, v.createdAt),
        party: flat.recipientName || "—",
        details: flat.description || "—",
        // PKR by construction: the voucher has no currency field, and every one
        // ever printed has been in Rupees. `spendRows` assumes the same.
        currency: "PKR",
        amount: flat.amount,
        status: v.status === "completed" ? "Signed" : "Awaiting signature",
        owed: false,
      };
    })
    .filter((row) => within(row.date, range))
    .sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

/**
 * Only orders whose invoice is on file, and which are closed.
 *
 * Both halves are checked rather than either alone, because they can disagree.
 * `PoStatusActions` offers a plain "Close order" on an issued order, so a closed
 * order need not have an invoice; and "Reopen" leaves an attached invoice in
 * place, so an invoiced order need not still be closed. What belongs in a spend
 * report is the intersection: the vendor billed us, and the order is done.
 */
function orderRows(orders: PurchaseOrder[], range: ReportRange): ReportRow[] {
  return orders
    .filter((po) => po.status === "closed" && po.invoiceKey != null)
    .map((po) => {
      // Read through optionals for the same reason `voucherValues` exists: this
      // runs over every stored order, and an old one's document need not have
      // every block a current one has. `vendor_name` and `subject` are also
      // columns on the row, so the fallbacks are only for a document that has
      // drifted from both.
      const doc = po.doc ?? ({} as PurchaseOrder["doc"]);
      return {
        ref: po.poNo,
        date: docDay(doc.poDate, po.createdAt),
        party: doc.vendor?.name || "—",
        details: doc.subject || "—",
        currency: doc.currency || "PKR",
        amount: po.total ?? null,
        status: "Invoiced",
        owed: false,
      };
    })
    .filter((row) => within(row.date, range))
    .sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

/**
 * Every live entry, settled or not.
 *
 * The food was eaten, so the expense was incurred — which is why a pending entry
 * is counted in full and flagged rather than held back until somebody is paid.
 * `owed` is what puts "yet to pay" on the row.
 */
function foodRows(entries: FoodExpense[], range: ReportRange): ReportRow[] {
  return entries
    .map((e) => ({
      ref: e.entryNo,
      date: e.date,
      party: e.vendor || "—",
      details: e.details || "—",
      currency: e.currency || "PKR",
      amount: e.amount,
      status: e.status === "paid" ? "Paid" : "Yet to pay",
      owed: e.status === "pending",
    }))
    .filter((row) => within(row.date, range))
    .sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

/* -------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------------*/

/**
 * High enough that no real period comes near it, and matched to the ceilings the
 * Supabase backend already puts on its own unpaged reads. It is still a cap, so
 * `buildReport` compares what came back against the reported total and says so
 * in the notes if anything was left off — a report that quietly stops at row
 * 5000 reads exactly like one that covered everything.
 */
const MAX_ROWS = 5000;

export async function buildReport(db: Store, range: ReportRange): Promise<ExpenseReport> {
  const notes: string[] = [];

  // Both companies and the food log in one pass. Tolerated per module: a
  // deployment where purchase orders were never migrated should still produce a
  // voucher and food report rather than an error page.
  const [perCompany, food] = await Promise.all([
    Promise.all(
      COMPANY_LIST.map(async (company) => {
        const [vouchers, orders] = await Promise.all([
          tryTable(() =>
            db.search({ company: company.slug, status: "all", limit: MAX_ROWS }),
          ),
          tryTable(() =>
            db.searchPos({ company: company.slug, status: "closed", limit: MAX_ROWS }),
          ),
        ]);
        return { company, vouchers, orders };
      }),
    ),
    tryTable(() => db.foodInRange(range.from, range.to)),
  ]);

  /** Names a module whose cap was hit, so the shortfall is never silent. */
  const checkCap = (label: string, got: number, total: number) => {
    if (total > got) {
      notes.push(
        `Only the first ${got} of ${total} ${label} are included — capped at ${MAX_ROWS} per company. Narrow the dates to see the rest.`,
      );
    }
  };

  /* ---- vouchers ----------------------------------------------------------- */

  const voucherGroups: ReportGroup[] = [];
  let vouchersAvailable = false;

  for (const { company, vouchers } of perCompany) {
    if (!vouchers.ok) continue;
    vouchersAvailable = true;
    checkCap(`${company.name} vouchers`, vouchers.value.rows.length, vouchers.value.total);
    const rows = voucherRows(vouchers.value.rows, range);
    voucherGroups.push({ company, rows, totals: totalsOf(rows) });
  }

  /* ---- purchase orders ---------------------------------------------------- */

  const orderGroups: ReportGroup[] = [];
  let ordersAvailable = false;

  for (const { company, orders } of perCompany) {
    if (!orders.ok) continue;
    ordersAvailable = true;
    checkCap(`${company.name} purchase orders`, orders.value.rows.length, orders.value.total);
    const rows = orderRows(orders.value.rows, range);
    orderGroups.push({ company, rows, totals: totalsOf(rows) });
  }

  /* ---- food --------------------------------------------------------------- */

  // Already bounded by the query, but filtered again so one rule decides the
  // period for all three sections rather than two rules agreeing by luck.
  const foodList = food.ok ? foodRows(food.value, range) : [];
  const foodGroups: ReportGroup[] =
    food.ok && foodList.length > 0
      ? [{ company: null, rows: foodList, totals: totalsOf(foodList) }]
      : [];

  const sections: ReportSection[] = [
    {
      key: "vouchers",
      title: "Vouchers",
      blurb: "Money paid out.",
      groups: voucherGroups,
      totals: combine(voucherGroups.map((g) => g.totals)),
      available: vouchersAvailable,
    },
    {
      key: "orders",
      title: "Purchase orders",
      blurb: "Closed orders with the vendor's invoice on file. Open orders are excluded.",
      groups: orderGroups,
      totals: combine(orderGroups.map((g) => g.totals)),
      available: ordersAvailable,
    },
    {
      key: "food",
      title: "Food and refreshments",
      blurb: "For either company or both. Counted whether settled or not.",
      groups: foodGroups,
      totals: combine(foodGroups.map((g) => g.totals)),
      available: food.ok,
    },
  ];

  const totals = combine(sections.map((s) => s.totals));

  /* ---- the notes ---------------------------------------------------------- */

  if (!ordersAvailable) {
    notes.push("Purchase orders are not set up here, so these figures cover vouchers and food only.");
  }
  if (!food.ok) {
    notes.push("The food log is not set up here, so no food expenditure is included.");
  }

  const blank = totals.reduce((n, t) => n + t.blank, 0);
  if (blank > 0) {
    notes.push(
      `${blank} voucher ${blank === 1 ? "amount was" : "amounts were"} left blank to be written in by hand, so ${blank === 1 ? "it is" : "they are"} not in the totals.`,
    );
  }

  const owed = totals.filter((t) => t.owed > 0);
  if (owed.length > 0) {
    notes.push(
      "Food counts from the day it was ordered. Rows marked “yet to pay” are in the totals but not yet settled.",
    );
  }

  if (voucherGroups.some((g) => g.rows.some((r) => r.status === "Awaiting signature"))) {
    notes.push(
      "“Awaiting signature” means the money was paid and only the signed copy is missing.",
    );
  }

  notes.push(
    "Dated by each document's own date, not when it was entered. Currencies are never added together. Deleted records, cancelled and draft orders, and orders without an invoice are excluded.",
  );

  return { range, periodLabel: periodLabel(range), sections, totals, notes };
}
