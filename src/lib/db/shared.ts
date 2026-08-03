import { randomUUID } from "node:crypto";
import { COMPANIES, type CompanySlug } from "../companies";
import { poTotals } from "../po/totals";
import { watermarkFor, type PoDoc, type PoStatus, type PurchaseOrder, type VendorProfile } from "../po/types";
import type { Voucher, VoucherFields, VoucherStatus } from "../types";

export const newId = () => randomUUID();

/** yyyymm for the given instant, in the server's local time. */
export function periodOf(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * `GR-202607-014` — prefix, year+month, zero-padded 3-digit sequence.
 *
 * `kind` inserts a document-type segment for anything that isn't a voucher, so
 * `GR-PO-202608-001` can never be mistaken for a voucher number and the two
 * sequences stay visibly separate.
 */
export function formatDocNo(
  company: CompanySlug,
  period: string,
  seq: number,
  kind?: string,
): string {
  const parts = [COMPANIES[company].prefix, kind, period, String(seq).padStart(3, "0")];
  return parts.filter(Boolean).join("-");
}

export const formatVoucherNo = (company: CompanySlug, period: string, seq: number) =>
  formatDocNo(company, period, seq);

export const formatPoNo = (company: CompanySlug, period: string, seq: number) =>
  formatDocNo(company, period, seq, "PO");

/* -------------------------------------------------------------------------
 * Vouchers
 * ---------------------------------------------------------------------------*/

/**
 * Values lifted out of `fields` into their own columns so History can filter
 * and sort on them without deserialising every row.
 */
export function denormalize(fields: VoucherFields) {
  const amount = fields.on.amount ? Number(String(fields.amount).replace(/,/g, "")) : null;
  return {
    recipientName: fields.on.recipientName ? fields.recipientName.trim() : "",
    description: fields.on.description ? fields.description.trim() : "",
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    voucherDate: fields.on.voucherDate ? fields.voucherDate : null,
  };
}

/** Shape of a voucher row as stored, in either backend. */
export interface VoucherRow {
  id: string;
  voucher_no: string;
  company: string;
  status: string;
  seq: number;
  period: string;
  internal_note: string | null;
  fields: string | VoucherFields;
  recipient_name: string | null;
  description: string | null;
  amount: number | null;
  voucher_date: string | null;
  created_at: string;
  generated_at: string | null;
  uploaded_at: string | null;
  deleted_at: string | null;
  pdf_key: string | null;
  scan_key: string | null;
  scan_name: string | null;
}

export function rowToVoucher(r: VoucherRow): Voucher {
  return {
    id: r.id,
    voucherNo: r.voucher_no,
    company: r.company as CompanySlug,
    status: r.status as VoucherStatus,
    seq: r.seq,
    period: r.period,
    internalNote: r.internal_note ?? "",
    fields: typeof r.fields === "string" ? (JSON.parse(r.fields) as VoucherFields) : r.fields,
    createdAt: r.created_at,
    generatedAt: r.generated_at,
    uploadedAt: r.uploaded_at,
    deletedAt: r.deleted_at ?? null,
    pdfKey: r.pdf_key,
    scanKey: r.scan_key,
    scanName: r.scan_name,
  };
}

/* -------------------------------------------------------------------------
 * Purchase orders
 * ---------------------------------------------------------------------------*/

/** Shape of a purchase order row as stored, in either backend. */
export interface PoRow {
  id: string;
  po_no: string;
  company: string;
  status: string;
  seq: number;
  period: string;
  internal_note: string | null;
  doc: string | PoDoc;
  /** Lifted out of `doc` so lists and filters don't deserialise every row. */
  vendor_name: string | null;
  subject: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  po_date: string | null;
  delivery_date: string | null;
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  closed_at: string | null;
  deleted_at: string | null;
  pdf_key: string | null;
  pdf_at: string | null;
  invoice_key: string | null;
  invoice_name: string | null;
  invoice_at: string | null;
}

/** The columns derived from a document, written on every insert and update. */
export function denormalizePo(doc: PoDoc) {
  const t = poTotals(doc);
  return {
    vendor_name: doc.vendor.name.trim(),
    subject: doc.subject.trim(),
    currency: doc.currency,
    subtotal: t.subtotal,
    total: t.total,
    po_date: doc.poDate || null,
    delivery_date: doc.deliveryDate || null,
  };
}

export function rowToPo(r: PoRow): PurchaseOrder {
  const doc = typeof r.doc === "string" ? (JSON.parse(r.doc) as PoDoc) : r.doc;
  return {
    id: r.id,
    poNo: r.po_no,
    company: r.company as CompanySlug,
    status: r.status as PoStatus,
    seq: r.seq,
    period: r.period,
    internalNote: r.internal_note ?? "",
    doc,
    subtotal: r.subtotal ?? 0,
    total: r.total ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    issuedAt: r.issued_at,
    closedAt: r.closed_at,
    deletedAt: r.deleted_at ?? null,
    pdfKey: r.pdf_key,
    pdfAt: r.pdf_at ?? null,
    invoiceKey: r.invoice_key ?? null,
    invoiceName: r.invoice_name ?? null,
    invoiceAt: r.invoice_at ?? null,
  };
}

/**
 * Whether a status change alters what the printed document looks like.
 *
 * Only the watermark depends on status, so issued → closed leaves the PDF
 * byte-identical while draft → issued removes a DRAFT stamp from every page.
 */
export const statusChangesDocument = (from: PoStatus, to: PoStatus) =>
  watermarkFor(from) !== watermarkFor(to);

/**
 * The columns a status change writes.
 *
 * issuedAt records the first time an order went out and is not re-stamped by a
 * later close or cancel — the vendor holds a document dated that day. Pulling
 * an order all the way back to draft does clear it, because that is the one
 * transition that says the order was never really issued.
 *
 * updatedAt is only moved when the change would alter the printed page. It is
 * what "the PDF on file is out of date" is measured against, and a warning that
 * fires when nothing visible changed is a warning the operator learns to ignore.
 */
export function poStatusPatch(current: PurchaseOrder, status: PoStatus, now: string) {
  return {
    status,
    ...(statusChangesDocument(current.status, status) ? { updated_at: now } : {}),
    issued_at: status === "draft" ? null : (current.issuedAt ?? (status === "issued" ? now : null)),
    closed_at: status === "closed" ? now : null,
  };
}

/**
 * Builds the vendor autocomplete list from previous orders.
 *
 * Keyed on the lowercased name so "Al-Karam Traders" and "al-karam traders" are
 * the same vendor, and the most recent order wins for the contact details —
 * a phone number that changed should not be re-suggested from a two-year-old PO.
 * Rows must arrive newest first.
 */
export function vendorProfilesFrom(
  rows: Array<{ doc: string | PoDoc; created_at: string }>,
): VendorProfile[] {
  const byKey = new Map<string, VendorProfile>();

  for (const row of rows) {
    let doc: PoDoc;
    try {
      doc = typeof row.doc === "string" ? (JSON.parse(row.doc) as PoDoc) : row.doc;
    } catch {
      continue;
    }
    const name = doc?.vendor?.name?.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    const seen = byKey.get(key);
    if (seen) {
      seen.orders += 1;
      continue;
    }
    byKey.set(key, {
      ...doc.vendor,
      name,
      orders: 1,
      lastUsed: row.created_at,
    });
  }

  return [...byKey.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
}
