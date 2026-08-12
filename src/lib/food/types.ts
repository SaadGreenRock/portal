/**
 * The food and refreshments log: what was ordered, for whom, and who is still owed.
 *
 * Deliberately not company-scoped. Roughly a quarter of the entries this replaces
 * were ordered for "Green Rock + Sportech" — one lunch, two companies at the
 * table — so an entry has no single owner and there is no `CompanySlug` anywhere
 * in this module. `orderedFor` is a *label*: it records what was written on the
 * order, and nothing is ever split between the two companies on the strength of
 * it. A shared lunch is one expense, reported once.
 *
 * Two facts about an entry are independent, and conflating them was the flaw in
 * the spreadsheet this replaces:
 *
 *   paymentType — who fronted the money. `deferred` means the vendor is running
 *                 a tab for us; `employee-paid` means someone paid out of pocket.
 *   status      — whether that person or vendor has been squared up yet.
 *
 * The cross of the two is the whole point: `deferred` + `pending` is money owed
 * to a café, `employee-paid` + `pending` is a reimbursement somebody is waiting
 * on, and they are settled by different people on different days.
 *
 * Not a document. Nothing here is printed, so there is no typed document body,
 * no lifecycle status and no rendered PDF.
 */

/** Who fronted the money. */
export type PaymentType = "deferred" | "employee-paid";

export const PAYMENT_TYPES: PaymentType[] = ["deferred", "employee-paid"];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  deferred: "Deferred — on the vendor's tab",
  "employee-paid": "Employee paid — out of pocket",
};

/** The same thing in two words, for a chip or a table cell. */
export const PAYMENT_TYPE_SHORT: Record<PaymentType, string> = {
  deferred: "Deferred",
  "employee-paid": "Employee paid",
};

export function isPaymentType(v: unknown): v is PaymentType {
  return typeof v === "string" && (PAYMENT_TYPES as string[]).includes(v);
}

/** Whether whoever fronted the money has been squared up. */
export type FoodStatus = "pending" | "paid";

export const FOOD_STATUSES: FoodStatus[] = ["pending", "paid"];

export const FOOD_STATUS_LABELS: Record<FoodStatus, string> = {
  pending: "Pending",
  paid: "Paid",
};

export function isFoodStatus(v: unknown): v is FoodStatus {
  return typeof v === "string" && (FOOD_STATUSES as string[]).includes(v);
}

/**
 * The labels already in use for who an order was for.
 *
 * Offered as a `<datalist>`, never enforced. A fourth arrangement — a guest, a
 * site team, a third company — must not need a migration before lunch can be
 * logged, and the label carries no accounting meaning that a typo could corrupt.
 */
export const ORDERED_FOR_SUGGESTIONS = [
  "Green Rock",
  "Sportech",
  "Green Rock + Sportech",
];

/** What the operator types. Everything else about an entry is derived or stamped. */
export interface FoodFields {
  /** ISO date (yyyy-mm-dd) the food was ordered. */
  date: string;
  /** Free label — "Green Rock + Sportech". Never parsed into companies. */
  orderedFor: string;
  /** Who supplied it: "Kick Start Café". */
  vendor: string;
  /** What was ordered: "Lunch (Multiple Items)", "4x Kofta". */
  details: string;
  amount: number;
  currency: string;
  paymentType: PaymentType;
  /**
   * The employee who paid out of pocket. Null on a deferred order, where the
   * company never handed anything over and there is nobody to reimburse.
   */
  paidBy: string | null;
  status: FoodStatus;
  /**
   * ISO date the vendor or employee was squared up. Null while pending — and
   * also null on plenty of settled entries imported from the spreadsheet, which
   * recorded that they were paid without recording when.
   */
  paidAt: string | null;
  /** Cheque number, transfer reference — filled in by the settle flow. */
  reference: string | null;
  notes: string | null;
}

export interface FoodExpense extends FoodFields {
  id: string;
  /** `F-202608-001` — no company prefix, because the entry has no company. */
  entryNo: string;
  /** Running sequence within the month. */
  seq: number;
  /** yyyymm, from the date the entry was logged. */
  period: string;
  /**
   * Proof of payment: the receipt or invoice filed when this was settled.
   *
   * Not part of `FoodFields`, because it is not typed into the entry form — it
   * is attached by settling, the same way a voucher's signed scan is attached
   * rather than edited.
   *
   * Deliberately shareable. One cheque clears a whole café tab, so every entry
   * in that settlement carries the same key and the file is stored once. That is
   * why removing a receipt has to check whether anything else still points at it
   * before deleting the file.
   */
  receiptKey: string | null;
  receiptName: string | null;
  /** When the receipt was filed. Doubles as the preview's cache-buster. */
  receiptAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** True when the payment has a document behind it. */
export const hasReceipt = (e: FoodExpense): boolean => Boolean(e.receiptKey);

/** True while somebody is still owed for this. */
export const isOwed = (e: FoodExpense): boolean => e.status === "pending";

/**
 * Who is owed for a pending entry: the employee who fronted it, or the vendor
 * running the tab. The one string that both outstanding panels group by.
 */
export function payeeOf(e: FoodExpense): string {
  return e.paymentType === "employee-paid" ? (e.paidBy ?? "Unnamed employee") : e.vendor;
}

export interface FoodQuery {
  /** Free text across entry no., vendor, details, ordered-for and payer. */
  q?: string;
  /**
   * "pending" is anything still owed, "paid" is settled, "deleted" is the
   * recycle bin. Defaults to every live entry.
   */
  view?: "all" | "pending" | "paid" | "deleted";
  /** Inclusive ISO date bounds on the order date. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * The four figures the spreadsheet computed with SUMIFS, and the two counts that
 * make them checkable.
 *
 * `owedToVendors + owedToEmployees === totalOutstanding` always holds, because
 * an entry is one or the other and never both.
 */
export interface FoodCounts {
  /** Live entries. */
  total: number;
  /** Live entries still owed. */
  pending: number;
  /** SUM of every live entry, settled or not. */
  spentAllTime: number;
  /** Deferred and pending: the café's tab. */
  owedToVendors: number;
  /** Employee paid and pending: reimbursements waiting. */
  owedToEmployees: number;
  /** Everything pending, however it was fronted. */
  totalOutstanding: number;
}

/** One payee and everything still owed to them. */
export interface OwedGroup {
  /** Vendor name, or employee name. */
  payee: string;
  paymentType: PaymentType;
  entries: FoodExpense[];
  amount: number;
  /** The oldest order date in the group — how long they have been waiting. */
  since: string;
}

/** One day and everything still owed from it. */
export interface PendingDay {
  date: string;
  amount: number;
  count: number;
}

/**
 * The SUMIFS, once.
 *
 * Kept as a pure function over rows rather than pushed into SQL for the reason
 * the spend module gives: PostgREST cannot GROUP BY without a stored function,
 * and a food log is a few hundred rows a year. Both backends select the columns
 * and this decides what they mean, so the two can never drift.
 */
export function summariseFood(rows: FoodExpense[]): FoodCounts {
  const counts: FoodCounts = {
    total: 0,
    pending: 0,
    spentAllTime: 0,
    owedToVendors: 0,
    owedToEmployees: 0,
    totalOutstanding: 0,
  };

  for (const row of rows) {
    if (row.deletedAt) continue;
    counts.total += 1;
    counts.spentAllTime += row.amount;
    if (row.status !== "pending") continue;

    counts.pending += 1;
    counts.totalOutstanding += row.amount;
    if (row.paymentType === "employee-paid") counts.owedToEmployees += row.amount;
    else counts.owedToVendors += row.amount;
  }

  const money = (n: number) => Math.round(n * 100) / 100;
  return {
    ...counts,
    spentAllTime: money(counts.spentAllTime),
    owedToVendors: money(counts.owedToVendors),
    owedToEmployees: money(counts.owedToEmployees),
    totalOutstanding: money(counts.totalOutstanding),
  };
}

/**
 * Pending entries gathered per payee, largest debt first.
 *
 * Grouped case-insensitively on a trimmed name, because "Kick Start Café " and
 * "Kick Start Café" are one café and splitting the tab in two would understate
 * both. The first spelling seen wins as the display name.
 */
export function groupByPayee(rows: FoodExpense[], paymentType: PaymentType): OwedGroup[] {
  const groups = new Map<string, OwedGroup>();

  for (const row of rows) {
    if (row.deletedAt || row.status !== "pending" || row.paymentType !== paymentType) continue;

    const payee = payeeOf(row);
    const key = payee.trim().toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { payee: payee.trim(), paymentType, entries: [], amount: 0, since: row.date };
      groups.set(key, group);
    }
    group.entries.push(row);
    group.amount = Math.round((group.amount + row.amount) * 100) / 100;
    if (row.date < group.since) group.since = row.date;
  }

  for (const group of groups.values()) {
    group.entries.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  }

  return [...groups.values()].sort((a, b) => b.amount - a.amount);
}

/** Pending entries gathered per order date, oldest first. */
export function groupByDate(rows: FoodExpense[]): PendingDay[] {
  const days = new Map<string, PendingDay>();

  for (const row of rows) {
    if (row.deletedAt || row.status !== "pending") continue;
    let day = days.get(row.date);
    if (!day) {
      day = { date: row.date, amount: 0, count: 0 };
      days.set(row.date, day);
    }
    day.amount = Math.round((day.amount + row.amount) * 100) / 100;
    day.count += 1;
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Totals per vendor over whatever set of entries is in front of you. */
export function totalsByVendor(rows: FoodExpense[]): Array<{ name: string; amount: number; count: number }> {
  return totalsBy(rows, (r) => r.vendor);
}

/** Totals per "ordered for" label. A breakdown, deliberately not an allocation. */
export function totalsByOrderedFor(rows: FoodExpense[]): Array<{ name: string; amount: number; count: number }> {
  return totalsBy(rows, (r) => r.orderedFor);
}

function totalsBy(
  rows: FoodExpense[],
  pick: (row: FoodExpense) => string,
): Array<{ name: string; amount: number; count: number }> {
  const out = new Map<string, { name: string; amount: number; count: number }>();

  for (const row of rows) {
    if (row.deletedAt) continue;
    const raw = pick(row).trim() || "Not recorded";
    const key = raw.toLowerCase();
    let entry = out.get(key);
    if (!entry) {
      entry = { name: raw, amount: 0, count: 0 };
      out.set(key, entry);
    }
    entry.amount = Math.round((entry.amount + row.amount) * 100) / 100;
    entry.count += 1;
  }

  return [...out.values()].sort((a, b) => b.amount - a.amount);
}

/** A blank entry, dated today and on the vendor's tab — much the commonest case. */
export function emptyFood(today: string): FoodFields {
  return {
    date: today,
    orderedFor: "",
    vendor: "",
    details: "",
    amount: 0,
    currency: "PKR",
    paymentType: "deferred",
    paidBy: null,
    status: "pending",
    paidAt: null,
    reference: null,
    notes: null,
  };
}
