import { CURRENCIES } from "../money";
import { text } from "../po/parse";
import { newRfqRowId, type RfqDoc, type RfqItem } from "./types";

/**
 * Turning an untrusted request-for-quotation payload into a document.
 *
 * Same contract as the purchase order parser, and it borrows that module's
 * `text` so both refuse over-long input identically: quantities are clamped,
 * because a nonsense number is a hostile payload, while text is refused, because
 * quietly cutting it loses something a person typed.
 *
 * Not in actions.ts, because every exported async function in a "use server"
 * module becomes a public endpoint, and the preview route needs this too.
 */

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
 * Far more than any request will carry, and low enough that the document stays a
 * document. Exceeded, it refuses rather than dropping the surplus.
 */
export const MAX_RFQ_ITEMS = 200;

function readItem(raw: unknown): RfqItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(r.id, 64, "Row id") || newRfqRowId(),
    code: text(r.code, 80, "Item code"),
    description: text(r.description, 2000, "Item description"),
    qty: quantity(r.qty),
    unit: text(r.unit, 24, "Unit"),
  };
}

/** Rebuilds a complete, safe document from an untrusted payload. */
export function readRfqDoc(raw: unknown): RfqDoc {
  const r = (raw ?? {}) as Record<string, unknown>;

  const rawItems = Array.isArray(r.items) ? r.items : [];
  if (rawItems.length > MAX_RFQ_ITEMS) {
    throw new Error(
      `That request has ${rawItems.length} line items, and the limit is ${MAX_RFQ_ITEMS}. ` +
        "Split it into more than one request.",
    );
  }

  const currency = text(r.currency, 8, "Currency").toUpperCase();

  return {
    rfqDate: isoDate(r.rfqDate),
    replyBy: isoDate(r.replyBy),
    subject: text(r.subject, 300, "Subject"),
    deliveryAddress: text(r.deliveryAddress, 600, "Delivery location"),
    currency: currency in CURRENCIES ? currency : "PKR",
    contactName: text(r.contactName, 160, "Contact name"),
    contactEmail: text(r.contactEmail, 160, "Contact email"),
    contactPhone: text(r.contactPhone, 60, "Contact phone"),
    items: rawItems.map(readItem),
    notes: text(r.notes, 4000, "Notes"),
    terms: text(r.terms, 8000, "Terms and conditions"),
    preparedBy: text(r.preparedBy, 160, "Prepared by"),
  };
}

/** Items with nothing typed in them don't belong on a printed request. */
export function usableRfqItems(doc: RfqDoc): RfqItem[] {
  return doc.items.filter((i) => i.description.trim() || i.code.trim());
}
