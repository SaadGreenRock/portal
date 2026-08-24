import type { CompanySlug } from "../companies";

/**
 * Miscellaneous payments: money that left the company with no document behind it.
 *
 * Every other spend module in the portal is built around a piece of paper. A
 * voucher exists to be printed and signed; a purchase order exists to be issued
 * to a vendor. This one deliberately has none — no template, no PDF, no
 * signature block, and nothing to render. The record *is* the record.
 *
 * That is the whole reason it exists. The parking fee, the courier, the tip to
 * the man who carried the water bottles up: real money, out of the same account,
 * and until now with nowhere to go. The options were to raise a voucher nobody
 * would ever sign — which puts a permanent gap in the voucher sequence and a
 * fiction in the file — or to leave it out of the totals entirely, which is what
 * was happening and is why the figures never quite matched the bank.
 *
 * So an entry is three facts and an optional fourth:
 *
 *   date     when the money went out.
 *   amount   how much, in one currency.
 *   notes    what it was for. The only description there is, which is why it is
 *            required — an amount with no account of itself is unauditable, and
 *            six months from now the note is the only thing that will explain it.
 *   proof    a photograph or a PDF, when there is one. Often there is not, and
 *            that is an ordinary state rather than an omission to chase.
 *
 * Company-scoped, unlike the food log. Food is shared because a lunch is
 * genuinely ordered for both companies at once; a payment is made out of one
 * company's money, so it has an owner and belongs in that workspace's totals.
 *
 * Two things this is deliberately NOT:
 *
 *   Not a status machine. There is no pending state and no settlement: the
 *   money has already gone by the time anybody types this in. The only thing
 *   that can arrive later is the receipt, which is why proof is attached rather
 *   than being part of what the form saves.
 *
 *   Not a way around vouchers. A payment somebody can be made to sign for
 *   should be a voucher, and the form says so. This is for the ones where
 *   nobody can.
 */

/** What the operator types. Everything else is derived, stamped or attached. */
export interface MiscFields {
  /** ISO date (yyyy-mm-dd) the money went out. */
  date: string;
  amount: number;
  /** Code from CURRENCIES in money.ts. PKR unless somebody says otherwise. */
  currency: string;
  /**
   * What the payment was for. Required, and the only description the record has
   * — see the note above.
   */
  notes: string;
}

export interface MiscPayment extends MiscFields {
  id: string;
  company: CompanySlug;
  /** `GR-MP-202608-001` — company prefix, the misc marker, period, sequence. */
  paymentNo: string;
  /** Running sequence within the company and month. */
  seq: number;
  /** yyyymm, from the date the row was logged. */
  period: string;
  /**
   * The receipt, bill or screenshot, when one exists.
   *
   * Not part of `MiscFields`, because it is not typed into a form — it is
   * attached, the same way a voucher's signed scan is. Unlike a food receipt it
   * is never shared: one payment, one document, its own key. So removing it can
   * delete the file outright with no reference count to check first.
   */
  proofKey: string | null;
  proofName: string | null;
  /** When the proof was filed. Doubles as the preview's cache-buster. */
  proofAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** True when there is a document behind the payment. */
export const hasProof = (p: MiscPayment): boolean => Boolean(p.proofKey);

export interface MiscQuery {
  company: CompanySlug;
  /** Free text across the payment number and the notes. */
  q?: string;
  /**
   * Defaults to every live payment. "deleted" is the recycle bin; the two proof
   * views exist because "which of these can I actually evidence" is the one
   * question somebody asks of this list that the notes cannot answer.
   */
  view?: "all" | "with-proof" | "no-proof" | "deleted";
  /** Inclusive ISO date bounds on the payment date. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * The figures the log carries across its top.
 *
 * `byCurrency` rather than one total, for the reason the expenditure module
 * gives at length: adding Rupees to Riyals produces a number that looks
 * authoritative and means nothing. Green Rock pays some things in Riyals, so
 * this is not hypothetical here.
 */
export interface MiscCounts {
  /** Live payments. */
  total: number;
  /** Live payments with nothing filed against them. */
  withoutProof: number;
  /** Spent per currency, never across. Largest first. */
  byCurrency: Array<{ currency: string; amount: number }>;
}

/**
 * The counts, once.
 *
 * A pure function over rows rather than SQL, the same choice the food log and
 * the expenditure module make and for the same reason: PostgREST cannot
 * aggregate without a stored function, which is another migration somebody has
 * to remember to run, and this is a few hundred rows a year. Both backends
 * select the columns and this decides what they mean, so the two can never
 * disagree about a figure.
 */
export function summariseMisc(rows: MiscPayment[]): MiscCounts {
  let total = 0;
  let withoutProof = 0;
  const sums = new Map<string, number>();

  for (const row of rows) {
    if (row.deletedAt) continue;
    total += 1;
    if (!row.proofKey) withoutProof += 1;
    const currency = row.currency || "PKR";
    sums.set(currency, (sums.get(currency) ?? 0) + row.amount);
  }

  const byCurrency = [...sums.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  return { total, withoutProof, byCurrency };
}

/** A blank payment, dated today and in Rupees — much the commonest case. */
export function emptyMisc(today: string): MiscFields {
  return { date: today, amount: 0, currency: "PKR", notes: "" };
}
