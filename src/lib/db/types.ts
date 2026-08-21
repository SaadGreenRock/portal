import type {
  AllotFields,
  Asset,
  AssetCounts,
  AssetFields,
  AssetHolding,
  AssetQuery,
  HoldingQuery,
  HoldingWithAsset,
  ReturnFields,
} from "../assets/types";
import type { CompanySlug } from "../companies";
import type { FoodCounts, FoodExpense, FoodFields, FoodQuery } from "../food/types";
import type {
  Notification,
  NotificationCounts,
  NotificationFields,
  NotificationQuery,
} from "../notifications/types";
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
import type {
  Employee,
  EmployeeCounts,
  EmployeeFields,
  EmployeeQuery,
  EmployeeStatus,
  EmployeeSummary,
} from "../employees/types";
import type { CompanySettings } from "../settings";
import type { SpendRow } from "../spend/types";
import type {
  Allocation,
  AllocatableItem,
  Debit,
  DirectExpense,
  DirectFields,
  NewAllocation,
  SourceKind,
  Tranche,
  TrancheFields,
} from "../tranches/types";
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
  /**
   * The first holding, or null to log the asset into stock.
   *
   * It used to be required, which meant an asset entered the register by being
   * handed to somebody — so a laptop bought last week that nobody has yet could
   * not be recorded at all. Null is now an ordinary answer.
   */
  allot: AllotFields | null;
}

export interface AssetStore {
  /**
   * Reserves the next asset number for a company, writes the asset, and — when
   * an allotment is supplied — opens its first holding. The sequence is per
   * company and never resets, so the number is the permanent label for the
   * physical item. Safe against concurrent calls, like the others.
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

}

export interface NewEmployee {
  company: CompanySlug;
  fields: EmployeeFields;
}

/**
 * The employee register, per company.
 *
 * The one store here that assigns no number. Every other module reserves the
 * next sequence for you; an employee number is issued by the company and typed
 * by the operator, so this interface takes it and guards it instead of
 * generating it.
 */
export interface EmployeeStore {
  /**
   * Writes an employee.
   *
   * Throws `duplicateNumberMessage` when the number is already in use by a live
   * employee in the same company, naming who has it — the number was typed by
   * hand, so the likeliest cause is a typo or the person already being on the
   * register, and which of the two it is is the whole of what the operator needs
   * to know.
   */
  createEmployee(input: NewEmployee): Promise<Employee>;

  getEmployee(id: string): Promise<Employee | null>;

  /** Corrects the record. Same duplicate-number guard, ignoring this own row. */
  updateEmployee(id: string, fields: EmployeeFields): Promise<Employee>;

  /**
   * Marks somebody as having left, or brings them back.
   *
   * Separate from `updateEmployee` because it is a button rather than a form
   * save, and because going active again has to clear the leaving date — a
   * returning employee with a date in that column reads as still gone.
   */
  setEmployeeStatus(id: string, status: EmployeeStatus, leftOn: string | null): Promise<void>;

  /**
   * Soft delete, so the holdings that point at them never point into nothing.
   * Their number is freed for reuse, unlike a voucher's or an asset tag's — see
   * the partial unique index in the migration.
   */
  softDeleteEmployee(id: string): Promise<void>;
  restoreEmployee(id: string): Promise<void>;

  /** Filtered register, newest first, plus a total count for paging. */
  searchEmployees(query: EmployeeQuery): Promise<{ rows: Employee[]; total: number }>;

  employeeCounts(company: CompanySlug): Promise<EmployeeCounts>;

  /**
   * Every live employee reduced to what the asset dropdown and the register's
   * leaver flag need, with what each is holding right now.
   *
   * One method for both, deliberately: the dropdown wants the active ones and
   * the asset register wants to know which holders have left, and splitting that
   * into two queries would let the two screens disagree about who is still here.
   * Filter with `allotable` at the point of use.
   */
  employeeDirectory(company: CompanySlug): Promise<EmployeeSummary[]>;
}

export interface FoodStore {
  /**
   * Reserves the next entry number for the current month and writes the record.
   * Safe against concurrent calls, like the others.
   *
   * No `CompanySlug` parameter, here or anywhere else in this interface. A lunch
   * ordered for both companies belongs to neither workspace, and a signature
   * that demanded one would force every caller to invent an answer.
   */
  createFood(fields: FoodFields): Promise<FoodExpense>;

  getFood(id: string): Promise<FoodExpense | null>;

  /** Corrects an entry. The number and the audit stamps are not touched. */
  updateFood(id: string, fields: FoodFields): Promise<FoodExpense>;

  /** Filtered log, newest first, plus a total count for paging. */
  searchFood(query: FoodQuery): Promise<{ rows: FoodExpense[]; total: number }>;

  /**
   * The four running figures — spent, owed to vendors, owed to employees, and
   * everything outstanding.
   */
  foodCounts(): Promise<FoodCounts>;

  /**
   * Every live pending entry, for the outstanding screen.
   *
   * Unpaged on purpose. This is the set of things somebody is still waiting to
   * be paid for; if it ever grew past a screenful the answer is to settle them,
   * not to page through them.
   */
  pendingFood(): Promise<FoodExpense[]>;

  /**
   * Every live entry whose order date falls in the window, for the report.
   * Both bounds inclusive, and either may be null for no bound.
   */
  foodInRange(from: string | null, to: string | null): Promise<FoodExpense[]>;

  /**
   * Marks many entries paid in one statement, and returns how many actually
   * changed.
   *
   * Only touches rows that are still pending and still live, which makes the
   * call idempotent: a resubmitted settle form — the browser-back-then-refresh
   * that every operator eventually does — cannot rewrite the payment date of
   * something already settled last week.
   *
   * `receipt` is the proof of that one payment, already in storage. Every entry
   * in the settlement gets the same key: one cheque, one document, a dozen
   * entries pointing at it.
   */
  settleFood(
    ids: string[],
    paidAt: string,
    reference: string | null,
    receipt: { key: string; name: string } | null,
  ): Promise<number>;

  /** Files proof against one already-settled entry, replacing anything there. */
  attachFoodReceipt(id: string, receipt: { key: string; name: string }): Promise<FoodExpense>;

  /**
   * Unlinks the receipt from one entry, and reports whether any other live entry
   * still points at the same file.
   *
   * The caller deletes the file only when nothing does. A receipt is shared by
   * everything settled in the same payment, so deleting it on the strength of
   * one entry would blank the proof on the other eleven.
   */
  detachFoodReceipt(id: string): Promise<{ key: string | null; stillReferenced: boolean }>;

  /**
   * Puts a settled entry back to pending, clearing the payment it recorded —
   * including its proof, which was evidence of that payment. The stored file is
   * left alone, for the reason `detachFoodReceipt` gives.
   */
  unsettleFood(id: string): Promise<FoodExpense>;

  /**
   * The row stays, so the number stays spent — the same reasoning as everywhere
   * else, and it keeps a deleted entry's figures reconstructable.
   */
  softDeleteFood(id: string): Promise<void>;
  restoreFood(id: string): Promise<void>;

  /**
   * Vendor and payer names as already typed, most recent first, for the form's
   * datalists. Assembled from the entries themselves — the same reasoning as the
   * vendor list on purchase orders, so there is no list to keep up to date.
   */
  foodNames(): Promise<{ vendors: string[]; payers: string[]; orderedFor: string[] }>;

  /**
   * Every live entry reduced to what a total needs, for the expenditure report.
   * Not company-keyed, unlike `spendRows` — food belongs to neither workspace.
   */
  foodSpendRows(): Promise<SpendRow[]>;
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

/**
 * Investor funding.
 *
 * The only interface here that reads another module's tables. `allocatable`
 * gathers vouchers, purchase orders and food entries into one shape so a bucket
 * can be filled from any of them; nothing flows the other way, and no table
 * outside this section gained a column for it.
 */
export interface TrancheStore {
  /**
   * Writes a tranche and reserves its number. `TR-001`, continuous — the
   * sequence never resets, so the same guard the other modules use against a
   * concurrent double-claim applies here with no period to key on.
   */
  createTranche(fields: TrancheFields): Promise<Tranche>;

  getTranche(id: string): Promise<Tranche | null>;

  /** Corrects the figures. Number, close state and audit stamps are untouched. */
  updateTranche(id: string, fields: TrancheFields): Promise<Tranche>;

  /**
   * Closes a bucket with money still in it, or reopens it.
   *
   * Reversible on purpose: the remainder you decided was too small to spend in
   * August is exactly the remainder something turns out to fit in November.
   */
  setTrancheClosed(id: string, closed: boolean): Promise<void>;

  /** The row stays, so the number stays spent — as everywhere else. */
  softDeleteTranche(id: string): Promise<void>;
  restoreTranche(id: string): Promise<void>;

  /**
   * Every live tranche with its debits attached, newest received first.
   *
   * One method rather than a list and a per-tranche follow-up, because every
   * screen in the section needs both halves: the landing card's figure, the
   * index's cards and a bucket's own page are all `stand()` over this. Keeping
   * the arithmetic in that one pure function is what stops the figure on the
   * front page from disagreeing with the figure one click away.
   */
  fundingLedger(): Promise<Array<{ tranche: Tranche; debits: Debit[] }>>;

  /** One bucket's ledger, newest first. */
  listAllocations(trancheId: string): Promise<Allocation[]>;

  /**
   * Writes debits, all of them or none.
   *
   * Takes an array rather than one row because a split is two rows that only
   * make sense together: half a split leaves a bucket with a balance that is
   * wrong and an expense that looks attributed.
   *
   * Enforces both guards, because this is the only place that can:
   *
   *   an expense may not be allocated for more than it is worth, counted in the
   *   document's own currency; and
   *
   *   a bucket may not be drawn below zero. A bucket that can go negative is not
   *   a bucket, and one negative balance makes every figure on the page need
   *   reading with a caveat.
   *
   * Throws with the shortfall named, so the caller can offer the split rather
   * than just refusing.
   */
  allocate(rows: NewAllocation[]): Promise<void>;

  /** Corrects one debit. Same two guards. */
  updateAllocation(
    id: string,
    amount: number,
    sourceAmount: number,
    note: string | null,
  ): Promise<void>;

  /** Removes a debit. The expense returns to the queue by that much. */
  removeAllocation(id: string): Promise<void>;

  /**
   * Removes every debit pointing at one expense, and reports which tranches got
   * their money back.
   *
   * For deleting the expense itself. An allocation is a statement about where an
   * expense's money came from, so when the expense goes the statements have
   * nothing left to be about — leaving them behind would draw a bucket down for
   * something that no longer appears anywhere.
   *
   * Deliberately not used when a *tranche* is deleted. That case needs the
   * opposite: a tranche is only soft-deleted, and its allocations are already
   * invisible to `allocatable` and `fundingLedger` while it is gone, so keeping
   * them is what makes restoring the tranche put everything back exactly as it
   * was.
   */
  releaseSource(sourceKind: SourceKind, sourceId: string): Promise<string[]>;

  /**
   * Every expense in the portal that can go in a bucket, with how much of it
   * already is.
   *
   * Unpaged and unaggregated, for the reason `spendRows` gives: PostgREST cannot
   * GROUP BY without a stored function, and at the scale of a small company's
   * paperwork reading the rows and adding them up in the app costs nothing. It
   * would need revisiting at tens of thousands of records — the filters on the
   * picker are applied over the result rather than in the query for the same
   * reason.
   */
  allocatable(): Promise<AllocatableItem[]>;

  /**
   * Writes a direct entry, and — when it is being logged from inside a bucket —
   * its allocation in the same breath.
   *
   * One call rather than two, the way `createAsset` writes an asset and its
   * first holding: an expense typed into a bucket is already attributed by the
   * act of typing it there, and asking twice is asking to be forgotten once.
   *
   * `allocateTo` is ignored when the entry's currency differs from that
   * bucket's received currency — there is no rate to convert at, and inventing
   * one silently is worse than leaving the row in the queue.
   */
  createDirect(fields: DirectFields, allocateTo: string | null): Promise<DirectExpense>;

  getDirect(id: string): Promise<DirectExpense | null>;
  updateDirect(id: string, fields: DirectFields): Promise<DirectExpense>;

  /** The row stays, so the number stays spent. */
  softDeleteDirect(id: string): Promise<void>;
  restoreDirect(id: string): Promise<void>;

  /** Every live direct entry, newest first. */
  listDirect(): Promise<DirectExpense[]>;

  /** Payee names already typed, newest use first, for the form's datalist. */
  directPayees(): Promise<string[]>;
}

export interface SettingsStore {
  /** Always returns a complete object; unset fields fall back to the defaults. */
  getSettings(company: CompanySlug): Promise<CompanySettings>;
  /** Merges a partial update over what is stored. */
  saveSettings(company: CompanySlug, patch: Partial<CompanySettings>): Promise<CompanySettings>;
}

export interface NewNotification {
  company: CompanySlug;
  fields: NotificationFields;
}

export interface NotificationStore {
  /**
   * Reserves the next notification number for a company in the current month
   * and writes the record in one shot. Safe against concurrent calls, like
   * every other module's numbering.
   */
  createNotification(input: NewNotification): Promise<Notification>;

  getNotification(id: string): Promise<Notification | null>;

  /** Records the rendered PNG and stamps pngAt. */
  attachNotificationImage(id: string, pngKey: string): Promise<void>;

  /** Records the rendered PDF and stamps pdfAt. */
  attachNotificationPdf(id: string, pdfKey: string): Promise<void>;

  /** Same reasoning as every other module: the row stays, so its number stays
   *  spent, and a mistaken compose can be undone. */
  softDeleteNotification(id: string): Promise<void>;
  restoreNotification(id: string): Promise<void>;

  /** Filtered history, newest first, plus a total count for paging. */
  searchNotifications(query: NotificationQuery): Promise<{ rows: Notification[]; total: number }>;

  notificationCounts(company: CompanySlug): Promise<NotificationCounts>;
}

export interface Store
  extends VoucherStore,
    PoStore,
    RfqStore,
    AssetStore,
    EmployeeStore,
    FoodStore,
    SpendStore,
    TrancheStore,
    SettingsStore,
    NotificationStore {}
