import type { CompanySlug } from "./companies";

/**
 * The six toggle-able printed fields from the plan, plus Phone Number.
 * Each has an independent ON/OFF switch. OFF means the voucher prints a blank
 * line to be filled in by hand at signing time.
 *
 * Amount In Words is deliberately NOT a toggle — it is derived from `amount`
 * whenever the amount toggle is ON.
 */
export const TOGGLE_KEYS = [
  "description",
  "amount",
  "recipientName",
  "phone",
  "voucherDate",
  "authorizedName",
  "authorizedDate",
] as const;

export type ToggleKey = (typeof TOGGLE_KEYS)[number];

/** Human labels, used by the form and by the History detail view. */
export const TOGGLE_LABELS: Record<ToggleKey, string> = {
  description: "Description",
  amount: "Amount Paid",
  recipientName: "Recipient Name",
  phone: "Phone Number",
  voucherDate: "Voucher Date",
  authorizedName: "Authorized Person Name",
  authorizedDate: "Authorized Person Date",
};

/** What actually gets printed onto the voucher. */
export interface VoucherFields {
  /** Toggle states. */
  on: Record<ToggleKey, boolean>;
  /** Printed Description — appears on the document. Distinct from internalNote. */
  description: string;
  /** Amount in PKR, as typed. Stored as a string to preserve exact entry. */
  amount: string;
  recipientName: string;
  phone: string;
  /** ISO date (yyyy-mm-dd). */
  voucherDate: string;
  authorizedName: string;
  /** ISO date (yyyy-mm-dd). */
  authorizedDate: string;
}

export type VoucherStatus = "pending" | "completed";

export interface Voucher {
  id: string;
  voucherNo: string;
  company: CompanySlug;
  status: VoucherStatus;
  /** Sequence within the month, per company. */
  seq: number;
  /** yyyymm, e.g. "202607". */
  period: string;
  /** Private operator shorthand. Searchable. Never printed. */
  internalNote: string;
  fields: VoucherFields;
  /** ISO timestamps. */
  createdAt: string;
  generatedAt: string | null;
  uploadedAt: string | null;
  /**
   * Set when the voucher is deleted. The row is kept rather than removed so its
   * sequence number can never be handed out again, and so a mistaken delete can
   * be undone. Deleted vouchers are hidden from Pending, History and the counts.
   */
  deletedAt: string | null;
  /** Storage keys, resolved through /api/file/<key>. */
  pdfKey: string | null;
  scanKey: string | null;
  /** Original filename of the uploaded scan, for a friendlier download. */
  scanName: string | null;
}

export interface Signatory {
  id: string;
  company: CompanySlug;
  name: string;
  createdAt: string;
}

export interface HistoryQuery {
  company: CompanySlug;
  /** Free text across voucher no., recipient name, internal note, description. */
  q?: string;
  /** "deleted" switches History over to the recycle-bin view. */
  status?: VoucherStatus | "all" | "deleted";
  /** ISO dates, inclusive, matched against generatedAt. */
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

export function emptyFields(today: string): VoucherFields {
  return {
    on: {
      description: false,
      amount: false,
      recipientName: false,
      phone: false,
      voucherDate: true,
      authorizedName: false,
      authorizedDate: false,
    },
    description: "",
    amount: "",
    recipientName: "",
    phone: "",
    voucherDate: today,
    authorizedName: "",
    authorizedDate: today,
  };
}
