import { randomUUID } from "node:crypto";
import { COMPANIES, type CompanySlug } from "../companies";
import type { Voucher, VoucherFields, VoucherStatus } from "../types";

export const newId = () => randomUUID();

/** yyyymm for the given instant, in the server's local time. */
export function periodOf(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `GR-202607-014` — prefix, year+month, zero-padded 3-digit sequence. */
export function formatVoucherNo(company: CompanySlug, period: string, seq: number): string {
  return `${COMPANIES[company].prefix}-${period}-${String(seq).padStart(3, "0")}`;
}

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
