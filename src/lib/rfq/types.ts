import type { CompanySlug } from "../companies";
import type { RfqSettings } from "../settings";

/**
 * Requests for quotation.
 *
 * The opposite of a purchase order in the one way that matters: a PO states the
 * prices, an RFQ leaves them blank for the vendor to fill in. So there is no
 * money on this document and nothing to total — the columns are ruled and empty,
 * and the vendor writes into them.
 *
 * There is deliberately no vendor on the record either. One generic request is
 * produced and sent to whichever vendors the operator chooses, by whatever means
 * they already use. Addressing it per vendor, tracking who replied and comparing
 * quotes are all separate features; none of them are pretended at here.
 */
export type RfqStatus = "draft" | "sent" | "closed" | "cancelled";

export const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** "Open" is the working set: raised but not yet done with. */
export const RFQ_OPEN_STATUSES: RfqStatus[] = ["draft", "sent"];

/**
 * What, if anything, is stamped across the printed page.
 *
 * As with purchase orders, this doubles as the answer to "does the rendered PDF
 * depend on the status?" — sent and closed stamp nothing, so moving between them
 * leaves the document byte-identical.
 */
export function rfqWatermarkFor(status: RfqStatus): string | null {
  if (status === "draft") return "DRAFT";
  if (status === "cancelled") return "CANCELLED";
  return null;
}

export interface RfqItem {
  /**
   * Stable row key, kept in the document rather than derived from the array
   * index so inserting a row above doesn't move the operator's cursor.
   */
  id: string;
  /** Part number or internal item code. Optional. */
  code: string;
  description: string;
  qty: number;
  /** pcs, kg, bag, ft, hour… free text, since it varies by trade. */
  unit: string;
}

/**
 * Everything the operator types. One JSON document, so a new field costs nothing
 * at the database layer.
 */
export interface RfqDoc {
  /** ISO date (yyyy-mm-dd). */
  rfqDate: string;
  /** When quotations are due back. ISO date, or "" for none stated. */
  replyBy: string;
  /** One-line summary of what is being asked for. */
  subject: string;
  /** Where the goods would be delivered — vendors need it to price freight. */
  deliveryAddress: string;
  /** Currency vendors should quote in. A key of CURRENCIES in money.ts. */
  currency: string;
  /** Who the vendor sends their quotation back to. */
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  items: RfqItem[];
  /** Extra instructions, printed under the table. */
  notes: string;
  /** Conditions of quoting — validity, delivery expectations, and so on. */
  terms: string;
  preparedBy: string;
}

export interface RequestForQuotation {
  id: string;
  /** `GR-RFQ-202608-001` — permanent once assigned. */
  rfqNo: string;
  company: CompanySlug;
  status: RfqStatus;
  /** Sequence within the month, per company. */
  seq: number;
  /** yyyymm. */
  period: string;
  /** Private operator shorthand. Searchable. Never printed. */
  internalNote: string;
  doc: RfqDoc;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  closedAt: string | null;
  deletedAt: string | null;
  /** Storage key of the generated PDF, resolved through /api/file/<key>. */
  pdfKey: string | null;
  /** When it was rendered. Older than updatedAt means the file is stale. */
  pdfAt: string | null;
}

export interface RfqQuery {
  company: CompanySlug;
  /** Free text across RFQ no., subject and internal note. */
  q?: string;
  /** "open" is draft + sent; "deleted" is the recycle bin. */
  status?: RfqStatus | "all" | "open" | "deleted";
  /** ISO dates, inclusive, matched against the RFQ date. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface RfqCounts {
  draft: number;
  sent: number;
  closed: number;
  cancelled: number;
  /** draft + sent — the badge in the workspace nav. */
  open: number;
  total: number;
}

/** Works in the browser too, where node:crypto isn't available. */
export function newRfqRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function emptyRfqItem(): RfqItem {
  return { id: newRfqRowId(), code: "", description: "", qty: 1, unit: "" };
}

/** A blank request, pre-filled from the company's saved defaults. */
export function emptyRfqDoc(today: string, replyBy: string, s: RfqSettings): RfqDoc {
  return {
    rfqDate: today,
    replyBy,
    subject: "",
    deliveryAddress: s.deliveryAddress,
    currency: s.currency,
    contactName: s.contactName,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    items: [emptyRfqItem()],
    notes: "",
    terms: s.terms,
    preparedBy: s.preparedBy,
  };
}
