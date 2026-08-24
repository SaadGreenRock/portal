import type { CompanySlug } from "../companies";
import { formatMoney } from "../money";

/**
 * Investor funding, in tranches.
 *
 * Money arrives from one outside investor in lumps rather than per purchase: a
 * wire of dollars, converted at whatever rate that week gave, landing as rupees
 * in a Pakistani account. Every expense the portal records is then paid out of
 * one of those lumps. This module is the ledger that ties the two together.
 *
 * A tranche is a bucket. It stores exactly two figures — what was sent and what
 * was received — and everything else about it is arithmetic on those. The rate
 * is deliberately NOT a field: derived as received ÷ sent it can never disagree
 * with the two numbers printed beside it, and it is automatically the *effective*
 * rate, with the bank's charge on the inward remittance already inside it,
 * because the received figure is what actually landed in the account.
 *
 * An allocation is one debit from one bucket. The rule that makes the whole
 * module work is that an allocation carries its own amount rather than pointing
 * at a document's total. That single choice is what lets one expense be paid out
 * of two tranches, lets an expense sit half-allocated while the next tranche is
 * still in the air, lets a voucher whose amount was left blank to be written by
 * hand still be attributed, and stops an edit to a voucher next month from
 * silently moving a bucket that was closed in July.
 *
 * The direction of dependency is one-way and worth stating: this module reads
 * vouchers, purchase orders and food entries so it can offer them for
 * allocation. Nothing in those modules reads a tranche, and no table of theirs
 * gained a column for this. A voucher does not know it has been allocated.
 */

/* -------------------------------------------------------------------------
 * Currency arithmetic
 * ---------------------------------------------------------------------------*/

/**
 * Money as whole paisa, for comparison.
 *
 * Every "is this bucket empty" and "is this expense fully covered" question is
 * answered on these integers, never on the floats. A bucket reading zero with
 * four paisa hiding inside it is the kind of thing that costs an afternoon six
 * months later, and `0.1 + 0.2 !== 0.3` is enough to produce one.
 */
export const paisa = (n: number): number => Math.round(n * 100);

/** Back to a storable, displayable figure. */
export const money = (n: number): number => Math.round(n * 100) / 100;

/* -------------------------------------------------------------------------
 * The bucket
 * ---------------------------------------------------------------------------*/

/** What the operator types when a tranche lands. */
export interface TrancheFields {
  /** Free label — "July 2026 wire". Optional; the number is the real identity. */
  label: string;
  /** Who sent it. One investor today, so it defaults rather than being demanded. */
  funder: string;
  /** What left the investor's account. */
  sentAmount: number;
  sentCurrency: string;
  /** ISO date (yyyy-mm-dd). */
  sentDate: string;
  /**
   * What landed here, net of the bank's charges — the pool everything draws
   * from. Deliberately the net figure: a gross amount plus a separate fee field
   * gives two ways to state one thing, and the account only agrees with one of
   * them.
   */
  recvAmount: number;
  recvCurrency: string;
  recvDate: string;
  /** Which account it landed in. */
  account: string | null;
  /** Advice or SWIFT number. */
  reference: string | null;
  notes: string | null;
}

export interface Tranche extends TrancheFields {
  id: string;
  /** `TR-001` — continuous, never resets. See `formatTrancheNo`. */
  trancheNo: string;
  seq: number;
  /**
   * Set when the bucket is closed by hand with money still in it.
   *
   * A bucket with ₨ 2,400 left in it that nothing will ever be small enough to
   * spend should stop being offered, and saying so is a decision rather than
   * arithmetic — which is why this is the one part of a bucket's state that is
   * stored. The remainder is stated on the card and still counts in total
   * received; it is never moved into another bucket, because it never moved in
   * the bank.
   */
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const TRANCHE_DEFAULTS: TrancheFields = {
  label: "",
  funder: "",
  sentAmount: 0,
  sentCurrency: "USD",
  sentDate: "",
  recvAmount: 0,
  recvCurrency: "PKR",
  recvDate: "",
  account: null,
  reference: null,
  notes: null,
};

/**
 * Rupees per dollar for this tranche, or null when it cannot be computed.
 *
 * Null rather than zero or Infinity: a tranche whose sent figure is still blank
 * has no rate, and a screen that printed "₨ 0.00 / $" for it would be stating
 * something false rather than admitting a gap.
 */
export function effectiveRate(t: Pick<Tranche, "sentAmount" | "recvAmount">): number | null {
  if (!(t.sentAmount > 0) || !(t.recvAmount > 0)) return null;
  return t.recvAmount / t.sentAmount;
}

/* -------------------------------------------------------------------------
 * The debit
 * ---------------------------------------------------------------------------*/

/**
 * What an allocation points at.
 *
 * `direct` is an expense that exists only in this ledger — the confidential
 * kind, with no voucher, order or food entry behind it. It is a source like any
 * other so that every rupee leaving a bucket is the same shape of row and the
 * total is checkable by adding one column.
 *
 * `misc` is the opposite case and worth not confusing with it: a miscellaneous
 * payment is perfectly public — it sits in a company workspace and counts in the
 * expenditure report — it simply has no document behind it. Both lack paperwork;
 * only one of them is deliberately kept out of the rest of the portal.
 */
export type SourceKind = "voucher" | "po" | "food" | "misc" | "direct";

export const SOURCE_KINDS: SourceKind[] = ["voucher", "po", "food", "misc", "direct"];

export const SOURCE_LABELS: Record<SourceKind, string> = {
  voucher: "Voucher",
  po: "Purchase order",
  food: "Food",
  misc: "Miscellaneous",
  direct: "Direct entry",
};

/** Plural, for a summary line. */
export const SOURCE_LABELS_PLURAL: Record<SourceKind, string> = {
  voucher: "Vouchers",
  po: "Purchase orders",
  food: "Food",
  misc: "Miscellaneous",
  direct: "Direct entries",
};

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === "string" && (SOURCE_KINDS as string[]).includes(v);
}

/**
 * One debit from one bucket.
 *
 * Three amounts, and the difference between them is the whole of the currency
 * story:
 *
 *   `amount`       what leaves the bucket, in the bucket's received currency.
 *                  The authoritative figure — the only one a balance is built
 *                  from.
 *   `sourceAmount` how much of the document this covers, in the document's own
 *                  currency. What the over-allocation guard counts, and what
 *                  makes a split add up against the document rather than
 *                  against the bucket.
 *   `sourceTotal`  the document's whole total when this row was written, kept so
 *                  a ledger line can say "part of ₨ 340,000" without joining to
 *                  three other tables, and so drift is detectable later.
 *
 * On the ordinary case — a rupee voucher against a rupee bucket — the first two
 * are equal and `rate` is 1. They part company only when the document is in
 * another currency, which today means a purchase order raised in SAR.
 */
export interface Allocation {
  id: string;
  trancheId: string;
  sourceKind: SourceKind;
  sourceId: string;
  /** Leaves the bucket. Bucket's received currency. */
  amount: number;
  /** Portion of the document covered. Document's currency. */
  sourceAmount: number;
  /**
   * The document's total when this was written, or null where the document has
   * no recorded total — a voucher with the amount left blank to be filled in by
   * hand. Null is why such a row can never read as fully allocated: there is
   * nothing to compare against.
   */
  sourceTotal: number | null;
  sourceCurrency: string;
  /** `amount / sourceAmount`. Exactly 1 when the currencies match. */
  rate: number;
  /** `GR-PV-202607-014`, snapshotted so a deleted document still reads. */
  sourceRef: string;
  sourceLabel: string;
  sourceCompany: CompanySlug | null;
  /** The document's own date. ISO. */
  sourceDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the allocate action is handed for one new row. */
export interface NewAllocation {
  trancheId: string;
  sourceKind: SourceKind;
  sourceId: string;
  amount: number;
  sourceAmount: number;
  sourceTotal: number | null;
  sourceCurrency: string;
  rate: number;
  sourceRef: string;
  sourceLabel: string;
  sourceCompany: CompanySlug | null;
  sourceDate: string;
  note: string | null;
}

/* -------------------------------------------------------------------------
 * Direct entries
 * ---------------------------------------------------------------------------*/

/**
 * An expense that lives only in this ledger.
 *
 * Confidential in a structural sense rather than an enforced one: because
 * nothing outside this module reads the table, these never appear in the
 * expenditure report, on the landing card's figures, or anywhere in either
 * company workspace. They are invisible to every screen but this one. What that
 * does not do is keep out somebody who already has the portal password — there
 * is one gate and it opens everything.
 *
 * The honest consequence, which the tranche screen states rather than hides: the
 * allocations on a bucket will exceed what the expenditure report knows about,
 * by exactly the value of the direct entries in it.
 */
export interface DirectFields {
  /** ISO date the money went out. */
  date: string;
  /** Who was paid. */
  payee: string;
  details: string;
  amount: number;
  currency: string;
  /**
   * A label, if it belongs to one company. Null for neither. Never parsed into
   * an accounting split — the same rule the food log's `orderedFor` follows.
   */
  company: CompanySlug | null;
  notes: string | null;
}

export interface DirectExpense extends DirectFields {
  id: string;
  /** `TE-202608-001` — no company prefix, like the food log. */
  entryNo: string;
  seq: number;
  /** yyyymm the entry was logged in. */
  period: string;
  receiptKey: string | null;
  receiptName: string | null;
  receiptAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const DIRECT_DEFAULTS: DirectFields = {
  date: "",
  payee: "",
  details: "",
  amount: 0,
  currency: "PKR",
  company: null,
  notes: null,
};

/* -------------------------------------------------------------------------
 * Bucket standing
 * ---------------------------------------------------------------------------*/

/**
 * Where a bucket stands. Four of the five are arithmetic; only `closed` is a
 * decision somebody made.
 */
export type TrancheState = "unspent" | "in-use" | "spent" | "closed" | "overdrawn";

export const STATE_LABELS: Record<TrancheState, string> = {
  unspent: "Unspent",
  "in-use": "In use",
  spent: "Fully spent",
  closed: "Closed",
  overdrawn: "Overdrawn",
};

export interface TrancheStanding {
  tranche: Tranche;
  /** Drawn from the bucket, in its received currency. */
  allocated: number;
  /** Received less allocated. Negative means overdrawn, and is shown as such. */
  remaining: number;
  /** 0–1, clamped for a progress bar. Never above 1 even when overdrawn. */
  used: number;
  state: TrancheState;
  rate: number | null;
  /**
   * What the allocations come to in the currency the investor sent, at this
   * tranche's own rate — the figure to quote back to whoever wired the money.
   *
   * Always this bucket's rate, never a blended one. Keeping the buckets separate
   * is the entire reason the module exists: a July expense converted at a
   * September rate is a number nobody can check against a bank statement.
   */
  sentEquivalent: number | null;
  /** Allocated, split by what it was spent on. */
  byKind: Record<SourceKind, number>;
  /** How many allocation rows, for a one-line summary. */
  count: number;
  /**
   * Of `allocated`, how much came from direct entries — the part no other screen
   * in the portal can see. Stated so the two figures disagreeing is documented
   * rather than alarming.
   */
  directOnly: number;
  /** True when the bucket can still take allocations. */
  open: boolean;
}

/** One allocation reduced to what a balance needs. */
export type Debit = Pick<Allocation, "amount" | "sourceKind">;

/**
 * Rolls a bucket and its debits into everything a screen shows.
 *
 * Deliberately pure and deliberately here rather than in either backend, so the
 * figure on the landing card, the figure on the index and the figure on the
 * bucket's own page are the same function of the same rows and cannot drift
 * apart. It is the same bargain `summarise` makes in the expenditure module.
 */
export function stand(tranche: Tranche, debits: Debit[]): TrancheStanding {
  const byKind: Record<SourceKind, number> = { voucher: 0, po: 0, food: 0, misc: 0, direct: 0 };
  let allocatedPaisa = 0;

  for (const d of debits) {
    allocatedPaisa += paisa(d.amount);
    byKind[d.sourceKind] = money(byKind[d.sourceKind] + d.amount);
  }

  const receivedPaisa = paisa(tranche.recvAmount);
  const remainingPaisa = receivedPaisa - allocatedPaisa;
  const rate = effectiveRate(tranche);
  const allocated = allocatedPaisa / 100;

  // Order matters. Overdrawn is checked first because it is the one state that
  // needs attention whatever else is true of the bucket, and a closed bucket
  // that has gone negative is still a problem rather than a closed matter.
  const state: TrancheState =
    remainingPaisa < 0
      ? "overdrawn"
      : tranche.closedAt
        ? "closed"
        : allocatedPaisa === 0
          ? "unspent"
          : remainingPaisa === 0
            ? "spent"
            : "in-use";

  return {
    tranche,
    allocated,
    remaining: remainingPaisa / 100,
    used: receivedPaisa > 0 ? Math.min(1, Math.max(0, allocatedPaisa / receivedPaisa)) : 0,
    state,
    rate,
    sentEquivalent: rate ? money(allocated / rate) : null,
    byKind,
    count: debits.length,
    directOnly: byKind.direct,
    // A bucket that is exactly empty drops out of the picker on its own, with
    // nobody having to close it; closing is for the awkward remainder.
    open: !tranche.closedAt && remainingPaisa > 0,
  };
}

/* -------------------------------------------------------------------------
 * The other side: what can go in a bucket
 * ---------------------------------------------------------------------------*/

/** How much of one expense has been attributed. */
export type AllocationState = "none" | "part" | "full" | "over" | "unknown";

export const ALLOCATION_STATE_LABELS: Record<AllocationState, string> = {
  none: "Not allocated",
  part: "Part allocated",
  full: "Allocated",
  over: "Over-allocated",
  unknown: "No amount recorded",
};

/** Where a slice of one expense ended up. */
export interface Placement {
  trancheId: string;
  trancheNo: string;
  /** Portion of the document, in the document's currency. */
  sourceAmount: number;
  /** What it drew from that bucket, in the bucket's currency. */
  amount: number;
}

/**
 * One expense anywhere in the portal, reduced to what a bucket needs.
 *
 * The single seam between this module and the rest of the portal: three tables
 * are read into this one shape, plus direct entries, and nothing downstream
 * needs to know which module a row came from. A fourth expense module later
 * means one more branch in the backend method that builds these.
 */
export interface AllocatableItem {
  kind: SourceKind;
  id: string;
  /** `GR-PV-202607-014`. */
  ref: string;
  company: CompanySlug | null;
  /** The document's own date, or when it was created. ISO. */
  date: string;
  /** Who was paid — recipient, vendor, payee. */
  party: string;
  description: string;
  currency: string;
  /**
   * The document's total, or null where none was recorded — a voucher left
   * blank to be written in by hand at signing. Null is allocatable: you type
   * what was actually paid, and the row can simply never claim to be complete.
   */
  amount: number | null;
  /** The source module's own status, for a chip. */
  status: string;
  /** Already attributed, in this document's currency. */
  allocated: number;
  placements: Placement[];
}

/** Whether an expense is fully covered, and by how much it is not. */
export function allocationState(item: AllocatableItem): AllocationState {
  if (item.amount == null) return item.allocated > 0 ? "unknown" : "none";
  const total = paisa(item.amount);
  const done = paisa(item.allocated);
  if (done === 0) return "none";
  if (done > total) return "over";
  if (done === total) return "full";
  return "part";
}

/**
 * What is left of an expense to attribute, in its own currency.
 *
 * Null for a document with no recorded total: there is no remainder to compute,
 * and the operator supplies the figure instead.
 */
export function unallocated(item: AllocatableItem): number | null {
  if (item.amount == null) return null;
  return Math.max(0, (paisa(item.amount) - paisa(item.allocated)) / 100);
}

/**
 * Splits a figure across buckets, oldest received first, filling each.
 *
 * This is the answer to the case the whole module had to be designed around: a
 * bucket with ₨ 96,000 left and a ₨ 340,000 voucher to pay. Rather than refusing
 * — or, worse, letting the bucket go negative and quietly making every figure on
 * the page meaningless — the picker does this arithmetic in front of the
 * operator and proposes the rows.
 *
 * Oldest first because that is how the money was actually spent: you draw down
 * the tranche you have before the one that just landed. Returns as many rows as
 * it can fill and reports what it could not place, which is a real state — the
 * next tranche may still be in the air, and an expense is allowed to sit half
 * attributed rather than being forced into a bucket that cannot hold it.
 */
export function planSplit(
  need: number,
  buckets: Array<{ trancheId: string; trancheNo: string; remaining: number }>,
): { rows: Array<{ trancheId: string; trancheNo: string; amount: number }>; shortfall: number } {
  let left = paisa(need);
  const rows: Array<{ trancheId: string; trancheNo: string; amount: number }> = [];

  for (const b of buckets) {
    if (left <= 0) break;
    const room = paisa(b.remaining);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    rows.push({ trancheId: b.trancheId, trancheNo: b.trancheNo, amount: take / 100 });
    left -= take;
  }

  return { rows, shortfall: left / 100 };
}

/* -------------------------------------------------------------------------
 * Across every bucket
 * ---------------------------------------------------------------------------*/

export interface FundingSummary {
  /** Every live bucket, newest received first. */
  standings: TrancheStanding[];
  /** Totals per sent currency — never summed across them. */
  sent: Array<{ currency: string; total: number }>;
  /** Totals per received currency. */
  received: Array<{ currency: string; total: number }>;
  allocated: Array<{ currency: string; total: number }>;
  /** Unallocated rupees in buckets that are still open — money left to spend. */
  available: Array<{ currency: string; total: number }>;
  /**
   * Received ÷ sent across everything, per currency pair. Useful as a headline
   * and useless for attributing any single expense, which is why no bucket page
   * shows it.
   */
  blendedRate: number | null;
  counts: {
    tranches: number;
    open: number;
    closed: number;
    overdrawn: number;
    /** Closed with money still in them, and how much. */
    closedWithRemainder: number;
    closedRemainder: number;
  };
}

/** Adds a figure into a per-currency bucket list. */
function add(into: Map<string, number>, currency: string, amount: number): void {
  into.set(currency, money((into.get(currency) ?? 0) + amount));
}

const listOf = (m: Map<string, number>) =>
  [...m.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .filter((t) => t.total !== 0)
    .sort((a, b) => b.total - a.total);

/**
 * The portfolio line on the index.
 *
 * Currencies are kept apart here for the same reason the expenditure report
 * keeps them apart: a single figure adding dollars to rupees looks more
 * authoritative than either of its parts and means nothing at all.
 */
export function summariseFunding(standings: TrancheStanding[]): FundingSummary {
  const sent = new Map<string, number>();
  const received = new Map<string, number>();
  const allocated = new Map<string, number>();
  const available = new Map<string, number>();

  const counts = {
    tranches: standings.length,
    open: 0,
    closed: 0,
    overdrawn: 0,
    closedWithRemainder: 0,
    closedRemainder: 0,
  };

  for (const s of standings) {
    add(sent, s.tranche.sentCurrency, s.tranche.sentAmount);
    add(received, s.tranche.recvCurrency, s.tranche.recvAmount);
    add(allocated, s.tranche.recvCurrency, s.allocated);
    if (s.open) add(available, s.tranche.recvCurrency, s.remaining);

    if (s.state === "overdrawn") counts.overdrawn += 1;
    if (s.open) counts.open += 1;
    if (s.tranche.closedAt) {
      counts.closed += 1;
      if (paisa(s.remaining) > 0) {
        counts.closedWithRemainder += 1;
        counts.closedRemainder = money(counts.closedRemainder + s.remaining);
      }
    }
  }

  // Only when the whole portfolio is one currency pair. Two pairs make a
  // blended rate a division of unlike things, and it is a headline nicety
  // rather than something worth being wrong about.
  const sentList = listOf(sent);
  const recvList = listOf(received);
  const blendedRate =
    sentList.length === 1 && recvList.length === 1 && sentList[0].total > 0
      ? recvList[0].total / sentList[0].total
      : null;

  return {
    standings,
    sent: sentList,
    received: recvList,
    allocated: listOf(allocated),
    available: listOf(available),
    blendedRate,
    counts,
  };
}

/**
 * The work queue: expenses with money still unattributed.
 *
 * Oldest first, which is the order you would want to clear them in — and the
 * order the money actually went out.
 */
export function queue(items: AllocatableItem[]): AllocatableItem[] {
  return items
    .filter((i) => {
      const state = allocationState(i);
      return state === "none" || state === "part";
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Totals for the queue, per currency. Never summed across them. */
export function queueTotals(items: AllocatableItem[]): Array<{ currency: string; total: number }> {
  const m = new Map<string, number>();
  for (const item of items) {
    const left = unallocated(item);
    // A blank-amount voucher contributes nothing to the figure and is still in
    // the queue by count — the same distinction the expenditure report draws
    // when it reports how many vouchers had no amount recorded.
    if (left && left > 0) add(m, item.currency, left);
  }
  return listOf(m);
}

/* -------------------------------------------------------------------------
 * The two guards
 * ---------------------------------------------------------------------------*/

/**
 * Both refusals are worded here rather than in either backend, so SQLite and
 * Supabase cannot drift into telling the operator two different stories about
 * the same rejected allocation — and so each message can name the figure that
 * makes the remedy obvious rather than saying "not allowed".
 *
 * Enforced in the store rather than the action because the store is the only
 * place that can check and write atomically.
 */

/** A bucket may not be drawn below zero. */
export function overdrawMessage(
  trancheNo: string,
  currency: string,
  remaining: number,
  requested: number,
): string {
  return (
    `${trancheNo} has ${currency} ${formatMoney(remaining, currency)} left, ` +
    `and this would draw ${currency} ${formatMoney(requested, currency)} from it. ` +
    `Allocate ${currency} ${formatMoney(remaining, currency)} here and the rest to another tranche.`
  );
}

/** An expense may not be allocated for more than it is worth. */
export function overAllocateMessage(
  ref: string,
  currency: string,
  total: number,
  already: number,
  requested: number,
): string {
  const left = money(total - already);
  return already > 0
    ? `${ref} is worth ${currency} ${formatMoney(total, currency)} and ` +
        `${currency} ${formatMoney(already, currency)} of it is already allocated, ` +
        `so only ${currency} ${formatMoney(left, currency)} is left to attribute — ` +
        `this would attribute ${currency} ${formatMoney(requested, currency)}.`
    : `${ref} is worth ${currency} ${formatMoney(total, currency)}, ` +
        `and this would attribute ${currency} ${formatMoney(requested, currency)} of it.`;
}
