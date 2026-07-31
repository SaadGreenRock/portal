import type { CompanySlug } from "../companies";
import type {
  HistoryQuery,
  Signatory,
  Voucher,
  VoucherFields,
} from "../types";

export interface NewVoucher {
  company: CompanySlug;
  internalNote: string;
  fields: VoucherFields;
}

/**
 * The only database surface the app uses. Two implementations exist — SQLite
 * for zero-setup local use and Supabase Postgres for hosted use — and nothing
 * outside this folder knows which one is active.
 */
export interface Store {
  /**
   * Reserves the next voucher number for a company in the current month and
   * writes the record in one shot. Returns the created voucher with its
   * assigned, immutable number. Safe against concurrent calls.
   */
  createVoucher(input: NewVoucher): Promise<Voucher>;

  getVoucher(id: string): Promise<Voucher | null>;
  getVoucherByNo(voucherNo: string): Promise<Voucher | null>;

  /** Records the rendered PDF and stamps generatedAt. */
  attachPdf(id: string, pdfKey: string): Promise<void>;

  /** Records the signed scan, stamps uploadedAt, and flips status to completed. */
  attachScan(id: string, scanKey: string, scanName: string): Promise<void>;

  /** Removes the signed scan and returns the voucher to pending. */
  removeScan(id: string): Promise<void>;

  /**
   * Marks a voucher deleted. The row is deliberately kept: the sequence
   * allocator reads MAX(seq), so removing it outright would let the next
   * voucher reuse a number that has already been printed and possibly signed.
   */
  softDelete(id: string): Promise<void>;

  /** Undoes a delete. */
  restore(id: string): Promise<void>;

  /** Vouchers generated but not yet uploaded, oldest first. */
  listPending(company: CompanySlug): Promise<Voucher[]>;

  /** Filtered history, newest first, plus a total count for paging. */
  search(query: HistoryQuery): Promise<{ rows: Voucher[]; total: number }>;

  /** Counts for the workspace header. */
  counts(company: CompanySlug): Promise<{ pending: number; completed: number; total: number }>;

  listSignatories(company: CompanySlug): Promise<Signatory[]>;
  addSignatory(company: CompanySlug, name: string): Promise<Signatory>;
  removeSignatory(id: string): Promise<void>;
}
