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
