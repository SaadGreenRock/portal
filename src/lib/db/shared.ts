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
import {
  isEmployeeStatus,
  type Employee,
  type EmployeeFields,
} from "../employees/types";
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
import {
  isSourceKind,
  type AllocatableItem,
  type Allocation,
  type DirectExpense,
  type DirectFields,
  type NewAllocation,
  type Placement,
  type SourceKind,
  type Tranche,
  type TrancheFields,
} from "../tranches/types";
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

/* -------------------------------------------------------------------------
 * Investor funding
 * ---------------------------------------------------------------------------*/

/**
 * `TR-001` — the tranche marker and a running sequence.
 *
 * No year+month, and the sequence never resets. Same reasoning as an asset
 * number: a tranche is referred to as "the fourth one" for years afterwards, and
 * a sequence that restarted monthly would put two `-001` labels on two different
 * wires. The padding is a minimum rather than a limit — the hundredth tranche is
 * `TR-100`.
 */
export function formatTrancheNo(seq: number): string {
  return `TR-${String(seq).padStart(3, "0")}`;
}

/**
 * `TE-202608-001` — the direct-entry marker, year+month, the month's sequence.
 *
 * No company prefix, like the food log: an entry paid out of investor money may
 * belong to neither company, and `formatDocNo` cannot be reused because its
 * first argument is a `CompanySlug`.
 */
export function formatDirectNo(period: string, seq: number): string {
  return `TE-${period}-${String(seq).padStart(3, "0")}`;
}

export interface TrancheRow {
  id: string;
  tranche_no: string;
  seq: number;
  label: string | null;
  funder: string | null;
  sent_amount: number | string;
  sent_currency: string | null;
  sent_date: string | null;
  recv_amount: number | string;
  recv_currency: string | null;
  recv_date: string;
  account: string | null;
  reference: string | null;
  notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Postgres `numeric` arrives through PostgREST as a string, so every money
 * column is coerced here rather than at the call sites — the same reason
 * `rowToFood` does it. Left to the callers, a total would be addition on SQLite
 * and string concatenation on Supabase.
 */
export function rowToTranche(r: TrancheRow): Tranche {
  return {
    id: r.id,
    trancheNo: r.tranche_no,
    seq: r.seq,
    label: r.label ?? "",
    funder: r.funder ?? "",
    sentAmount: Number(r.sent_amount) || 0,
    sentCurrency: r.sent_currency || "USD",
    sentDate: r.sent_date ?? "",
    recvAmount: Number(r.recv_amount) || 0,
    recvCurrency: r.recv_currency || "PKR",
    recvDate: String(r.recv_date).slice(0, 10),
    account: r.account ?? null,
    reference: r.reference ?? null,
    notes: r.notes ?? null,
    closedAt: r.closed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/** A tranche's editable fields as columns, for an insert or an update. */
export function trancheColumns(f: TrancheFields) {
  return {
    label: f.label.trim(),
    funder: f.funder.trim(),
    sent_amount: f.sentAmount,
    sent_currency: f.sentCurrency || "USD",
    // Empty string is not a date a date column can hold, and NULL is the honest
    // answer for "we have not looked up when it was wired yet".
    sent_date: f.sentDate || null,
    recv_amount: f.recvAmount,
    recv_currency: f.recvCurrency || "PKR",
    recv_date: f.recvDate,
    account: f.account?.trim() || null,
    reference: f.reference?.trim() || null,
    notes: f.notes?.trim() || null,
  };
}

export interface AllocationRow {
  id: string;
  tranche_id: string;
  source_kind: string;
  source_id: string;
  amount: number | string;
  source_amount: number | string;
  source_total: number | string | null;
  source_currency: string | null;
  rate: number | string;
  source_ref: string | null;
  source_label: string | null;
  source_company: string | null;
  source_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToAllocation(r: AllocationRow): Allocation {
  return {
    id: r.id,
    trancheId: r.tranche_id,
    sourceKind: isSourceKind(r.source_kind) ? r.source_kind : "direct",
    sourceId: r.source_id,
    amount: Number(r.amount) || 0,
    sourceAmount: Number(r.source_amount) || 0,
    sourceTotal: r.source_total == null ? null : Number(r.source_total),
    sourceCurrency: r.source_currency || "PKR",
    // Falls back to 1 rather than 0: a rate of zero would make a converted
    // figure vanish, where 1 at least states the amounts unchanged.
    rate: Number(r.rate) || 1,
    sourceRef: r.source_ref ?? "",
    sourceLabel: r.source_label ?? "",
    sourceCompany: (r.source_company as CompanySlug | null) ?? null,
    sourceDate: r.source_date ? String(r.source_date).slice(0, 10) : "",
    note: r.note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** A new debit as columns. The id and stamps are the caller's business. */
export function allocationColumns(a: NewAllocation) {
  return {
    tranche_id: a.trancheId,
    source_kind: a.sourceKind,
    source_id: a.sourceId,
    amount: a.amount,
    source_amount: a.sourceAmount,
    source_total: a.sourceTotal,
    source_currency: a.sourceCurrency || "PKR",
    rate: a.rate,
    source_ref: a.sourceRef,
    source_label: a.sourceLabel,
    source_company: a.sourceCompany,
    source_date: a.sourceDate || null,
    note: a.note?.trim() || null,
  };
}

export interface DirectRow {
  id: string;
  entry_no: string;
  seq: number;
  period: string;
  date: string;
  payee: string | null;
  details: string | null;
  amount: number | string;
  currency: string | null;
  company: string | null;
  notes: string | null;
  receipt_key: string | null;
  receipt_name: string | null;
  receipt_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function rowToDirect(r: DirectRow): DirectExpense {
  return {
    id: r.id,
    entryNo: r.entry_no,
    seq: r.seq,
    period: r.period,
    date: String(r.date).slice(0, 10),
    payee: r.payee ?? "",
    details: r.details ?? "",
    amount: Number(r.amount) || 0,
    currency: r.currency || "PKR",
    company: (r.company as CompanySlug | null) ?? null,
    notes: r.notes ?? null,
    receiptKey: r.receipt_key ?? null,
    receiptName: r.receipt_name ?? null,
    receiptAt: r.receipt_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

export function directColumns(f: DirectFields) {
  return {
    date: f.date,
    payee: f.payee.trim(),
    details: f.details.trim(),
    amount: f.amount,
    currency: f.currency || "PKR",
    company: f.company,
    notes: f.notes?.trim() || null,
  };
}

/**
 * Payee names as already typed, most recent first, for the form's datalist.
 *
 * Same approach as vendors on purchase orders and payers on the food log: there
 * is no list to keep up to date, and the spelling from the most recent entry
 * wins so a correction is not undone by a suggestion from an older row. Rows
 * must arrive newest first.
 */
export function directPayeesFrom(rows: DirectRow[]): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = (row.payee ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

/** The four row shapes `allocatable` selects, and the debits already written. */
export interface AllocatableSources {
  vouchers: Array<{
    id: string;
    ref: string;
    company: string;
    status: string;
    recipient_name: string | null;
    description: string | null;
    amount: number | string | null;
    date: string;
  }>;
  orders: Array<{
    id: string;
    ref: string;
    company: string;
    status: string;
    currency: string | null;
    total: number | string | null;
    vendor_name: string | null;
    subject: string | null;
    date: string;
  }>;
  food: Array<{
    id: string;
    ref: string;
    status: string;
    currency: string | null;
    amount: number | string | null;
    vendor: string | null;
    details: string | null;
    date: string;
  }>;
  direct: Array<{
    id: string;
    ref: string;
    company: string | null;
    currency: string | null;
    amount: number | string | null;
    payee: string | null;
    details: string | null;
    date: string;
  }>;
  placed: Array<{
    source_kind: string;
    source_id: string;
    source_amount: number | string;
    amount: number | string;
    tranche_id: string;
    tranche_no: string;
  }>;
}

/**
 * Four tables into one shape, with what is already allocated attached.
 *
 * The seam between the funding section and the rest of the portal, and it lives
 * here rather than in either backend so both tell the picker the same story —
 * which module a row came from, what it is called, who was paid, and how much of
 * it is spoken for. A fifth expense module later adds one field to
 * `AllocatableSources` and one loop below; nothing downstream changes.
 *
 * `allocated` is summed in the *document's* own currency, from `source_amount`
 * rather than `amount`. That is what makes the over-allocation guard meaningful
 * for a purchase order raised in SAR and paid from a rupee bucket: the ceiling
 * is SAR 4,000, not the rupees it happened to cost.
 */
export function assembleAllocatable(input: AllocatableSources): AllocatableItem[] {
  const placements = new Map<string, Placement[]>();
  const allocated = new Map<string, number>();

  for (const p of input.placed) {
    const key = `${p.source_kind}:${p.source_id}`;
    const list = placements.get(key) ?? [];
    list.push({
      trancheId: p.tranche_id,
      trancheNo: p.tranche_no,
      sourceAmount: Number(p.source_amount) || 0,
      amount: Number(p.amount) || 0,
    });
    placements.set(key, list);
    allocated.set(key, (allocated.get(key) ?? 0) + (Number(p.source_amount) || 0));
  }

  const attach = (kind: SourceKind, id: string) => {
    const key = `${kind}:${id}`;
    return {
      // Rounded once, here: summing paisa-precise figures and comparing the
      // float against a document total is how a fully allocated expense ends up
      // one paisa short of full and back in the queue for ever.
      allocated: Math.round((allocated.get(key) ?? 0) * 100) / 100,
      placements: (placements.get(key) ?? []).sort((a, b) =>
        a.trancheNo < b.trancheNo ? -1 : 1,
      ),
    };
  };

  const num = (v: number | string | null): number | null =>
    v == null ? null : Number(v) || 0;

  const items: AllocatableItem[] = [
    ...input.vouchers.map((v) => ({
      kind: "voucher" as const,
      id: v.id,
      ref: v.ref,
      company: v.company as CompanySlug,
      date: String(v.date).slice(0, 10),
      party: (v.recipient_name ?? "").trim(),
      description: (v.description ?? "").trim(),
      // Stated rather than stored, as in spendRows: the voucher template prints
      // "AMOUNT PAID (PKR)" and amount-words speaks Rupees.
      currency: "PKR",
      amount: num(v.amount),
      status: v.status,
      ...attach("voucher", v.id),
    })),
    ...input.orders.map((o) => ({
      kind: "po" as const,
      id: o.id,
      ref: o.ref,
      company: o.company as CompanySlug,
      date: String(o.date).slice(0, 10),
      party: (o.vendor_name ?? "").trim(),
      description: (o.subject ?? "").trim(),
      currency: o.currency || "PKR",
      amount: num(o.total),
      status: o.status,
      ...attach("po", o.id),
    })),
    ...input.food.map((f) => ({
      kind: "food" as const,
      id: f.id,
      // Null, not a company: a lunch ordered for both belongs to neither
      // workspace, which is the food log's founding rule.
      company: null,
      ref: f.ref,
      date: String(f.date).slice(0, 10),
      party: (f.vendor ?? "").trim(),
      description: (f.details ?? "").trim(),
      currency: f.currency || "PKR",
      amount: num(f.amount),
      status: f.status,
      ...attach("food", f.id),
    })),
    ...input.direct.map((d) => ({
      kind: "direct" as const,
      id: d.id,
      ref: d.ref,
      company: (d.company as CompanySlug | null) ?? null,
      date: String(d.date).slice(0, 10),
      party: (d.payee ?? "").trim(),
      description: (d.details ?? "").trim(),
      currency: d.currency || "PKR",
      amount: num(d.amount),
      // A direct entry has no lifecycle — it is money that went out. Stated so
      // the picker's status column has something to draw rather than a blank.
      status: "paid",
      ...attach("direct", d.id),
    })),
  ];

  // Newest first, matching every other list in the portal. The picker re-sorts
  // to oldest-first for the work queue, where clearing the backlog in the order
  // the money went out is what you want.
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/* -------------------------------------------------------------------------
 * Employees
 * ---------------------------------------------------------------------------*/

export interface EmployeeRow {
  id: string;
  company: string;
  employee_no: string;
  name: string;
  status: string;
  left_on: string | null;
  cnic: string | null;
  cnic_key: string | null;
  cnic_name: string | null;
  cnic_at: string | null;
  passport: string | null;
  passport_key: string | null;
  passport_name: string | null;
  passport_at: string | null;
  address: string | null;
  phone: string | null;
  kin_name: string | null;
  kin_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function rowToEmployee(r: EmployeeRow): Employee {
  return {
    id: r.id,
    company: r.company as CompanySlug,
    employeeNo: r.employee_no ?? "",
    name: r.name ?? "",
    status: isEmployeeStatus(r.status) ? r.status : "active",
    leftOn: r.left_on ? String(r.left_on).slice(0, 10) : null,
    cnic: r.cnic ?? null,
    cnicKey: r.cnic_key ?? null,
    cnicName: r.cnic_name ?? null,
    cnicAt: r.cnic_at ?? null,
    passport: r.passport ?? null,
    passportKey: r.passport_key ?? null,
    passportName: r.passport_name ?? null,
    passportAt: r.passport_at ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    kinName: r.kin_name ?? null,
    kinPhone: r.kin_phone ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/**
 * An employee's editable fields as columns.
 *
 * One normalisation that must not be left to a call site: `left_on` is forced to
 * NULL while active, so a date left behind by marking somebody as returned
 * cannot survive and go on reading as though they were still gone. The mirror of
 * the rule `foodColumns` applies to `paid_at`.
 *
 * The optional text fields collapse an empty string to NULL. Absence and "" mean
 * the same thing to a reader and it is not worth being able to tell them apart,
 * but a NULL sorts and counts predictably where an empty string does not.
 */
export function employeeColumns(f: EmployeeFields) {
  const blank = (v: string | null | undefined) => (v ?? "").trim() || null;
  const active = f.status === "active";
  return {
    employee_no: f.employeeNo.trim(),
    name: f.name.trim(),
    status: f.status,
    left_on: active ? null : f.leftOn || null,
    cnic: blank(f.cnic),
    passport: blank(f.passport),
    address: blank(f.address),
    phone: blank(f.phone),
    kin_name: blank(f.kinName),
    kin_phone: blank(f.kinPhone),
    notes: blank(f.notes),
  };
}

/**
 * How an employee number is compared for the uniqueness guard.
 *
 * Case- and space-insensitive, because "emp 001", "EMP-001" and "emp-001" typed
 * on three different days are one number to everybody except a database. The
 * stored value keeps whatever was typed; only the comparison is loosened.
 */
export const employeeNoKey = (no: string): string =>
  no.trim().toLowerCase().replace(/[\s-]+/g, "");
