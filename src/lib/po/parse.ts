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
 * Every field is coerced to its expected type and clamped; a bad value becomes
 * a sane one rather than an exception, because losing a whole order to one
 * malformed number would be the worse failure.
 */

/** Trimmed, and capped so no single field can bloat a row. */
export const text = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

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
  const s = text(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

const MAX_ITEMS = 200;

function readItem(raw: unknown): PoItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(r.id, 64) || newRowId(),
    code: text(r.code, 80),
    description: text(r.description, 2000),
    qty: quantity(r.qty),
    unit: text(r.unit, 24),
    unitPrice: money(r.unitPrice),
  };
}

function readVendor(raw: unknown): PoVendor {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: text(r.name, 200),
    address: text(r.address, 600),
    contact: text(r.contact, 160),
    phone: text(r.phone, 60),
    email: text(r.email, 160),
    taxId: text(r.taxId, 60),
  };
}

/** Rebuilds a complete, safe document from an untrusted payload. */
export function readPoDoc(raw: unknown): PoDoc {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.slice(0, MAX_ITEMS).map(readItem) : [];
  const currency = text(r.currency, 8).toUpperCase();

  return {
    vendor: readVendor(r.vendor),
    poDate: isoDate(r.poDate),
    deliveryDate: isoDate(r.deliveryDate),
    deliveryAddress: text(r.deliveryAddress, 600),
    paymentTerms: text(r.paymentTerms, 300),
    reference: text(r.reference, 160),
    subject: text(r.subject, 300),
    currency: currency in CURRENCIES ? currency : "PKR",
    taxLabel: text(r.taxLabel, 40) || "Tax",
    taxRate: Math.min(100, Math.max(0, Number(r.taxRate) || 0)),
    showTax: r.showTax !== false,
    discount: money(r.discount),
    shipping: money(r.shipping),
    items,
    notes: text(r.notes, 4000),
    terms: text(r.terms, 8000),
    preparedBy: text(r.preparedBy, 160),
    approvedBy: text(r.approvedBy, 160),
  };
}
