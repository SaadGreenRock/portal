import { randomUUID } from "node:crypto";
import {
  isCondition,
  type AllotFields,
  type Asset,
  type AssetHolding,
  type EmployeeProfile,
  type HoldingWithAsset,
} from "../assets/types";
import { COMPANIES, type CompanySlug } from "../companies";
import { poTotals } from "../po/totals";
import { watermarkFor, type PoDoc, type PoStatus, type PurchaseOrder, type VendorProfile } from "../po/types";
import {
  rfqWatermarkFor,
  type RequestForQuotation,
  type RfqDoc,
  type RfqStatus,
} from "../rfq/types";
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

export const formatRfqNo = (company: CompanySlug, period: string, seq: number) =>
  formatDocNo(company, period, seq, "RFQ");

/**
 * `GR-A-001` — prefix, the asset marker, and a running sequence.
 *
 * Deliberately without the year+month every other number carries. An asset
 * number is written on the thing itself and outlives the month it was bought in,
 * so a sequence that restarted monthly would put two `-001` labels on two
 * different laptops. The sequence therefore never resets, and the padding is a
 * minimum rather than a limit: the thousandth asset is `GR-A-1000`.
 */
export function formatAssetNo(company: CompanySlug, seq: number): string {
  return `${COMPANIES[company].prefix}-A-${String(seq).padStart(3, "0")}`;
}

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

/* -------------------------------------------------------------------------
 * Requests for quotation
 * ---------------------------------------------------------------------------*/

/** Shape of a request row as stored, in either backend. */
export interface RfqRow {
  id: string;
  rfq_no: string;
  company: string;
  status: string;
  seq: number;
  period: string;
  internal_note: string | null;
  doc: string | RfqDoc;
  /** Lifted out of `doc` so lists and filters don't deserialise every row. */
  subject: string | null;
  currency: string | null;
  item_count: number | null;
  rfq_date: string | null;
  reply_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  closed_at: string | null;
  deleted_at: string | null;
  pdf_key: string | null;
  pdf_at: string | null;
}

/** The columns derived from a document, written on every insert and update. */
export function denormalizeRfq(doc: RfqDoc) {
  return {
    subject: doc.subject.trim(),
    currency: doc.currency,
    // A count rather than a total: there is no money on this document.
    item_count: doc.items.filter((i) => i.description.trim() || i.code.trim()).length,
    rfq_date: doc.rfqDate || null,
    reply_by: doc.replyBy || null,
  };
}

export function rowToRfq(r: RfqRow): RequestForQuotation {
  const doc = typeof r.doc === "string" ? (JSON.parse(r.doc) as RfqDoc) : r.doc;
  return {
    id: r.id,
    rfqNo: r.rfq_no,
    company: r.company as CompanySlug,
    status: r.status as RfqStatus,
    seq: r.seq,
    period: r.period,
    internalNote: r.internal_note ?? "",
    doc,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at,
    closedAt: r.closed_at,
    deletedAt: r.deleted_at ?? null,
    pdfKey: r.pdf_key,
    pdfAt: r.pdf_at ?? null,
  };
}

/** Only the watermark depends on status, so sent → closed leaves the PDF alone. */
export const rfqStatusChangesDocument = (from: RfqStatus, to: RfqStatus) =>
  rfqWatermarkFor(from) !== rfqWatermarkFor(to);

/**
 * The columns a status change writes. Same reasoning as purchase orders:
 * sentAt records the first time it went out, and updatedAt only moves when the
 * printed page would actually differ.
 */
export function rfqStatusPatch(
  current: RequestForQuotation,
  status: RfqStatus,
  now: string,
) {
  return {
    status,
    ...(rfqStatusChangesDocument(current.status, status) ? { updated_at: now } : {}),
    sent_at: status === "draft" ? null : (current.sentAt ?? (status === "sent" ? now : null)),
    closed_at: status === "closed" ? now : null,
  };
}


/* -------------------------------------------------------------------------
 * Asset register
 * ---------------------------------------------------------------------------*/

/**
 * Shape of an asset row as stored, in either backend.
 *
 * No `doc` column, unlike the three document modules: every field here is
 * something the register searches or sorts on, so putting them in JSON would
 * mean denormalising all of them straight back out again.
 *
 * No `period` either — the number carries no month, so there is nothing to store.
 */
export interface AssetRow {
  id: string;
  asset_no: string;
  company: string;
  seq: number;
  asset_name: string;
  condition: string;
  /** Cache of the open holding. Empty name means in stock. */
  holder_name: string;
  holder_no: string;
  held_since: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function rowToAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    assetNo: r.asset_no,
    company: r.company as CompanySlug,
    seq: r.seq,
    assetName: r.asset_name ?? "",
    condition: isCondition(r.condition) ? r.condition : "good",
    holderName: r.holder_name ?? "",
    holderNo: r.holder_no ?? "",
    heldSince: r.held_since ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/** Shape of a holding row as stored, in either backend. */
export interface HoldingRow {
  id: string;
  asset_id: string;
  company: string;
  employee_name: string;
  employee_no: string;
  allotted_on: string | null;
  /** NULL while the holding is open. */
  returned_on: string | null;
  condition: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export function rowToHolding(r: HoldingRow): AssetHolding {
  return {
    id: r.id,
    assetId: r.asset_id,
    company: r.company as CompanySlug,
    employeeName: r.employee_name ?? "",
    employeeNo: r.employee_no ?? "",
    allottedOn: r.allotted_on ?? "",
    returnedOn: r.returned_on ?? "",
    condition: isCondition(r.condition) ? r.condition : "good",
    note: r.note ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * A history row carries its asset's identity, joined on in the backends.
 *
 * Supabase returns the embedded asset as a nested object; SQLite returns the two
 * columns flat. Both are normalised to the same shape here.
 */
export interface HoldingWithAssetRow extends HoldingRow {
  asset_no?: string | null;
  asset_name?: string | null;
  assets?: { asset_no?: string | null; asset_name?: string | null } | null;
}

export function rowToHoldingWithAsset(r: HoldingWithAssetRow): HoldingWithAsset {
  return {
    ...rowToHolding(r),
    assetNo: r.asset_no ?? r.assets?.asset_no ?? "",
    assetName: r.asset_name ?? r.assets?.asset_name ?? "",
  };
}

/** The columns an open holding writes onto its asset. */
export function holderColumns(a: AllotFields) {
  return {
    holder_name: a.employeeName,
    holder_no: a.employeeNo,
    held_since: a.allottedOn || null,
  };
}

/** What the asset row looks like with nobody holding it. */
export const IN_STOCK_COLUMNS = {
  holder_name: "",
  holder_no: "",
  held_since: null,
} as const;

/**
 * Who counts as the same person.
 *
 * The employee number when there is one, because that is what the company
 * issued and it survives a name typed two different ways. Falling back to the
 * name means a row with no number still groups with itself rather than merging
 * every unnumbered employee into one.
 */
export const employeeKey = (name: string, no: string): string =>
  no.trim() ? `no:${no.trim().toLowerCase()}` : `name:${name.trim().toLowerCase()}`;

/**
 * Builds the employee list from holdings.
 *
 * Same approach as the vendor list on purchase orders: there is no employee
 * table to maintain, so the form offers back what has already been typed. The
 * most recent holding wins for the spelling of a name — a correction should not
 * be undone by a suggestion from an older row. Rows must arrive newest first.
 *
 * `holding` counts only open holdings, so the hint beside a suggested name reads
 * as what they have now rather than everything they have ever been given.
 */
export function employeeProfilesFrom(
  rows: Array<{
    employee_name: string;
    employee_no: string;
    returned_on: string | null;
    created_at: string;
  }>,
): EmployeeProfile[] {
  const byKey = new Map<string, EmployeeProfile>();

  for (const row of rows) {
    const name = (row.employee_name ?? "").trim();
    const no = (row.employee_no ?? "").trim();
    if (!name && !no) continue;

    const open = !row.returned_on;
    const key = employeeKey(name, no);
    const seen = byKey.get(key);
    if (seen) {
      if (open) seen.holding += 1;
      continue;
    }
    byKey.set(key, { name, no, holding: open ? 1 : 0, lastUsed: row.created_at });
  }

  return [...byKey.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
}
