import { CURRENCIES } from "../money";
import { newRowId, type PoDoc, type PoItem, type PoVendor } from "./types";

/**
 * Turning an untrusted purchase order payload into a document we can store.
 *
 * Deliberately not in actions.ts: every exported async function in a
 * "use server" module becomes a publicly callable endpoint, and this is also
 * needed by the preview route, which is not an action.
 *
 * The payload arrives as JSON from the browser, so nothing in it is trusted.
 * Numbers are clamped — a nonsense figure is a hostile payload, and refusing the
 * whole order over one of them would be the worse failure. Text and the line
 * item list are *refused* when they exceed their limits, because quietly cutting
 * either loses something a person typed with no way for them to notice.
 */

/**
 * Trimmed, and refused if it exceeds its limit.
 *
 * Deliberately *not* truncated. Silently cutting a description or a part number
 * in half loses something a person typed and gives them no way to notice, which
 * for a records system is the worst failure available. Numbers below are clamped
 * instead, because a nonsense number is a hostile payload rather than lost work.
 */
export function text(v: unknown, max: number, field: string): string {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  if (trimmed.length > max) {
    throw new Error(
      `${field} is too long: ${trimmed.length} characters, and the limit is ${max}.`,
    );
  }
  return trimmed;
}

const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  // A trillion is far beyond any real order, and the ceiling keeps a pasted
  // exponent from producing a figure too wide for its printed column.
  return Math.min(Math.round(n * 100) / 100, 1e12);
};

const quantity = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 1000) / 1000, 1e9);
};

/** yyyy-mm-dd, or "" — anything else would print as garbage on the document. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/**
 * Far more than any order this is used for, and low enough that the document
 * stays a document. Exceeded, it refuses rather than dropping the surplus.
 */
export const MAX_ITEMS = 200;

function readItem(raw: unknown): PoItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(r.id, 64, "Row id") || newRowId(),
    code: text(r.code, 80, "Item code"),
    description: text(r.description, 2000, "Item description"),
    qty: quantity(r.qty),
    unit: text(r.unit, 24, "Unit"),
    unitPrice: money(r.unitPrice),
  };
}

function readVendor(raw: unknown): PoVendor {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: text(r.name, 200, "Vendor name"),
    address: text(r.address, 600, "Vendor address"),
    contact: text(r.contact, 160, "Contact person"),
    phone: text(r.phone, 60, "Phone"),
    email: text(r.email, 160, "Email"),
    taxId: text(r.taxId, 60, "Tax registration number"),
  };
}

/** Rebuilds a complete, safe document from an untrusted payload. */
export function readPoDoc(raw: unknown): PoDoc {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  if (rawItems.length > MAX_ITEMS) {
    throw new Error(
      `That order has ${rawItems.length} line items, and the limit is ${MAX_ITEMS}. ` +
        "Split it into more than one order.",
    );
  }
  const items = rawItems.map(readItem);
  const currency = text(r.currency, 8, "Currency").toUpperCase();

  return {
    vendor: readVendor(r.vendor),
    poDate: isoDate(r.poDate),
    deliveryDate: isoDate(r.deliveryDate),
    deliveryAddress: text(r.deliveryAddress, 600, "Delivery address"),
    paymentTerms: text(r.paymentTerms, 300, "Payment terms"),
    reference: text(r.reference, 160, "Reference"),
    subject: text(r.subject, 300, "Subject"),
    currency: currency in CURRENCIES ? currency : "PKR",
    taxLabel: text(r.taxLabel, 40, "Tax label") || "Tax",
    taxRate: Math.min(100, Math.max(0, Number(r.taxRate) || 0)),
    showTax: r.showTax !== false,
    discount: money(r.discount),
    shipping: money(r.shipping),
    items,
    notes: text(r.notes, 4000, "Notes"),
    terms: text(r.terms, 8000, "Terms and conditions"),
    approvedBy: text(r.approvedBy, 160, "Approved by"),
  };
}
