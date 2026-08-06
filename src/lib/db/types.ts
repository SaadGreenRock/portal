import type {
  AllotFields,
  Asset,
  AssetCounts,
  AssetFields,
  AssetHolding,
  AssetQuery,
  EmployeeProfile,
  HoldingQuery,
  HoldingWithAsset,
  ReturnFields,
} from "../assets/types";
import type { CompanySlug } from "../companies";
import type {
  PoCounts,
  PoDoc,
  PoQuery,
  PoStatus,
  PurchaseOrder,
  VendorProfile,
} from "../po/types";
import type {
  RequestForQuotation,
  RfqCounts,
  RfqDoc,
  RfqQuery,
  RfqStatus,
} from "../rfq/types";
import type { CompanySettings } from "../settings";
import type { SpendRow } from "../spend/types";
import type { HistoryQuery, Signatory, Voucher, VoucherFields } from "../types";

/**
 * The only database surface the app uses. Two implementations exist — SQLite
 * for zero-setup local use and Supabase Postgres for hosted use — and nothing
 * outside this folder knows which one is active.
 *
 * It is split one interface per module. Adding a module means adding an
 * interface here and a section to each backend; nothing existing has to change,
 * and the compiler names every method still missing from a backend.
 */

export interface NewVoucher {
  company: CompanySlug;
  internalNote: string;
  fields: VoucherFields;
}

export interface VoucherStore {
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

export interface NewPurchaseOrder {
  company: CompanySlug;
  internalNote: string;
  doc: PoDoc;
}

export interface PoStore {
  /**
   * Reserves the next purchase order number for a company in the current month
   * and writes the record. Numbers are assigned at creation, while the order is
   * still a draft, so a PO can be referred to by number before it is issued.
   * Safe against concurrent calls.
   */
  createPo(input: NewPurchaseOrder): Promise<PurchaseOrder>;

  getPo(id: string): Promise<PurchaseOrder | null>;

  /**
   * Replaces the document and the internal note, and re-derives the stored
   * totals. The number, the status and the timestamps are not touched.
   */
  updatePo(id: string, doc: PoDoc, internalNote: string): Promise<PurchaseOrder>;

  /** Moves the order through its lifecycle, stamping issuedAt / closedAt. */
  setPoStatus(id: string, status: PoStatus): Promise<void>;

  /** Records the rendered PDF against the order. */
  attachPoPdf(id: string, pdfKey: string): Promise<void>;

  /**
   * Records the vendor's invoice and closes the order. The invoice arriving is
   * what "done" means for these purchases, so the two are one operation rather
   * than something the operator has to remember to do twice.
   */
  attachPoInvoice(id: string, invoiceKey: string, invoiceName: string): Promise<void>;

  /** Removes an invoice attached in error and reopens the order. */
  removePoInvoice(id: string): Promise<void>;

  /** Same reasoning as vouchers: the row stays so the number stays spent. */
  softDeletePo(id: string): Promise<void>;
  restorePo(id: string): Promise<void>;

  /** Filtered list, newest first, plus a total count for paging. */
  searchPos(query: PoQuery): Promise<{ rows: PurchaseOrder[]; total: number }>;

  poCounts(company: CompanySlug): Promise<PoCounts>;

  /**
   * Vendors as last used, newest first. There is no vendor table: the list is
   * assembled from previous orders, so nothing has to be maintained.
   */
  listVendors(company: CompanySlug): Promise<VendorProfile[]>;
}

export interface NewRfq {
  company: CompanySlug;
  internalNote: string;
  doc: RfqDoc;
}

export interface RfqStore {
  /**
   * Reserves the next request number for a company in the current month and
   * writes the record. Safe against concurrent calls, like the others.
   */
  createRfq(input: NewRfq): Promise<RequestForQuotation>;

  getRfq(id: string): Promise<RequestForQuotation | null>;

  /** Replaces the document and the internal note. Number and status untouched. */
  updateRfq(id: string, doc: RfqDoc, internalNote: string): Promise<RequestForQuotation>;

  setRfqStatus(id: string, status: RfqStatus): Promise<void>;

  attachRfqPdf(id: string, pdfKey: string): Promise<void>;

  /** Same reasoning as the others: the row stays so the number stays spent. */
  softDeleteRfq(id: string): Promise<void>;
  restoreRfq(id: string): Promise<void>;

  searchRfqs(query: RfqQuery): Promise<{ rows: RequestForQuotation[]; total: number }>;

  rfqCounts(company: CompanySlug): Promise<RfqCounts>;
}

export interface NewAsset {
  company: CompanySlug;
  fields: AssetFields;
  /** The first holding. An asset is logged as it is handed to someone. */
  allot: AllotFields;
}

export interface AssetStore {
  /**
   * Reserves the next asset number for a company, writes the asset, and opens
   * its first holding. The sequence is per company and never resets, so the
   * number is the permanent label for the physical item. Safe against
   * concurrent calls, like the others.
   */
  createAsset(input: NewAsset): Promise<Asset>;

  getAsset(id: string): Promise<Asset | null>;

  /**
   * Corrects the asset and, when it is out, the open holding — the two things
   * the record screen shows as editable. Neither the number nor the holding
   * history before the open one is touched.
   */
  updateAsset(id: string, fields: AssetFields, holder: AllotFields | null): Promise<Asset>;

  /**
   * Closes the open holding and puts the asset back in stock, recording the
   * condition it came back in against both the holding and the asset.
   *
   * Throws when the asset is already in stock: returning something nobody has
   * would write a holding period out of nothing.
   */
  returnAsset(id: string, fields: ReturnFields): Promise<Asset>;

  /**
   * Opens a new holding on an asset that is in stock.
   *
   * Throws when somebody already has it. An asset is returned before it goes to
   * the next person, so allowing this would leave two overlapping holdings and
   * no way to say which one the register's cached holder refers to.
   */
  allotAsset(id: string, allot: AllotFields): Promise<Asset>;

  /**
   * Same reasoning as every other module: the row stays, so the number stays
   * spent. Here it matters more than elsewhere — the number is stencilled on a
   * laptop, and reissuing it would label two things the same.
   */
  softDeleteAsset(id: string): Promise<void>;
  restoreAsset(id: string): Promise<void>;

  /** Filtered register, newest first, plus a total count for paging. */
  searchAssets(query: AssetQuery): Promise<{ rows: Asset[]; total: number }>;

  assetCounts(company: CompanySlug): Promise<AssetCounts>;

  /** One asset's holdings, newest first — the timeline on its record. */
  listHoldings(assetId: string): Promise<AssetHolding[]>;

  /**
   * Every holding, for the company-wide history: who had what, from when to
   * when. Newest first, paged, with each asset's number and name attached.
   */
  searchHoldings(query: HoldingQuery): Promise<{ rows: HoldingWithAsset[]; total: number }>;

  /**
   * Employees as last allotted to, newest first. Assembled from the holdings
   * themselves, so there is no employee list to keep up to date.
   */
  listEmployees(company: CompanySlug): Promise<EmployeeProfile[]>;
}

export interface SpendStore {
  /**
   * Every non-deleted voucher and purchase order for a company, reduced to what
   * a total needs.
   *
   * Deliberately not aggregated in the database. PostgREST cannot GROUP BY
   * without a stored function, and adding one would mean another migration the
   * operator has to remember to run; at this scale — a small company's
   * paperwork — selecting five columns and adding them up in the app costs
   * nothing. It would need revisiting at tens of thousands of records.
   */
  spendRows(company: CompanySlug): Promise<SpendRow[]>;
}

export interface SettingsStore {
  /** Always returns a complete object; unset fields fall back to the defaults. */
  getSettings(company: CompanySlug): Promise<CompanySettings>;
  /** Merges a partial update over what is stored. */
  saveSettings(company: CompanySlug, patch: Partial<CompanySettings>): Promise<CompanySettings>;
}

export interface Store
  extends VoucherStore,
    PoStore,
    RfqStore,
    AssetStore,
    SpendStore,
    SettingsStore {}
