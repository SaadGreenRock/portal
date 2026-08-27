import type { PoDoc, PoItem } from "./types";

/**
 * The money on a purchase order, computed in exactly one place.
 *
 * The editor, the printed document and the stored record all call this, so the
 * figure the operator saw while typing is the figure on the PDF and the figure
 * History filters on. A second implementation anywhere would eventually
 * disagree by a rounding step, and a PO that disagrees with itself is worse
 * than no PO.
 */

export interface PoTotals {
  /** Line amount per item, in the same order as doc.items. */
  lines: number[];
  subtotal: number;
  discount: number;
  /** Subtotal less discount — what tax is charged on. */
  taxable: number;
  tax: number;
  shipping: number;
  total: number;
}

/** Two decimal places, avoiding the float dust that makes 0.1+0.2 visible. */
const money = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export function lineAmount(item: Pick<PoItem, "qty" | "unitPrice">): number {
  return money((Number(item.qty) || 0) * (Number(item.unitPrice) || 0));
}

export function poTotals(doc: PoDoc): PoTotals {
  const lines = doc.items.map(lineAmount);
  const subtotal = money(lines.reduce((sum, n) => sum + n, 0));

  // A discount larger than the order would otherwise produce a negative tax.
  const discount = Math.min(money(doc.discount), subtotal);
  const taxable = money(subtotal - discount);

  const tax = doc.showTax ? money((taxable * (Number(doc.taxRate) || 0)) / 100) : 0;
  const shipping = money(doc.shipping);

  return {
    lines,
    subtotal,
    discount,
    taxable,
    tax,
    shipping,
    total: money(taxable + tax + shipping),
  };
}

/** Items with nothing typed in them don't belong on a printed order. */
export function usableItems(doc: PoDoc): PoItem[] {
  return doc.items.filter((i) => i.description.trim() || i.code.trim() || lineAmount(i) > 0);
}

/**
 * One line item, with its share of what the order actually cost.
 *
 * Read by the expenditure tags and nothing else. The purchase order itself —
 * the editor, the printed page, the stored totals — is untouched by this: it is
 * a second question asked of the same document, not a change to it.
 */
export interface AttributedLine {
  item: PoItem;
  /** qty x unit price, exactly as the order prints it. */
  line: number;
  /**
   * `line` plus this row's share of the order's discount, tax and shipping.
   *
   * Together these add up to the order's own `total`, to the paisa — which is
   * the whole reason the figure exists. A tag total built from `line` alone
   * would come to the subtotal and leave the tax sitting outside every tag,
   * unattributable and quietly missing from "what did we spend on laptops".
   */
  amount: number;
}

/**
 * Spreads the order-level charges across the lines they were charged on.
 *
 * By line value, which for two of the three is not a rule but arithmetic: the
 * tax *is* a percentage of the taxable value, and the discount comes off the
 * subtotal, so each line's share of either is exactly its share of the subtotal.
 * Shipping is the one that genuinely has to be decided, and by value is the
 * ordinary answer — a consignment's freight tracks what is in it more closely
 * than it tracks how many rows the order happened to have.
 *
 * Two edges worth naming:
 *
 *   An order whose lines are all priced at zero but which still carries shipping
 *   has no values to spread by, so it is split evenly. Nothing else can be true
 *   of it.
 *
 *   Rounding to the paisa leaves a residual of a paisa or two, which goes on the
 *   largest line. Left where it fell the set would not add up to the order, and
 *   a breakdown that misses its own total by a paisa is one nobody trusts the
 *   rest of.
 *
 * Empty rows are dropped — see `usableItems`. They carry no money, so they can
 * take no share of it, and they are not something anybody bought.
 */
export function attributedLines(doc: PoDoc): AttributedLine[] {
  const totals = poTotals(doc);
  const items = usableItems(doc);
  if (items.length === 0) return [];

  const lines = items.map(lineAmount);
  // tax + shipping - discount. Negative when a discount outweighs both.
  const spread = money(totals.total - totals.subtotal);

  const rows = items.map((item, i) => ({
    item,
    line: lines[i],
    amount: money(
      lines[i] + spread * (totals.subtotal > 0 ? lines[i] / totals.subtotal : 1 / items.length),
    ),
  }));

  const drift = money(totals.total - rows.reduce((sum, r) => sum + r.amount, 0));
  if (drift !== 0) {
    let biggest = 0;
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i].amount) > Math.abs(rows[biggest].amount)) biggest = i;
    }
    rows[biggest].amount = money(rows[biggest].amount + drift);
  }

  return rows;
}
