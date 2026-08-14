import { randomUUID } from "node:crypto";
import { portalPeriod } from "../clock";
import {
  isCondition,
  type AllotFields,
  type Asset,
  type AssetHolding,
  type EmployeeProfile,
  type HoldingWithAsset,
} from "../assets/types";
import { COMPANIES, type CompanySlug } from "../companies";
import { isFoodStatus, isPaymentType, type FoodExpense, type FoodFields } from "../food/types";
import { isNotificationTag, type Notification } from "../notifications/types";
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

/**
 * `202608` — the year and month a document created now belongs to.
 *
 * The single most consequential date question in the portal: this figure goes
 * inside the document number, and a number is never reissued. Answered at the
 * desk's calendar rather than the host's, which is the whole subject of
 * `clock.ts` — a server five hours behind would file everything created before
 * dawn on the 1st under the month just gone, for good.
 */
export function periodOf(at: Date = new Date()): string {
  return portalPeriod(at);
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

export const formatNotifNo = (company: CompanySlug, period: string, seq: number) =>
  formatDocNo(company, period, seq, "NOTE");

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

/**
 * `F-202608-001` — the food marker, year+month, and the month's sequence.
 *
 * The only number in the portal with no company prefix, because a lunch ordered
 * for both companies has no company to take one from. `formatDocNo` cannot be
 * reused for the same reason: its first argument is a `CompanySlug`.
 */
export function formatFoodNo(period: string, seq: number): string {
  return `F-${period}-${String(seq).padStart(3, "0")}`;
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

/* -------------------------------------------------------------------------
 * Food
 * ---------------------------------------------------------------------------*/

/**
 * Shape of a food row as stored, in either backend.
 *
 * Every field is a column; there is no JSON document to denormalise out of, the
 * same as assets. An entry is a dozen flat values and all but the notes are
 * searched, filtered or summed on.
 *
 * No `company` column — deliberately, and it is the one structural difference
 * from every other table here. See `src/lib/food/types.ts`.
 */
export interface FoodRow {
  id: string;
  entry_no: string;
  seq: number;
  period: string;
  date: string;
  ordered_for: string;
  vendor: string;
  details: string;
  amount: number;
  currency: string;
  payment_type: string;
  paid_by: string | null;
  status: string;
  paid_at: string | null;
  reference: string | null;
  notes: string | null;
  /** Proof of payment. Shared by every entry settled in the same payment. */
  receipt_key: string | null;
  receipt_name: string | null;
  receipt_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function rowToFood(r: FoodRow): FoodExpense {
  return {
    id: r.id,
    entryNo: r.entry_no,
    seq: r.seq,
    period: r.period,
    date: r.date,
    orderedFor: r.ordered_for ?? "",
    vendor: r.vendor ?? "",
    details: r.details ?? "",
    // Postgres `numeric` comes back through PostgREST as a string. Coercing here
    // rather than at every call site is what stops the totals from being string
    // concatenation on one backend and addition on the other.
    amount: Number(r.amount) || 0,
    currency: r.currency || "PKR",
    paymentType: isPaymentType(r.payment_type) ? r.payment_type : "deferred",
    paidBy: r.paid_by ?? null,
    status: isFoodStatus(r.status) ? r.status : "pending",
    paidAt: r.paid_at ?? null,
    reference: r.reference ?? null,
    notes: r.notes ?? null,
    receiptKey: r.receipt_key ?? null,
    receiptName: r.receipt_name ?? null,
    receiptAt: r.receipt_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/**
 * A food entry's editable fields as columns, for an insert or an update.
 *
 * The three normalisations that must not be left to a call site:
 *
 *   `paid_by` is forced to NULL on a deferred order. Nobody paid out of pocket,
 *   so a name left behind by switching the payment type would put a phantom
 *   reimbursement on the outstanding screen.
 *
 *   `paid_at` is forced to NULL while pending, so a stale date cannot survive an
 *   entry being put back to unpaid and claim it was settled.
 *
 *   `paid_at` falls back to the order date when an entry is settled without one.
 *   A settled entry always carries a date — the log is read as a diary and a
 *   blank column in the middle of it reads as a gap in the record rather than as
 *   "we did not write this down". The settle flow supplies a real date, so this
 *   only catches the edit form being saved as Paid with the field left empty,
 *   and it is the same rule the spreadsheet import used for the 28 rows that
 *   were marked Paid without a payment date.
 */
export function foodColumns(f: FoodFields) {
  const deferred = f.paymentType === "deferred";
  const paid = f.status === "paid";
  return {
    date: f.date,
    ordered_for: f.orderedFor,
    vendor: f.vendor,
    details: f.details,
    amount: f.amount,
    currency: f.currency || "PKR",
    payment_type: f.paymentType,
    paid_by: deferred ? null : (f.paidBy?.trim() || null),
    status: f.status,
    paid_at: paid ? f.paidAt || f.date || null : null,
    reference: f.reference?.trim() || null,
    notes: f.notes?.trim() || null,
  };
}

/**
 * The name lists the entry form offers back, newest use first.
 *
 * Same approach as vendors on purchase orders and employees on the register:
 * nothing to maintain, and the spelling from the most recent entry wins so a
 * correction is not undone by a suggestion from an older row. Rows must arrive
 * newest first.
 */
export function foodNamesFrom(rows: FoodRow[]): {
  vendors: string[];
  payers: string[];
  orderedFor: string[];
} {
  const pick = (get: (r: FoodRow) => string | null): string[] => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const value = (get(row) ?? "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    }
    return [...seen.values()];
  };

  return {
    vendors: pick((r) => r.vendor),
    payers: pick((r) => r.paid_by),
    orderedFor: pick((r) => r.ordered_for),
  };
}

/* -------------------------------------------------------------------------
 * Notifications
 * ---------------------------------------------------------------------------*/

/**
 * Shape of a notification row as stored, in either backend.
 *
 * Every field is a column, like assets and food_expenses — nothing here is
 * printed except what is also searched or filtered on, so a jsonb doc would
 * only add indirection.
 */
export interface NotificationRow {
  id: string;
  notif_no: string;
  company: string;
  seq: number;
  period: string;
  headline: string;
  body: string;
  tag: string;
  sender: string;
  notify_date: string | null;
  created_at: string;
  png_key: string | null;
  png_at: string | null;
  pdf_key: string | null;
  pdf_at: string | null;
  deleted_at: string | null;
}

export function rowToNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    notifNo: r.notif_no,
    company: r.company as CompanySlug,
    seq: r.seq,
    period: r.period,
    headline: r.headline ?? "",
    body: r.body ?? "",
    tag: isNotificationTag(r.tag) ? r.tag : "notice",
    sender: r.sender ?? "",
    notifyDate: r.notify_date ?? "",
    createdAt: r.created_at,
    pngKey: r.png_key ?? null,
    pngAt: r.png_at ?? null,
    pdfKey: r.pdf_key ?? null,
    pdfAt: r.pdf_at ?? null,
    deletedAt: r.deleted_at ?? null,
  };
}
