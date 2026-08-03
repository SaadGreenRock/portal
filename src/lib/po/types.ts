import type { CompanySlug } from "../companies";
import type { PoSettings } from "../settings";

/**
 * Purchase orders.
 *
 * A PO's lifecycle is deliberately short: it is drafted, issued to the vendor,
 * and closed once the order is done with. There is no approval queue and no
 * goods-receipt ledger — those are separate features, and the shape here leaves
 * room for them (a status is a string, and the document is one JSON blob) without
 * pretending to have them.
 */
export type PoStatus = "draft" | "issued" | "closed" | "cancelled";

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** "Open" is the working set: everything that still needs attention. */
export const OPEN_STATUSES: PoStatus[] = ["draft", "issued"];

export interface PoItem {
  /**
   * Stable row key. Kept in the document rather than derived from the array
   * index so that inserting or removing a row above doesn't make React reuse
   * the wrong input and move the operator's cursor mid-edit.
   */
  id: string;
  /** Vendor's part number or internal item code. Optional. */
  code: string;
  description: string;
  qty: number;
  /** pcs, kg, bag, ft, hour… free text, since it varies by trade. */
  unit: string;
  unitPrice: number;
}

export interface PoVendor {
  name: string;
  address: string;
  /** Contact person at the vendor. */
  contact: string;
  phone: string;
  email: string;
  /** NTN, VAT or CR number — whatever the jurisdiction calls it. */
  taxId: string;
}

/**
 * Everything the operator types. Stored as a single JSON document so a new
 * field costs nothing at the database layer; only the values that History has
 * to filter or sort on are lifted into their own columns.
 */
export interface PoDoc {
  vendor: PoVendor;
  /** ISO date (yyyy-mm-dd). */
  poDate: string;
  /** ISO date, or "" for none stated. */
  deliveryDate: string;
  /** Ship To block. Defaults from company settings. */
  deliveryAddress: string;
  paymentTerms: string;
  /** Vendor quotation number, requisition number, contract reference… */
  reference: string;
  /** One-line summary printed under the addresses. */
  subject: string;
  /** Currency code — a key of CURRENCIES in money.ts. */
  currency: string;
  taxLabel: string;
  /** Percent. */
  taxRate: number;
  showTax: boolean;
  /** Absolute amount taken off the subtotal before tax. */
  discount: number;
  /** Freight/handling, added after tax. */
  shipping: number;
  items: PoItem[];
  /** Prints on the PO, under the totals. */
  notes: string;
  /** Terms and conditions block. */
  terms: string;
  preparedBy: string;
  approvedBy: string;
}

export interface PurchaseOrder {
  id: string;
  /** `GR-PO-202608-001` — permanent once assigned. */
  poNo: string;
  company: CompanySlug;
  status: PoStatus;
  /** Sequence within the month, per company. */
  seq: number;
  /** yyyymm. */
  period: string;
  /** Private operator shorthand. Searchable. Never printed. */
  internalNote: string;
  doc: PoDoc;
  /** Denormalised from `doc` so lists can show money without recomputing. */
  subtotal: number;
  total: number;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  closedAt: string | null;
  deletedAt: string | null;
  /** Storage key of the generated PDF, resolved through /api/file/<key>. */
  pdfKey: string | null;
  /**
   * When that PDF was rendered. Older than updatedAt means the document has
   * been edited since, and the stored file is no longer what the record says —
   * the detail screen says so rather than letting a stale copy be sent out.
   */
  pdfAt: string | null;
  /**
   * The vendor's invoice, uploaded when the goods arrive. For the small
   * equipment purchases this is used for, the invoice *is* the delivery
   * document — it comes with the item — so attaching it is what closes the
   * order, and it doubles as the warranty record long afterwards.
   */
  invoiceKey: string | null;
  invoiceName: string | null;
  invoiceAt: string | null;
}

export interface PoQuery {
  company: CompanySlug;
  /** Free text across PO no., vendor name, subject and internal note. */
  q?: string;
  /** "open" is draft + issued; "deleted" is the recycle bin. */
  status?: PoStatus | "all" | "open" | "deleted";
  /** ISO dates, inclusive, matched against the PO date. */
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

/**
 * A vendor as last used, assembled from previous purchase orders.
 *
 * There is no vendor table by design: the vendor list is whatever has been
 * ordered from before, so nothing has to be maintained and nothing goes stale.
 */
export interface VendorProfile extends PoVendor {
  /** How many POs have been raised against this name. */
  orders: number;
  /** ISO timestamp of the most recent one. */
  lastUsed: string;
}

export interface PoCounts {
  draft: number;
  issued: number;
  closed: number;
  cancelled: number;
  /** draft + issued — the badge in the workspace nav. */
  open: number;
  total: number;
}

/** Works in the browser too, where node:crypto isn't available. */
export function newRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function emptyItem(): PoItem {
  return { id: newRowId(), code: "", description: "", qty: 1, unit: "", unitPrice: 0 };
}

/** A blank purchase order, pre-filled from the company's saved defaults. */
export function emptyPoDoc(today: string, s: PoSettings): PoDoc {
  return {
    vendor: { name: "", address: "", contact: "", phone: "", email: "", taxId: "" },
    poDate: today,
    deliveryDate: "",
    deliveryAddress: s.deliveryAddress,
    paymentTerms: s.paymentTerms,
    reference: "",
    subject: "",
    currency: s.currency,
    taxLabel: s.taxLabel,
    taxRate: s.taxRate,
    showTax: s.showTax,
    discount: 0,
    shipping: 0,
    items: [emptyItem()],
    notes: "",
    terms: s.terms,
    preparedBy: s.preparedBy,
    approvedBy: s.approvedBy,
  };
}
