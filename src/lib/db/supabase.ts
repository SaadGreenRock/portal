import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AllotFields,
  AssetCounts,
  AssetFields,
  AssetHolding,
  AssetPhoto,
  AssetQuery,
  AssetThumb,
  PhotoFields,
  HoldingQuery,
  ReturnFields,
} from "../assets/types";
import type { CompanySlug } from "../companies";
import {
  duplicateNumber,
  isEmployeeStatus,
  type DocKind,
  type Employee,
  type EmployeeCounts,
  type EmployeeFields,
  type EmployeeQuery,
  type EmployeeStatus,
  type EmployeeSummary,
} from "../employees/types";
import {
  summariseFood,
  type FoodCounts,
  type FoodExpense,
  type FoodFields,
  type FoodQuery,
} from "../food/types";
import { todayIso } from "../format";
import {
  summariseMisc,
  type MiscCounts,
  type MiscFields,
  type MiscPayment,
  type MiscQuery,
} from "../misc/types";
import type { Notification, NotificationCounts, NotificationQuery } from "../notifications/types";
import { OPEN_STATUSES, type PoCounts, type PoDoc, type PoQuery, type PoStatus, type PurchaseOrder } from "../po/types";
import {
  RFQ_OPEN_STATUSES,
  type RfqCounts,
  type RfqDoc,
  type RfqQuery,
  type RfqStatus,
} from "../rfq/types";
import { mergeSettings, type CompanySettings } from "../settings";
import type { SpendRow } from "../spend/types";
import {
  isSourceKind,
  overAllocateMessage,
  overdrawMessage,
  paisa,
  type AllocatableItem,
  type Allocation,
  type Debit,
  type SourceKind,
  type DirectExpense,
  type DirectFields,
  type NewAllocation,
  type Tranche,
  type TrancheFields,
} from "../tranches/types";
import type { HistoryQuery, Signatory, Voucher } from "../types";
import type {
  NewAsset,
  NewEmployee,
  NewMiscPayment,
  NewNotification,
  NewPurchaseOrder,
  NewRfq,
  NewVoucher,
  Store,
} from "./types";
import {
  allocationColumns,
  assembleAllocatable,
  denormalize,
  denormalizePo,
  denormalizeRfq,
  directColumns,
  directPayeesFrom,
  employeeColumns,
  employeeKey,
  employeeNoKey,
  foodColumns,
  miscColumns,
  foodNamesFrom,
  formatAssetNo,
  formatDirectNo,
  formatFoodNo,
  formatMiscNo,
  formatNotifNo,
  formatPoNo,
  formatRfqNo,
  formatTrancheNo,
  formatVoucherNo,
  docColumns,
  docKeyColumn,
  holderColumns,
  holdingColumns,
  IN_STOCK_COLUMNS,
  newId,
  periodOf,
  poStatusPatch,
  rfqStatusPatch,
  rowToAllocation,
  rowToAsset,
  rowToDirect,
  rowToEmployee,
  rowToFood,
  rowToHolding,
  rowToMisc,
  rowToHoldingWithAsset,
  rowToNotification,
  newestPerAsset,
  rowToPhoto,
  rowToPo,
  rowToRfq,
  rowToTranche,
  rowToVoucher,
  trancheColumns,
  statusChangesDocument,
  vendorProfilesFrom,
  type AllocationRow,
  type AssetRow,
  type DirectRow,
  type EmployeeRow,
  type FoodRow,
  type HoldingRow,
  type HoldingWithAssetRow,
  type MiscRow,
  type NotificationRow,
  type PhotoRow,
  type PoRow,
  type RfqRow,
  type TrancheRow,
  type VoucherRow,
} from "./shared";

let client: SupabaseClient | null = null;

/**
 * Reads the Supabase credentials, accepting either naming convention.
 *
 * Supabase now issues `sb_secret_…` / `sb_publishable_…` keys alongside the
 * legacy `service_role` / `anon` JWTs. Both the new secret key and the legacy
 * service_role key work here; the publishable and anon keys do not, and that is
 * deliberate — see the note in supabase/migration.sql.
 */
export function supabaseCredentials(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY
  )?.trim();

  if (!url || !key) {
    throw new Error(
      "BACKEND=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY " +
        "(SUPABASE_SERVICE_KEY is also accepted) in your environment.",
    );
  }

  // A publishable/anon key here would fail on every query in a way that looks
  // like a schema problem, so name the real cause up front.
  if (/^sb_publishable_/.test(key) || /"role":"anon"/.test(safeJwtPayload(key))) {
    throw new Error(
      "That looks like a publishable/anon key. The portal needs the secret key " +
        "(sb_secret_… or the legacy service_role key): the tables have RLS on with " +
        "no policies, so only a secret key can read them.",
    );
  }

  return { url, key };
}

/** Decodes a JWT payload for inspection only. Returns "" for non-JWTs. */
function safeJwtPayload(token: string): string {
  try {
    const [, payload] = token.split(".");
    if (!payload) return "";
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export function supabase(): SupabaseClient {
  if (client) return client;
  const { url, key } = supabaseCredentials();
  // This is server-only code behind the password gate, and it needs to bypass
  // RLS. The key must never reach the browser.
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

const TABLE = "vouchers";
const SIGNATORIES = "signatories";
const POS = "purchase_orders";
const RFQS = "requests_for_quotation";
const ASSETS = "assets";
const HOLDINGS = "asset_holdings";
const FOOD = "food_expenses";
const SETTINGS = "company_settings";
const NOTIFICATIONS = "notifications";
const TRANCHES = "funding_tranches";
const ALLOCATIONS = "tranche_allocations";
const DIRECT = "tranche_expenses";
const EMPLOYEES = "employees";
const PHOTOS = "asset_photos";
const MISC = "misc_payments";

/**
 * The one holding on an asset that has not been returned, if any.
 *
 * A partial unique index guarantees there is at most one, so this can safely
 * take the first row rather than reasoning about which of several is current.
 */
async function openHolding(
  db: SupabaseClient,
  assetId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from(HOLDINGS)
    .select("id")
    .eq("asset_id", assetId)
    .is("returned_on", null)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

function toSignatory(r: {
  id: string;
  company: string;
  name: string;
  created_at: string;
}): Signatory {
  return {
    id: r.id,
    company: r.company as CompanySlug,
    name: r.name,
    createdAt: r.created_at,
  };
}

/**
 * The live employee in this company already using a number, if any.
 *
 * Compared loosely — case and spacing folded — because "emp 001", "EMP-001" and
 * "emp-001" typed on three different days are one number to everybody except a
 * database. The stored value keeps whatever was typed; only the comparison is
 * loosened, and the partial unique index stays as the exact-match backstop.
 *
 * Read into the app rather than expressed as a query: PostgREST has no way to
 * apply that folding in a filter, and a company's register is a list of people
 * rather than a table of transactions.
 *
 * `exceptId` is the row being edited, which must not be found as a clash with
 * itself.
 */
async function findEmployeeByNo(
  db: SupabaseClient,
  company: CompanySlug,
  employeeNo: string,
  exceptId: string | null,
): Promise<{ id: string; name: string } | null> {
  const key = employeeNoKey(employeeNo);
  if (!key) return null;

  const { data, error } = await db
    .from(EMPLOYEES)
    .select("id, name, employee_no")
    .eq("company", company)
    .is("deleted_at", null)
    .limit(5000);
  if (error) throw error;

  const hit = (data ?? []).find(
    (r) => String(r.id) !== exceptId && employeeNoKey(String(r.employee_no)) === key,
  );
  return hit ? { id: String(hit.id), name: String(hit.name) } : null;
}

export const supabaseStore: Store = {
  async createVoucher({ company, internalNote, fields }: NewVoucher): Promise<Voucher> {
    const db = supabase();
    const period = periodOf();
    const d = denormalize(fields);

    // The (company, period, seq) unique index does the real work: if two
    // requests pick the same sequence, one insert fails and we try the next.
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: highest, error: maxErr } = await db
        .from(TABLE)
        .select("seq")
        .eq("company", company)
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;

      const { data, error } = await db
        .from(TABLE)
        .insert({
          id: newId(),
          voucher_no: formatVoucherNo(company, period, seq),
          company,
          status: "pending",
          seq,
          period,
          internal_note: internalNote,
          fields,
          recipient_name: d.recipientName,
          description: d.description,
          amount: d.amount,
          voucher_date: d.voucherDate,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!error) return rowToVoucher(data as VoucherRow);
      // 23505 = unique_violation → someone took this number; recompute and retry.
      if (error.code !== "23505" || attempt === 5) throw error;
    }
    throw new Error("Could not assign a voucher number after several attempts");
  },

  async getVoucher(id) {
    const { data, error } = await supabase().from(TABLE).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToVoucher(data as VoucherRow) : null;
  },

  async getVoucherByNo(voucherNo) {
    const { data, error } = await supabase()
      .from(TABLE)
      .select()
      .eq("voucher_no", voucherNo)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToVoucher(data as VoucherRow) : null;
  },

  async attachPdf(id, pdfKey) {
    const { error } = await supabase()
      .from(TABLE)
      .update({ pdf_key: pdfKey, generated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async attachScan(id, scanKey, scanName) {
    const { error } = await supabase()
      .from(TABLE)
      .update({
        scan_key: scanKey,
        scan_name: scanName,
        uploaded_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", id);
    if (error) throw error;
  },

  async removeScan(id) {
    const { error } = await supabase()
      .from(TABLE)
      .update({ scan_key: null, scan_name: null, uploaded_at: null, status: "pending" })
      .eq("id", id);
    if (error) throw error;
  },

  async softDelete(id) {
    const { error } = await supabase()
      .from(TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase().from(TABLE).update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  async listPending(company) {
    const { data, error } = await supabase()
      .from(TABLE)
      .select()
      .eq("company", company)
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as VoucherRow[]).map(rowToVoucher);
  },

  async search(query: HistoryQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase()
      .from(TABLE)
      .select("*", { count: "exact" })
      .eq("company", query.company);

    // "deleted" is the recycle-bin view; every other view hides deleted rows.
    if (query.status === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.status && query.status !== "all") q = q.eq("status", query.status);
    }
    if (query.q?.trim()) {
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(
        [
          `voucher_no.ilike.%${term}%`,
          `recipient_name.ilike.%${term}%`,
          `internal_note.ilike.%${term}%`,
          `description.ilike.%${term}%`,
        ].join(","),
      );
    }
    if (query.from) q = q.gte("created_at", `${query.from}T00:00:00.000Z`);
    if (query.to) q = q.lte("created_at", `${query.to}T23:59:59.999Z`);
    if (query.minAmount != null) q = q.gte("amount", query.minAmount);
    if (query.maxAmount != null) q = q.lte("amount", query.maxAmount);

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as VoucherRow[]).map(rowToVoucher), total: count ?? 0 };
  },

  async counts(company: CompanySlug) {
    const db = supabase();
    const base = () =>
      db
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("company", company)
        .is("deleted_at", null);
    const [pendingRes, completedRes] = await Promise.all([
      base().eq("status", "pending"),
      base().eq("status", "completed"),
    ]);
    if (pendingRes.error) throw pendingRes.error;
    if (completedRes.error) throw completedRes.error;
    const pending = pendingRes.count ?? 0;
    const completed = completedRes.count ?? 0;
    return { pending, completed, total: pending + completed };
  },

  async listSignatories(company) {
    const { data, error } = await supabase()
      .from(SIGNATORIES)
      .select()
      .eq("company", company)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toSignatory);
  },

  async addSignatory(company, name) {
    const trimmed = name.trim();
    const { data, error } = await supabase()
      .from(SIGNATORIES)
      .upsert(
        { id: newId(), company, name: trimmed, created_at: new Date().toISOString() },
        { onConflict: "company,name", ignoreDuplicates: false },
      )
      .select()
      .single();
    if (error) throw error;
    return toSignatory(data);
  },

  async removeSignatory(id) {
    const { error } = await supabase().from(SIGNATORIES).delete().eq("id", id);
    if (error) throw error;
  },

  /* ---- purchase orders ------------------------------------------------- */

  async createPo({ company, internalNote, doc }: NewPurchaseOrder): Promise<PurchaseOrder> {
    const db = supabase();
    const period = periodOf();
    const d = denormalizePo(doc);

    // The (company, period, seq) unique index does the real work: if two
    // requests pick the same sequence, one insert fails and we try the next.
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: highest, error: maxErr } = await db
        .from(POS)
        .select("seq")
        .eq("company", company)
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();

      const { data, error } = await db
        .from(POS)
        .insert({
          id: newId(),
          po_no: formatPoNo(company, period, seq),
          company,
          status: "draft",
          seq,
          period,
          internal_note: internalNote,
          doc,
          created_at: now,
          updated_at: now,
          ...d,
        })
        .select()
        .single();

      if (!error) return rowToPo(data as PoRow);
      // 23505 = unique_violation → someone took this number; recompute and retry.
      if (error.code !== "23505" || attempt === 5) throw error;
    }
    throw new Error("Could not assign a purchase order number after several attempts");
  },

  async getPo(id) {
    const { data, error } = await supabase().from(POS).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToPo(data as PoRow) : null;
  },

  async updatePo(id, doc: PoDoc, internalNote: string) {
    const { data, error } = await supabase()
      .from(POS)
      .update({
        doc,
        internal_note: internalNote,
        updated_at: new Date().toISOString(),
        ...denormalizePo(doc),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToPo(data as PoRow);
  },

  async setPoStatus(id, status: PoStatus) {
    const db = supabase();
    const { data, error: readErr } = await db.from(POS).select().eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error("Purchase order not found");

    const { error } = await db
      .from(POS)
      .update(poStatusPatch(rowToPo(data as PoRow), status, new Date().toISOString()))
      .eq("id", id);
    if (error) throw error;
  },

  async attachPoPdf(id, pdfKey) {
    // updated_at is deliberately untouched: rendering the PDF is not an edit to
    // the document, and pdf_at older than updated_at is how a stale file is spotted.
    const { error } = await supabase()
      .from(POS)
      .update({ pdf_key: pdfKey, pdf_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async attachPoInvoice(id, invoiceKey, invoiceName) {
    const db = supabase();
    const { data, error: readErr } = await db.from(POS).select().eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error("Purchase order not found");

    const current = rowToPo(data as PoRow);
    const now = new Date().toISOString();
    // A cancelled order that turns out to have been delivered anyway keeps its
    // status: reviving it is a decision for the operator, not a side effect of
    // filing a document.
    const status = current.status === "cancelled" ? current.status : "closed";

    const { error } = await db
      .from(POS)
      .update({
        invoice_key: invoiceKey,
        invoice_name: invoiceName,
        invoice_at: now,
        status,
        ...(status === "closed" ? { closed_at: now } : {}),
        // Filing paperwork is not an edit to the document, so the stored PDF
        // stays current unless the status change itself alters the watermark.
        ...(statusChangesDocument(current.status, status) ? { updated_at: now } : {}),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async removePoInvoice(id) {
    const db = supabase();
    const { data, error: readErr } = await db.from(POS).select().eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error("Purchase order not found");

    const current = rowToPo(data as PoRow);
    const now = new Date().toISOString();
    const status = current.status === "closed" ? "issued" : current.status;

    const { error } = await db
      .from(POS)
      .update({
        invoice_key: null,
        invoice_name: null,
        invoice_at: null,
        status,
        // Reopening clears the close stamp; any other status keeps whatever it had.
        ...(current.status === "closed" ? { closed_at: null } : {}),
        ...(statusChangesDocument(current.status, status) ? { updated_at: now } : {}),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async softDeletePo(id) {
    const { error } = await supabase()
      .from(POS)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restorePo(id) {
    const { error } = await supabase().from(POS).update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  async searchPos(query: PoQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase().from(POS).select("*", { count: "exact" }).eq("company", query.company);

    if (query.status === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.status === "open") {
        q = q.in("status", OPEN_STATUSES);
      } else if (query.status && query.status !== "all") {
        q = q.eq("status", query.status);
      }
    }
    if (query.q?.trim()) {
      // Commas and parentheses would be read as .or() syntax, not as text.
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(
        [
          `po_no.ilike.%${term}%`,
          `vendor_name.ilike.%${term}%`,
          `subject.ilike.%${term}%`,
          `internal_note.ilike.%${term}%`,
        ].join(","),
      );
    }
    if (query.from) q = q.gte("po_date", query.from);
    if (query.to) q = q.lte("po_date", query.to);
    if (query.minAmount != null) q = q.gte("total", query.minAmount);
    if (query.maxAmount != null) q = q.lte("total", query.maxAmount);

    const { data, error, count } = await q
      // nullsFirst matches SQLite, which puts NULLs last on a DESC sort.
      // Without it Postgres floats an order with no date to the top of History
      // on the deployed site but not locally.
      .order("po_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as PoRow[]).map(rowToPo), total: count ?? 0 };
  },

  async poCounts(company: CompanySlug): Promise<PoCounts> {
    const db = supabase();
    const base = () =>
      db
        .from(POS)
        .select("id", { count: "exact", head: true })
        .eq("company", company)
        .is("deleted_at", null);

    const statuses: PoStatus[] = ["draft", "issued", "closed", "cancelled"];
    const results = await Promise.all(statuses.map((s) => base().eq("status", s)));
    for (const r of results) if (r.error) throw r.error;

    const [draft, issued, closed, cancelled] = results.map((r) => r.count ?? 0);
    return {
      draft,
      issued,
      closed,
      cancelled,
      open: draft + issued,
      total: draft + issued + closed + cancelled,
    };
  },

  async listVendors(company) {
    const { data, error } = await supabase()
      .from(POS)
      .select("doc, created_at")
      .eq("company", company)
      .is("deleted_at", null)
      .neq("vendor_name", "")
      .order("created_at", { ascending: false })
      .limit(600);
    if (error) throw error;
    return vendorProfilesFrom((data ?? []) as Array<{ doc: PoDoc; created_at: string }>);
  },

  /* ---- requests for quotation ------------------------------------------ */

  async createRfq({ company, internalNote, doc }: NewRfq) {
    const db = supabase();
    const period = periodOf();
    const d = denormalizeRfq(doc);

    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: highest, error: maxErr } = await db
        .from(RFQS)
        .select("seq")
        .eq("company", company)
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();

      const { data, error } = await db
        .from(RFQS)
        .insert({
          id: newId(),
          rfq_no: formatRfqNo(company, period, seq),
          company,
          status: "draft",
          seq,
          period,
          internal_note: internalNote,
          doc,
          created_at: now,
          updated_at: now,
          ...d,
        })
        .select()
        .single();

      if (!error) return rowToRfq(data as RfqRow);
      // 23505 = unique_violation -> someone took this number; recompute and retry.
      if (error.code !== "23505" || attempt === 5) throw error;
    }
    throw new Error("Could not assign a request number after several attempts");
  },

  async getRfq(id) {
    const { data, error } = await supabase().from(RFQS).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToRfq(data as RfqRow) : null;
  },

  async updateRfq(id, doc: RfqDoc, internalNote: string) {
    const { data, error } = await supabase()
      .from(RFQS)
      .update({
        doc,
        internal_note: internalNote,
        updated_at: new Date().toISOString(),
        ...denormalizeRfq(doc),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToRfq(data as RfqRow);
  },

  async setRfqStatus(id, status: RfqStatus) {
    const db = supabase();
    const { data, error: readErr } = await db.from(RFQS).select().eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error("Request for quotation not found");

    const { error } = await db
      .from(RFQS)
      .update(rfqStatusPatch(rowToRfq(data as RfqRow), status, new Date().toISOString()))
      .eq("id", id);
    if (error) throw error;
  },

  async attachRfqPdf(id, pdfKey) {
    // updated_at untouched: rendering is not an edit to the document.
    const { error } = await supabase()
      .from(RFQS)
      .update({ pdf_key: pdfKey, pdf_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async softDeleteRfq(id) {
    const { error } = await supabase()
      .from(RFQS)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreRfq(id) {
    const { error } = await supabase().from(RFQS).update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  async searchRfqs(query: RfqQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase().from(RFQS).select("*", { count: "exact" }).eq("company", query.company);

    if (query.status === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.status === "open") {
        q = q.in("status", RFQ_OPEN_STATUSES);
      } else if (query.status && query.status !== "all") {
        q = q.eq("status", query.status);
      }
    }
    if (query.q?.trim()) {
      // Commas and parentheses would be read as .or() syntax, not as text.
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(
        [`rfq_no.ilike.%${term}%`, `subject.ilike.%${term}%`, `internal_note.ilike.%${term}%`].join(
          ",",
        ),
      );
    }
    if (query.from) q = q.gte("rfq_date", query.from);
    if (query.to) q = q.lte("rfq_date", query.to);

    const { data, error, count } = await q
      // nullsFirst matches SQLite, which puts NULLs last on a DESC sort.
      .order("rfq_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as RfqRow[]).map(rowToRfq), total: count ?? 0 };
  },

  async rfqCounts(company: CompanySlug): Promise<RfqCounts> {
    const db = supabase();
    const base = () =>
      db
        .from(RFQS)
        .select("id", { count: "exact", head: true })
        .eq("company", company)
        .is("deleted_at", null);

    const statuses: RfqStatus[] = ["draft", "sent", "closed", "cancelled"];
    const results = await Promise.all(statuses.map((s) => base().eq("status", s)));
    for (const r of results) if (r.error) throw r.error;

    const [draft, sent, closed, cancelled] = results.map((r) => r.count ?? 0);
    return {
      draft,
      sent,
      closed,
      cancelled,
      open: draft + sent,
      total: draft + sent + closed + cancelled,
    };
  },

  /* ---- asset register --------------------------------------------------- */
  //
  // Postgres has no transaction available through PostgREST, so the two writes
  // that an allotment or a return needs happen in sequence. The order is chosen
  // so a failure between them leaves the *history* short rather than wrong: the
  // holdings table is the authority, and re-running the same action from the
  // record screen puts the pair back in step. The partial unique index on
  // (asset_id) WHERE returned_on IS NULL is what actually prevents two people
  // holding the same asset at once, whatever the application does.

  async createAsset({ company, fields, allot }: NewAsset) {
    const db = supabase();

    for (let attempt = 0; attempt < 6; attempt++) {
      // No period filter, and deleted rows count: a number written on an item
      // is spent even if the row was binned.
      const { data: highest, error: maxErr } = await db
        .from(ASSETS)
        .select("seq")
        .eq("company", company)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();
      const id = newId();

      const { data, error } = await db
        .from(ASSETS)
        .insert({
          id,
          asset_no: formatAssetNo(company, seq),
          company,
          seq,
          asset_name: fields.assetName,
          condition: "good",
          created_at: now,
          updated_at: now,
          // An asset with no first holder starts in stock, which the register
          // could not represent before the employee dropdown existed.
          ...(allot ? holderColumns(allot) : IN_STOCK_COLUMNS),
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation -> someone took this number; recompute.
        if (error.code !== "23505" || attempt === 5) throw error;
        continue;
      }

      // The asset owns the number, so it goes in first; the holding references
      // it. With no allotment there is no holding at all, and the asset is in
      // stock from the start.
      if (allot) {
        const { error: holdErr } = await db.from(HOLDINGS).insert({
          id: newId(),
          asset_id: id,
          company,
          returned_on: null,
          condition: "good",
          note: "",
          created_at: now,
          updated_at: now,
          ...holdingColumns(allot),
        });
        if (holdErr) throw holdErr;
      }

      return rowToAsset(data as AssetRow);
    }
    throw new Error("Could not assign an asset number after several attempts");
  },

  async getAsset(id) {
    const { data, error } = await supabase().from(ASSETS).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToAsset(data as AssetRow) : null;
  },

  async updateAsset(id, fields: AssetFields, holder: AllotFields | null) {
    const db = supabase();
    const now = new Date().toISOString();

    // Only the open holding is editable, and only when there is one: a
    // correction to who has it now must not rewrite a closed period.
    const open = holder ? await openHolding(db, id) : null;

    if (open && holder) {
      const { error } = await db
        .from(HOLDINGS)
        .update({ updated_at: now, ...holdingColumns(holder) })
        .eq("id", open.id);
      if (error) throw error;
    }

    const { data, error } = await db
      .from(ASSETS)
      .update({
        asset_name: fields.assetName,
        updated_at: now,
        ...(open && holder ? holderColumns(holder) : {}),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToAsset(data as AssetRow);
  },

  async returnAsset(id, fields: ReturnFields) {
    const db = supabase();
    const now = new Date().toISOString();

    const open = await openHolding(db, id);
    if (!open) throw new Error("That asset is already in stock — nobody has it to return.");

    const { error: closeErr } = await db
      .from(HOLDINGS)
      .update({
        // Stored rather than left null so a closed holding always has an end —
        // a null returned_on is what marks a holding open.
        returned_on: fields.returnedOn || todayIso(),
        condition: fields.condition,
        note: fields.note,
        updated_at: now,
      })
      .eq("id", open.id);
    if (closeErr) throw closeErr;

    const { data, error } = await db
      .from(ASSETS)
      .update({
        ...IN_STOCK_COLUMNS,
        condition: fields.condition,
        updated_at: now,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToAsset(data as AssetRow);
  },

  async allotAsset(id, allot: AllotFields) {
    const db = supabase();
    const now = new Date().toISOString();

    const { data: current, error: readErr } = await db
      .from(ASSETS)
      .select()
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) throw new Error("Asset not found");

    const asset = current as AssetRow;
    if (asset.holder_name) {
      throw new Error(`${asset.asset_no} is with ${asset.holder_name}. Record its return first.`);
    }

    const { error: holdErr } = await db.from(HOLDINGS).insert({
      id: newId(),
      asset_id: id,
      company: asset.company,
      returned_on: null,
      condition: "good",
      note: "",
      created_at: now,
      updated_at: now,
      ...holdingColumns(allot),
    });
    if (holdErr) throw holdErr;

    const { data, error } = await db
      .from(ASSETS)
      .update({ updated_at: now, ...holderColumns(allot) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToAsset(data as AssetRow);
  },

  async softDeleteAsset(id) {
    const { error } = await supabase()
      .from(ASSETS)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreAsset(id) {
    const { error } = await supabase().from(ASSETS).update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  async searchAssets(query: AssetQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase().from(ASSETS).select("*", { count: "exact" }).eq("company", query.company);

    if (query.view === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.view === "out") q = q.neq("holder_name", "");
      else if (query.view === "stock") q = q.eq("holder_name", "");
    }

    if (query.q?.trim()) {
      // Commas and parentheses would be read as .or() syntax, not as text.
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(
        [
          `asset_no.ilike.%${term}%`,
          `asset_name.ilike.%${term}%`,
          `holder_name.ilike.%${term}%`,
          `holder_no.ilike.%${term}%`,
        ].join(","),
      );
    }

    // Assets out first, then by how long they have been out; then stock. Matches
    // the SQLite ordering, which sorts on (holder_name = '') ascending.
    const { data, error, count } = await q
      .order("holder_name", { ascending: false })
      .order("held_since", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as AssetRow[]).map(rowToAsset), total: count ?? 0 };
  },

  async assetCounts(company: CompanySlug): Promise<AssetCounts> {
    // Three columns, reduced in the app. PostgREST cannot COUNT(DISTINCT …)
    // without a stored function, and the same reasoning as spendRows applies:
    // adding one is another migration the operator has to remember to run, and
    // at this scale three columns per asset costs nothing.
    const { data, error } = await supabase()
      .from(ASSETS)
      .select("holder_name, holder_no, condition")
      .eq("company", company)
      .is("deleted_at", null)
      .limit(5000);
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      holder_name: string | null;
      holder_no: string | null;
      condition: string | null;
    }>;

    const people = new Set<string>();
    let out = 0;
    let flagged = 0;
    for (const r of rows) {
      const name = r.holder_name ?? "";
      if (name) {
        out += 1;
        people.add(employeeKey(name, r.holder_no ?? ""));
      }
      if ((r.condition ?? "good") !== "good") flagged += 1;
    }

    return {
      total: rows.length,
      out,
      stock: rows.length - out,
      employees: people.size,
      flagged,
    };
  },

  async listHoldings(assetId: string): Promise<AssetHolding[]> {
    const { data, error } = await supabase()
      .from(HOLDINGS)
      .select()
      .eq("asset_id", assetId)
      // Open first, then newest. nullsFirst puts the open holding at the top.
      .order("returned_on", { ascending: true, nullsFirst: true })
      .order("allotted_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as HoldingRow[]).map(rowToHolding);
  },

  async searchHoldings(query: HoldingQuery) {
    const db = supabase();
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    // !inner so a holding whose asset is deleted drops out, matching the JOIN
    // the SQLite backend uses.
    let q = db
      .from(HOLDINGS)
      .select("*, assets!inner(asset_no, asset_name, deleted_at)", { count: "exact" })
      .eq("company", query.company)
      .is("assets.deleted_at", null);

    if (query.view === "open") q = q.is("returned_on", null);
    else if (query.view === "closed") q = q.not("returned_on", "is", null);

    // Matched on the link, never the name: an employee's record must show what
    // was genuinely allotted to that register entry and not somebody else who
    // happens to share a spelling.
    if (query.employeeId) q = q.eq("employee_id", query.employeeId);

    if (query.q?.trim()) {
      const term = query.q.trim().replace(/[%,()]/g, " ");
      // PostgREST cannot put an embedded table's column inside .or(), so the
      // asset half of the search is resolved to ids first and matched on
      // asset_id. Bounded by the assets table, which is small.
      const { data: hits, error: hitErr } = await db
        .from(ASSETS)
        .select("id")
        .eq("company", query.company)
        .or(`asset_no.ilike.%${term}%,asset_name.ilike.%${term}%`)
        .limit(1000);
      if (hitErr) throw hitErr;

      const ids = (hits ?? []).map((r) => (r as { id: string }).id);
      const clauses = [`employee_name.ilike.%${term}%`, `employee_no.ilike.%${term}%`];
      if (ids.length) clauses.push(`asset_id.in.(${ids.join(",")})`);
      q = q.or(clauses.join(","));
    }

    // Overlap, not containment: a holding that started in July and is still open
    // is part of "who had something in August". Two periods overlap when each
    // starts before the other ends — plain comparisons against the generated
    // span columns, so this needs no second OR group. Deliberately not another
    // .or(): one `or=` query parameter per request is the pattern the rest of
    // this backend uses, and it is the one whose behaviour is not in question.
    if (query.from) q = q.gte("span_end", query.from);
    if (query.to) q = q.lte("span_start", query.to);

    const { data, error, count } = await q
      .order("allotted_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return {
      rows: (data as HoldingWithAssetRow[]).map(rowToHoldingWithAsset),
      total: count ?? 0,
    };
  },

  async attachEmployeeDoc(
    id: string,
    kind: DocKind,
    doc: { key: string; name: string },
  ): Promise<{ previousKey: string | null }> {
    const db = supabase();
    const column = docKeyColumn(kind);

    const row = await db.from(EMPLOYEES).select(column).eq("id", id).maybeSingle();
    if (row.error) throw row.error;
    if (!row.data) throw new Error("Employee not found");

    const now = new Date().toISOString();
    const { error } = await db
      .from(EMPLOYEES)
      .update({ updated_at: now, ...docColumns(kind, doc, now) })
      .eq("id", id);
    if (error) throw error;

    // Returned rather than deleted here: the store does not touch storage, so the
    // caller removes the file it has just replaced.
    const previous = (row.data as Record<string, unknown>)[column];
    return { previousKey: previous ? String(previous) : null };
  },

  async detachEmployeeDoc(id: string, kind: DocKind): Promise<{ key: string | null }> {
    const db = supabase();
    const column = docKeyColumn(kind);

    const row = await db.from(EMPLOYEES).select(column).eq("id", id).maybeSingle();
    if (row.error) throw row.error;
    if (!row.data) throw new Error("Employee not found");

    const { error } = await db
      .from(EMPLOYEES)
      .update({ updated_at: new Date().toISOString(), ...docColumns(kind, null, null) })
      .eq("id", id);
    if (error) throw error;

    const key = (row.data as Record<string, unknown>)[column];
    return { key: key ? String(key) : null };
  },

  async employeeDirectory(company: CompanySlug): Promise<EmployeeSummary[]> {
    const db = supabase();

    const [people, held] = await Promise.all([
      db
        .from(EMPLOYEES)
        .select("id, employee_no, name, status")
        .eq("company", company)
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(5000),
      // Every held asset in one request rather than a query per person: the
      // dropdown draws the whole list on every asset form, and a register of
      // forty people would otherwise be forty round trips to render one select.
      db
        .from(ASSETS)
        .select("holder_id")
        .eq("company", company)
        .is("deleted_at", null)
        .not("holder_id", "is", null)
        .limit(5000),
    ]);
    if (people.error) throw people.error;
    if (held.error) throw held.error;

    const counts = new Map<string, number>();
    for (const row of held.data ?? []) {
      const key = String(row.holder_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return (people.data ?? []).map((e) => ({
      id: String(e.id),
      employeeNo: String(e.employee_no ?? ""),
      name: String(e.name ?? ""),
      status: isEmployeeStatus(e.status) ? e.status : "active",
      holding: counts.get(String(e.id)) ?? 0,
    }));
  },


  /* ---- asset photographs -------------------------------------------------- */

  async addAssetPhoto(
    assetId: string,
    photo: PhotoFields & { key: string; name: string },
  ): Promise<AssetPhoto> {
    const db = supabase();

    const asset = await db.from(ASSETS).select("company").eq("id", assetId).maybeSingle();
    if (asset.error) throw asset.error;
    if (!asset.data) throw new Error("Asset not found");

    const { data, error } = await db
      .from(PHOTOS)
      .insert({
        id: newId(),
        asset_id: assetId,
        company: String(asset.data.company),
        key: photo.key,
        name: photo.name,
        // Defaulted rather than left null: a picture with no date cannot take its
        // place in a sequence, and the sequence is the whole point of the log.
        taken_on: photo.takenOn || todayIso(),
        info: photo.info,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    return rowToPhoto(data as PhotoRow);
  },

  async listAssetPhotos(assetId: string): Promise<AssetPhoto[]> {
    const { data, error } = await supabase()
      .from(PHOTOS)
      .select()
      .eq("asset_id", assetId)
      .order("taken_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => rowToPhoto(r as PhotoRow));
  },

  async removeAssetPhoto(id: string): Promise<{ key: string } | null> {
    const db = supabase();

    const row = await db.from(PHOTOS).select("key").eq("id", id).maybeSingle();
    if (row.error) throw row.error;
    if (!row.data) return null;

    // Hard delete, and the file goes with it. A photograph carries no number and
    // is nobody's record — a picture filed by mistake should leave no trace.
    const { error } = await db.from(PHOTOS).delete().eq("id", id);
    if (error) throw error;
    return { key: String(row.data.key) };
  },

  async latestAssetPhotos(company: CompanySlug): Promise<AssetThumb[]> {
    // Every photo for the company in one request, reduced by the shared helper —
    // the same reduction the SQLite backend uses, so the two cannot disagree
    // about which picture is the newest.
    const { data, error } = await supabase()
      .from(PHOTOS)
      .select()
      .eq("company", company)
      .limit(20000);
    if (error) throw error;
    return newestPerAsset((data ?? []) as PhotoRow[]);
  },

  /* ---- employees --------------------------------------------------------- */

  async createEmployee({ company, fields }: NewEmployee): Promise<Employee> {
    const db = supabase();
    const columns = employeeColumns(fields);

    const clash = await findEmployeeByNo(db, company, columns.employee_no, null);
    if (clash) throw duplicateNumber(columns.employee_no, clash.name);

    const now = new Date().toISOString();
    const { data, error } = await db
      .from(EMPLOYEES)
      .insert({ id: newId(), company, created_at: now, updated_at: now, ...columns })
      .select()
      .single();

    // 23505 = unique_violation. The partial index caught an exact duplicate the
    // loose check above did not — two requests racing, or a number that differs
    // only in ways `employeeNoKey` folds. Reported as the same refusal rather
    // than as a database error.
    if (error) {
      if (error.code === "23505") {
        throw duplicateNumber(columns.employee_no, "somebody else on this register");
      }
      throw error;
    }

    return rowToEmployee(data as EmployeeRow);
  },

  async getEmployee(id) {
    const { data, error } = await supabase()
      .from(EMPLOYEES)
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToEmployee(data as EmployeeRow) : null;
  },

  async updateEmployee(id, fields: EmployeeFields): Promise<Employee> {
    const db = supabase();
    const columns = employeeColumns(fields);

    const current = await db.from(EMPLOYEES).select("company").eq("id", id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) throw new Error("Employee not found");

    // Ignoring this row: renumbering somebody to the number they already have
    // would otherwise be refused as a clash with themselves.
    const clash = await findEmployeeByNo(
      db,
      String(current.data.company) as CompanySlug,
      columns.employee_no,
      id,
    );
    if (clash) throw duplicateNumber(columns.employee_no, clash.name);

    const { data, error } = await db
      .from(EMPLOYEES)
      .update({ updated_at: new Date().toISOString(), ...columns })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw duplicateNumber(columns.employee_no, "somebody else on this register");
      }
      throw error;
    }
    return rowToEmployee(data as EmployeeRow);
  },

  async setEmployeeStatus(id, status: EmployeeStatus, leftOn: string | null) {
    const { error } = await supabase()
      .from(EMPLOYEES)
      .update({
        status,
        // Cleared on the way back to active: a returning employee still carrying
        // a leaving date reads as though they were gone.
        left_on: status === "active" ? null : leftOn || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async softDeleteEmployee(id) {
    const now = new Date().toISOString();
    const { error } = await supabase()
      .from(EMPLOYEES)
      .update({ deleted_at: now, updated_at: now })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreEmployee(id) {
    const db = supabase();

    // The number was freed when they were deleted, so somebody may be using it
    // by now. Restoring into a clash would break the partial unique index, so it
    // is refused with the same message — the operator renumbers one of the two.
    const row = await db
      .from(EMPLOYEES)
      .select("company, employee_no")
      .eq("id", id)
      .maybeSingle();
    if (row.error) throw row.error;
    if (!row.data) throw new Error("Employee not found");

    const clash = await findEmployeeByNo(
      db,
      String(row.data.company) as CompanySlug,
      String(row.data.employee_no),
      id,
    );
    if (clash) throw duplicateNumber(String(row.data.employee_no), clash.name);

    const { error } = await db
      .from(EMPLOYEES)
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async searchEmployees(query: EmployeeQuery) {
    let q = supabase()
      .from(EMPLOYEES)
      .select("*", { count: "exact" })
      .eq("company", query.company);

    if (query.view === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.view === "active") q = q.eq("status", "active");
      else if (query.view === "left") q = q.eq("status", "left");
    }

    const term = query.q?.trim();
    if (term) {
      const like = `%${term.replace(/[,()]/g, " ")}%`;
      q = q.or(
        [
          `name.ilike.${like}`,
          `employee_no.ilike.${like}`,
          `cnic.ilike.${like}`,
          `phone.ilike.${like}`,
        ].join(","),
      );
    }

    // Active first, then by name — a register is read to look somebody up.
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const { data, error, count } = await q
      .order("status", { ascending: true })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return {
      rows: (data ?? []).map((r) => rowToEmployee(r as EmployeeRow)),
      total: count ?? 0,
    };
  },

  async employeeCounts(company): Promise<EmployeeCounts> {
    const { data, error } = await supabase()
      .from(EMPLOYEES)
      .select("status")
      .eq("company", company)
      .is("deleted_at", null)
      .limit(5000);
    if (error) throw error;

    const rows = data ?? [];
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      left: rows.filter((r) => r.status === "left").length,
    };
  },

  /* ---- food ------------------------------------------------------------- */

  async createFood(fields: FoodFields): Promise<FoodExpense> {
    const db = supabase();
    const period = periodOf();

    for (let attempt = 0; attempt < 6; attempt++) {
      // Deleted rows count, as elsewhere: a number already quoted to a café is
      // spent even if the row was binned.
      const { data: highest, error: maxErr } = await db
        .from(FOOD)
        .select("seq")
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();

      const { data, error } = await db
        .from(FOOD)
        .insert({
          id: newId(),
          entry_no: formatFoodNo(period, seq),
          seq,
          period,
          created_at: now,
          updated_at: now,
          ...foodColumns(fields),
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation -> someone took this number; recompute.
        if (error.code !== "23505" || attempt === 5) throw error;
        continue;
      }

      return rowToFood(data as FoodRow);
    }
    throw new Error("Could not assign a food entry number after several attempts");
  },

  async getFood(id) {
    const { data, error } = await supabase().from(FOOD).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToFood(data as FoodRow) : null;
  },

  async updateFood(id, fields: FoodFields): Promise<FoodExpense> {
    const { data, error } = await supabase()
      .from(FOOD)
      .update({ updated_at: new Date().toISOString(), ...foodColumns(fields) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToFood(data as FoodRow);
  },

  async searchFood(query: FoodQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase().from(FOOD).select("*", { count: "exact" });

    if (query.view === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.view === "pending") q = q.eq("status", "pending");
      else if (query.view === "paid") q = q.eq("status", "paid");
    }

    if (query.q?.trim()) {
      // Commas and parentheses would be read as .or() syntax, not as text.
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(
        [
          `entry_no.ilike.%${term}%`,
          `vendor.ilike.%${term}%`,
          `details.ilike.%${term}%`,
          `ordered_for.ilike.%${term}%`,
          `paid_by.ilike.%${term}%`,
          `reference.ilike.%${term}%`,
        ].join(","),
      );
    }

    if (query.from) q = q.gte("date", query.from);
    if (query.to) q = q.lte("date", query.to);

    // Matches the SQLite ordering: by order date, then by number within a day.
    const { data, error, count } = await q
      .order("date", { ascending: false })
      .order("seq", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as FoodRow[]).map(rowToFood), total: count ?? 0 };
  },

  async foodCounts(): Promise<FoodCounts> {
    // Reduced in the app rather than with SUMIFS-in-SQL, for the reason
    // spendRows gives: PostgREST cannot aggregate without a stored function, and
    // that is another migration the operator has to remember to run.
    const { data, error } = await supabase()
      .from(FOOD)
      .select()
      .is("deleted_at", null)
      .limit(5000);
    if (error) throw error;
    return summariseFood((data as FoodRow[]).map(rowToFood));
  },

  async pendingFood(): Promise<FoodExpense[]> {
    const { data, error } = await supabase()
      .from(FOOD)
      .select()
      .is("deleted_at", null)
      .eq("status", "pending")
      .order("date", { ascending: true })
      .order("seq", { ascending: true })
      .limit(2000);
    if (error) throw error;
    return (data as FoodRow[]).map(rowToFood);
  },

  async foodInRange(from: string | null, to: string | null): Promise<FoodExpense[]> {
    let q = supabase().from(FOOD).select().is("deleted_at", null);
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);

    const { data, error } = await q
      .order("date", { ascending: true })
      .order("seq", { ascending: true })
      .limit(5000);
    if (error) throw error;
    return (data as FoodRow[]).map(rowToFood);
  },

  async settleFood(
    ids: string[],
    paidAt: string,
    reference: string | null,
    receipt: { key: string; name: string } | null,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();

    // The status and deleted_at filters make this idempotent: a resubmitted
    // settle form matches nothing rather than stamping today's date over a
    // payment made last week. `.select()` returns only the rows that changed,
    // which is what the caller reports back.
    //
    // `reference` and the receipt are applied only when supplied. PostgREST has
    // no COALESCE in an update, so an absent value is left out of the patch
    // entirely rather than being nulled — matching the SQLite COALESCE and
    // keeping a settle-without-attachment from wiping proof already on file.
    const patch: Record<string, unknown> = {
      status: "paid",
      paid_at: paidAt,
      updated_at: now,
    };
    if (reference) patch.reference = reference;
    if (receipt) {
      patch.receipt_key = receipt.key;
      patch.receipt_name = receipt.name;
      patch.receipt_at = now;
    }

    const { data, error } = await supabase()
      .from(FOOD)
      .update(patch)
      .in("id", ids)
      .eq("status", "pending")
      .is("deleted_at", null)
      .select("id");
    if (error) throw error;
    return (data ?? []).length;
  },

  async attachFoodReceipt(id: string, receipt: { key: string; name: string }) {
    const now = new Date().toISOString();
    const { data, error } = await supabase()
      .from(FOOD)
      .update({
        receipt_key: receipt.key,
        receipt_name: receipt.name,
        receipt_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToFood(data as FoodRow);
  },

  async detachFoodReceipt(id: string) {
    const db = supabase();
    const current = await db.from(FOOD).select("receipt_key").eq("id", id).maybeSingle();
    if (current.error) throw current.error;
    const key = (current.data?.receipt_key as string | null) ?? null;
    if (!key) return { key: null, stillReferenced: false };

    const { error } = await db
      .from(FOOD)
      .update({
        receipt_key: null,
        receipt_name: null,
        receipt_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

    // Counted after the unlink, so this entry cannot count itself.
    const rest = await db
      .from(FOOD)
      .select("id", { count: "exact", head: true })
      .eq("receipt_key", key)
      .is("deleted_at", null);
    if (rest.error) throw rest.error;

    return { key, stillReferenced: (rest.count ?? 0) > 0 };
  },

  async unsettleFood(id: string): Promise<FoodExpense> {
    // The receipt goes with the payment it was proof of. The stored file is left
    // alone — the rest of the settlement may still be pointing at it.
    const { data, error } = await supabase()
      .from(FOOD)
      .update({
        status: "pending",
        paid_at: null,
        receipt_key: null,
        receipt_name: null,
        receipt_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToFood(data as FoodRow);
  },

  async softDeleteFood(id) {
    const { error } = await supabase()
      .from(FOOD)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreFood(id) {
    const { error } = await supabase().from(FOOD).update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  async foodNames() {
    // Newest first, because the most recent spelling of a name wins.
    const { data, error } = await supabase()
      .from(FOOD)
      .select()
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .order("seq", { ascending: false })
      .limit(400);
    if (error) throw error;
    return foodNamesFrom(data as FoodRow[]);
  },

  async foodSpendRows(): Promise<SpendRow[]> {
    const { data, error } = await supabase()
      .from(FOOD)
      .select("status, currency, amount, date")
      .is("deleted_at", null)
      .limit(5000);
    if (error) throw error;

    return (data ?? []).map((r) => ({
      kind: "food" as const,
      // No company: a shared lunch belongs to neither workspace.
      company: null,
      status: String(r.status),
      currency: String(r.currency || "PKR"),
      amount: r.amount == null ? null : Number(r.amount),
      date: String(r.date).slice(0, 10),
    }));
  },

  /* ---- miscellaneous payments -------------------------------------------- */

  async createMisc({ company, fields }: NewMiscPayment): Promise<MiscPayment> {
    const db = supabase();
    const period = periodOf();

    for (let attempt = 0; attempt < 6; attempt++) {
      // Deleted rows count, as elsewhere: a number already written on a receipt
      // is spent even if the row was binned.
      const { data: highest, error: maxErr } = await db
        .from(MISC)
        .select("seq")
        .eq("company", company)
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();

      const { data, error } = await db
        .from(MISC)
        .insert({
          id: newId(),
          payment_no: formatMiscNo(company, period, seq),
          company,
          seq,
          period,
          created_at: now,
          updated_at: now,
          ...miscColumns(fields),
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation -> someone took this number; recompute.
        if (error.code !== "23505" || attempt === 5) throw error;
        continue;
      }

      return rowToMisc(data as MiscRow);
    }
    throw new Error("Could not assign a payment number after several attempts");
  },

  async getMisc(id) {
    const { data, error } = await supabase().from(MISC).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToMisc(data as MiscRow) : null;
  },

  async updateMisc(id, fields: MiscFields): Promise<MiscPayment> {
    const { data, error } = await supabase()
      .from(MISC)
      .update({ updated_at: new Date().toISOString(), ...miscColumns(fields) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToMisc(data as MiscRow);
  },

  async attachMiscProof(id: string, proof: { key: string; name: string }) {
    const db = supabase();
    // Read before the write, so the caller is handed the file it is now
    // responsible for deleting. Nothing else can be pointing at it.
    const { data: current, error: readErr } = await db
      .from(MISC)
      .select("proof_key")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) throw new Error("Payment not found");

    const now = new Date().toISOString();
    const { error } = await db
      .from(MISC)
      .update({ proof_key: proof.key, proof_name: proof.name, proof_at: now, updated_at: now })
      .eq("id", id);
    if (error) throw error;

    return { previousKey: (current.proof_key as string | null) ?? null };
  },

  async detachMiscProof(id: string) {
    const db = supabase();
    const { data: current, error: readErr } = await db
      .from(MISC)
      .select("proof_key")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;

    const key = (current?.proof_key as string | null) ?? null;
    if (!key) return { key: null };

    const { error } = await db
      .from(MISC)
      .update({
        proof_key: null,
        proof_name: null,
        proof_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

    return { key };
  },

  async softDeleteMisc(id) {
    const { error } = await supabase()
      .from(MISC)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreMisc(id) {
    const { error } = await supabase().from(MISC).update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  async searchMisc(query: MiscQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase().from(MISC).select("*", { count: "exact" }).eq("company", query.company);

    if (query.view === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
      if (query.view === "with-proof") q = q.not("proof_key", "is", null);
      else if (query.view === "no-proof") q = q.is("proof_key", null);
    }

    if (query.q?.trim()) {
      // Commas and parentheses would be read as .or() syntax, not as text.
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or([`payment_no.ilike.%${term}%`, `notes.ilike.%${term}%`].join(","));
    }

    if (query.from) q = q.gte("date", query.from);
    if (query.to) q = q.lte("date", query.to);

    // Matches the SQLite ordering: by payment date, then by number within a day.
    const { data, error, count } = await q
      .order("date", { ascending: false })
      .order("seq", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as MiscRow[]).map(rowToMisc), total: count ?? 0 };
  },

  async miscCounts(company: CompanySlug): Promise<MiscCounts> {
    // Reduced in the app rather than with SUM-in-SQL, for the reason spendRows
    // gives: PostgREST cannot aggregate without a stored function, and that is
    // another migration the operator has to remember to run.
    const { data, error } = await supabase()
      .from(MISC)
      .select()
      .eq("company", company)
      .is("deleted_at", null)
      .limit(5000);
    if (error) throw error;
    return summariseMisc((data as MiscRow[]).map(rowToMisc));
  },

  /* ---- expenditure ------------------------------------------------------ */

  async spendRows(company: CompanySlug): Promise<SpendRow[]> {
    const db = supabase();

    // Vouchers are PKR by construction; see the note in the SQLite backend.
    const [vouchers, orders, misc] = await Promise.all([
      db
        .from(TABLE)
        .select("status, amount, voucher_date, created_at")
        .eq("company", company)
        .is("deleted_at", null),
      db
        .from(POS)
        .select("status, currency, total, po_date, created_at")
        .eq("company", company)
        .is("deleted_at", null),
      db
        .from(MISC)
        .select("currency, amount, date, proof_key")
        .eq("company", company)
        .is("deleted_at", null),
    ]);
    if (vouchers.error) throw vouchers.error;
    if (orders.error) throw orders.error;
    if (misc.error) throw misc.error;

    const day = (value: string | null, fallback: string) =>
      (value ?? fallback).slice(0, 10);

    return [
      ...(vouchers.data ?? []).map((v) => ({
        kind: "voucher" as const,
        company,
        status: String(v.status),
        currency: "PKR",
        amount: v.amount == null ? null : Number(v.amount),
        date: day(v.voucher_date as string | null, String(v.created_at)),
      })),
      ...(orders.data ?? []).map((o) => ({
        kind: "po" as const,
        company,
        status: String(o.status),
        currency: String(o.currency || "PKR"),
        amount: o.total == null ? null : Number(o.total),
        date: day(o.po_date as string | null, String(o.created_at)),
      })),
      // `status` carries whether there is a receipt behind the payment, which
      // is the one thing left worth reporting about a row with no lifecycle. See
      // the note in the SQLite backend.
      ...(misc.data ?? []).map((m) => ({
        kind: "misc" as const,
        company,
        status: m.proof_key ? "proof" : "no-proof",
        currency: String(m.currency || "PKR"),
        amount: m.amount == null ? null : Number(m.amount),
        date: String(m.date).slice(0, 10),
      })),
    ];
  },

  /* ---- investor funding -------------------------------------------------- */

  async createTranche(fields: TrancheFields): Promise<Tranche> {
    const db = supabase();

    // UNIQUE(seq) does the real work, as with every other number in the portal:
    // if two requests pick the same sequence one insert fails and we try the
    // next. Deleted rows are counted, so a number already quoted in a statement
    // to the investor is never reissued.
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: highest, error: maxErr } = await db
        .from(TRANCHES)
        .select("seq")
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();

      const { data, error } = await db
        .from(TRANCHES)
        .insert({
          id: newId(),
          tranche_no: formatTrancheNo(seq),
          seq,
          created_at: now,
          updated_at: now,
          ...trancheColumns(fields),
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation -> somebody took this number; recompute.
        if (error.code !== "23505" || attempt === 5) throw error;
        continue;
      }

      return rowToTranche(data as TrancheRow);
    }
    throw new Error("Could not assign a tranche number after several attempts");
  },

  async getTranche(id) {
    const { data, error } = await supabase()
      .from(TRANCHES)
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToTranche(data as TrancheRow) : null;
  },

  async updateTranche(id, fields: TrancheFields): Promise<Tranche> {
    const { data, error } = await supabase()
      .from(TRANCHES)
      .update({ updated_at: new Date().toISOString(), ...trancheColumns(fields) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToTranche(data as TrancheRow);
  },

  async setTrancheClosed(id, closed) {
    const now = new Date().toISOString();
    const { error } = await supabase()
      .from(TRANCHES)
      .update({ closed_at: closed ? now : null, updated_at: now })
      .eq("id", id);
    if (error) throw error;
  },

  async softDeleteTranche(id) {
    const now = new Date().toISOString();
    const { error } = await supabase()
      .from(TRANCHES)
      .update({ deleted_at: now, updated_at: now })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreTranche(id) {
    const { error } = await supabase()
      .from(TRANCHES)
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async fundingLedger(): Promise<Array<{ tranche: Tranche; debits: Debit[] }>> {
    const db = supabase();

    const [tranches, debits] = await Promise.all([
      db
        .from(TRANCHES)
        .select()
        .is("deleted_at", null)
        .order("recv_date", { ascending: false })
        .order("seq", { ascending: false }),
      // Every debit in one request rather than one per bucket: two round trips
      // whatever the number of tranches, and the grouping below costs nothing at
      // this scale.
      db.from(ALLOCATIONS).select("tranche_id, amount, source_kind").limit(20000),
    ]);
    if (tranches.error) throw tranches.error;
    if (debits.error) throw debits.error;

    const byTranche = new Map<string, Debit[]>();
    for (const d of debits.data ?? []) {
      const key = String(d.tranche_id);
      const list = byTranche.get(key) ?? [];
      list.push({
        amount: Number(d.amount) || 0,
        sourceKind: isSourceKind(d.source_kind) ? d.source_kind : "direct",
      });
      byTranche.set(key, list);
    }

    return (tranches.data ?? []).map((row) => ({
      tranche: rowToTranche(row as TrancheRow),
      debits: byTranche.get(String((row as TrancheRow).id)) ?? [],
    }));
  },

  async listAllocations(trancheId): Promise<Allocation[]> {
    const { data, error } = await supabase()
      .from(ALLOCATIONS)
      .select()
      .eq("tranche_id", trancheId)
      .order("source_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => rowToAllocation(r as AllocationRow));
  },

  async allocate(rows: NewAllocation[]): Promise<void> {
    if (rows.length === 0) return;
    const db = supabase();
    const now = new Date().toISOString();

    // The two guards, checked before anything is written.
    //
    // Read-then-write rather than one transaction: PostgREST has no transaction
    // to enrol these in without a stored function, and adding one would be
    // another migration the operator has to remember. The window is between the
    // check and the insert, and the portal has one operator at one desk — the
    // same bargain the sequence allocators above already make. The insert is a
    // single statement, so a split is still all-or-nothing.
    const perTranche = new Map<string, number>();
    const perSource = new Map<string, { requested: number; row: NewAllocation }>();

    for (const r of rows) {
      perTranche.set(r.trancheId, paisa(r.amount) + (perTranche.get(r.trancheId) ?? 0));
      const key = `${r.sourceKind}:${r.sourceId}`;
      const seen = perSource.get(key);
      perSource.set(key, { requested: paisa(r.sourceAmount) + (seen?.requested ?? 0), row: r });
    }

    // Totalled per bucket and per expense first: a split of one voucher across
    // two tranches has to be judged as one act, or each half passes on its own
    // and the pair overdraws.
    for (const [trancheId, requested] of perTranche) {
      const bucket = await db
        .from(TRANCHES)
        .select("tranche_no, recv_amount, recv_currency")
        .eq("id", trancheId)
        .is("deleted_at", null)
        .maybeSingle();
      if (bucket.error) throw bucket.error;
      if (!bucket.data) throw new Error("That tranche no longer exists.");

      const drawn = await db.from(ALLOCATIONS).select("amount").eq("tranche_id", trancheId);
      if (drawn.error) throw drawn.error;

      const total = (drawn.data ?? []).reduce((sum, r) => sum + paisa(Number(r.amount) || 0), 0);
      const remaining = paisa(Number(bucket.data.recv_amount) || 0) - total;
      if (requested > remaining) {
        throw new Error(
          overdrawMessage(
            String(bucket.data.tranche_no),
            String(bucket.data.recv_currency || "PKR"),
            remaining / 100,
            requested / 100,
          ),
        );
      }
    }

    for (const { requested, row } of perSource.values()) {
      // A document with no recorded total has no ceiling to check against —
      // that is the point of letting a blank-amount voucher be attributed on
      // the operator's word.
      if (row.sourceTotal == null) continue;

      const existing = await db
        .from(ALLOCATIONS)
        .select("source_amount")
        .eq("source_kind", row.sourceKind)
        .eq("source_id", row.sourceId);
      if (existing.error) throw existing.error;

      const already = (existing.data ?? []).reduce(
        (sum, r) => sum + paisa(Number(r.source_amount) || 0),
        0,
      );
      if (already + requested > paisa(row.sourceTotal)) {
        throw new Error(
          overAllocateMessage(
            row.sourceRef,
            row.sourceCurrency || "PKR",
            row.sourceTotal,
            already / 100,
            requested / 100,
          ),
        );
      }
    }

    const { error } = await db
      .from(ALLOCATIONS)
      .insert(
        rows.map((r) => ({
          id: newId(),
          created_at: now,
          updated_at: now,
          ...allocationColumns(r),
        })),
      );
    if (error) throw error;
  },

  async updateAllocation(id, amount, sourceAmount, note) {
    const db = supabase();

    const current = await db.from(ALLOCATIONS).select().eq("id", id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) throw new Error("That allocation no longer exists.");
    const row = current.data as AllocationRow;

    const bucket = await db
      .from(TRANCHES)
      .select("tranche_no, recv_amount, recv_currency")
      .eq("id", row.tranche_id)
      .maybeSingle();
    if (bucket.error) throw bucket.error;
    if (!bucket.data) throw new Error("That tranche no longer exists.");

    // Both guards again, with this row's own current figures excluded from the
    // running totals — otherwise correcting a row downwards is refused for
    // exceeding a balance it is itself the reason for.
    const drawn = await db
      .from(ALLOCATIONS)
      .select("amount")
      .eq("tranche_id", row.tranche_id)
      .neq("id", id);
    if (drawn.error) throw drawn.error;

    const total = (drawn.data ?? []).reduce((sum, r) => sum + paisa(Number(r.amount) || 0), 0);
    const remaining = paisa(Number(bucket.data.recv_amount) || 0) - total;
    if (paisa(amount) > remaining) {
      throw new Error(
        overdrawMessage(
          String(bucket.data.tranche_no),
          String(bucket.data.recv_currency || "PKR"),
          remaining / 100,
          amount,
        ),
      );
    }

    if (row.source_total != null) {
      const others = await db
        .from(ALLOCATIONS)
        .select("source_amount")
        .eq("source_kind", row.source_kind)
        .eq("source_id", row.source_id)
        .neq("id", id);
      if (others.error) throw others.error;

      const already = (others.data ?? []).reduce(
        (sum, r) => sum + paisa(Number(r.source_amount) || 0),
        0,
      );
      if (already + paisa(sourceAmount) > paisa(Number(row.source_total))) {
        throw new Error(
          overAllocateMessage(
            row.source_ref ?? "",
            row.source_currency || "PKR",
            Number(row.source_total),
            already / 100,
            sourceAmount,
          ),
        );
      }
    }

    const { error } = await db
      .from(ALLOCATIONS)
      .update({
        amount,
        source_amount: sourceAmount,
        // Kept consistent with the two amounts rather than left at whatever it
        // was: a corrected pair with a stale rate is three numbers that no
        // longer multiply together.
        rate: sourceAmount > 0 ? amount / sourceAmount : 1,
        note: note?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async removeAllocation(id) {
    // Hard delete, unlike everything else in the portal. An allocation carries
    // no number of its own and is nobody's record — it is a statement about
    // where money came from, and an incorrect one should leave no trace.
    const { error } = await supabase().from(ALLOCATIONS).delete().eq("id", id);
    if (error) throw error;
  },

  async releaseSource(sourceKind: SourceKind, sourceId: string): Promise<string[]> {
    const db = supabase();

    // Read the affected tranches first, so the caller can revalidate the pages
    // whose balances are about to change.
    const affected = await db
      .from(ALLOCATIONS)
      .select("tranche_id")
      .eq("source_kind", sourceKind)
      .eq("source_id", sourceId);
    if (affected.error) throw affected.error;

    const { error } = await db
      .from(ALLOCATIONS)
      .delete()
      .eq("source_kind", sourceKind)
      .eq("source_id", sourceId);
    if (error) throw error;

    return [...new Set((affected.data ?? []).map((r) => String(r.tranche_id)))];
  },

  async allocatable(): Promise<AllocatableItem[]> {
    const db = supabase();

    const [vouchers, orders, food, direct, placed, liveTranches] = await Promise.all([
      db
        .from(TABLE)
        .select("id, voucher_no, company, status, recipient_name, description, amount, voucher_date, created_at")
        .is("deleted_at", null)
        .limit(5000),
      // Cancelled orders are excluded: nothing was ever spent on one, so
      // offering it would invite attributing money that never moved. Drafts are
      // offered — a draft that was in fact paid is exactly what this ledger is
      // for catching.
      db
        .from(POS)
        .select("id, po_no, company, status, currency, total, vendor_name, subject, po_date, created_at")
        .is("deleted_at", null)
        .neq("status", "cancelled")
        .limit(5000),
      db
        .from(FOOD)
        .select("id, entry_no, status, currency, amount, vendor, details, date")
        .is("deleted_at", null)
        .limit(5000),
      db
        .from(DIRECT)
        .select("id, entry_no, company, currency, amount, payee, details, date")
        .is("deleted_at", null)
        .limit(5000),
      // Plainly, with no embedded join, and paired with the tranche list below
      // in the app. PostgREST can embed the parent row here, but the shape it
      // returns depends on how it reads the foreign key, and a query whose
      // result shape has to be guessed at is a poor foundation for the one
      // figure this module exists to get right. The SQLite backend joins in SQL;
      // this one assembles in the app, which is the same bargain `spendRows`
      // already makes.
      db.from(ALLOCATIONS).select("source_kind, source_id, source_amount, amount, tranche_id").limit(20000),
      db.from(TRANCHES).select("id, tranche_no").is("deleted_at", null),
    ]);
    if (vouchers.error) throw vouchers.error;
    if (orders.error) throw orders.error;
    if (food.error) throw food.error;
    if (direct.error) throw direct.error;
    if (placed.error) throw placed.error;
    if (liveTranches.error) throw liveTranches.error;

    // Allocations against a deleted tranche are dropped, matching the SQLite
    // backend's inner join: a deleted bucket's debits must not go on making an
    // expense look attributed.
    const trancheNo = new Map(
      (liveTranches.data ?? []).map((t) => [String(t.id), String(t.tranche_no)]),
    );

    const day = (value: unknown, fallback: unknown) =>
      String(value ?? fallback ?? "").slice(0, 10);

    return assembleAllocatable({
      vouchers: (vouchers.data ?? []).map((v) => ({
        id: String(v.id),
        ref: String(v.voucher_no),
        company: String(v.company),
        status: String(v.status),
        recipient_name: (v.recipient_name as string | null) ?? null,
        description: (v.description as string | null) ?? null,
        amount: v.amount as number | string | null,
        date: day(v.voucher_date, v.created_at),
      })),
      orders: (orders.data ?? []).map((o) => ({
        id: String(o.id),
        ref: String(o.po_no),
        company: String(o.company),
        status: String(o.status),
        currency: (o.currency as string | null) ?? null,
        total: o.total as number | string | null,
        vendor_name: (o.vendor_name as string | null) ?? null,
        subject: (o.subject as string | null) ?? null,
        date: day(o.po_date, o.created_at),
      })),
      food: (food.data ?? []).map((f) => ({
        id: String(f.id),
        ref: String(f.entry_no),
        status: String(f.status),
        currency: (f.currency as string | null) ?? null,
        amount: f.amount as number | string | null,
        vendor: (f.vendor as string | null) ?? null,
        details: (f.details as string | null) ?? null,
        date: day(f.date, null),
      })),
      direct: (direct.data ?? []).map((d) => ({
        id: String(d.id),
        ref: String(d.entry_no),
        company: (d.company as string | null) ?? null,
        currency: (d.currency as string | null) ?? null,
        amount: d.amount as number | string | null,
        payee: (d.payee as string | null) ?? null,
        details: (d.details as string | null) ?? null,
        date: day(d.date, null),
      })),
      placed: (placed.data ?? [])
        .filter((p) => trancheNo.has(String(p.tranche_id)))
        .map((p) => ({
          source_kind: String(p.source_kind),
          source_id: String(p.source_id),
          source_amount: p.source_amount as number | string,
          amount: p.amount as number | string,
          tranche_id: String(p.tranche_id),
          tranche_no: trancheNo.get(String(p.tranche_id)) ?? "",
        })),
    });
  },

  async createDirect(fields: DirectFields, allocateTo: string | null): Promise<DirectExpense> {
    const db = supabase();
    const period = periodOf();

    let entry: DirectExpense | null = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: highest, error: maxErr } = await db
        .from(DIRECT)
        .select("seq")
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;
      const now = new Date().toISOString();

      const { data, error } = await db
        .from(DIRECT)
        .insert({
          id: newId(),
          entry_no: formatDirectNo(period, seq),
          seq,
          period,
          created_at: now,
          updated_at: now,
          ...directColumns(fields),
        })
        .select()
        .single();

      if (error) {
        if (error.code !== "23505" || attempt === 5) throw error;
        continue;
      }

      entry = rowToDirect(data as DirectRow);
      break;
    }
    if (!entry) throw new Error("Could not assign a direct entry number after several attempts");

    // The allocation as a second statement, where SQLite does both in one
    // transaction. The entry is the record and the allocation is a statement
    // about it, so if this half fails the entry survives and shows up in the
    // queue to be allocated by hand — which is a recoverable state, unlike a
    // lost expense.
    if (allocateTo) {
      const bucket = await db
        .from(TRANCHES)
        .select("recv_currency")
        .eq("id", allocateTo)
        .is("deleted_at", null)
        .maybeSingle();
      if (bucket.error) throw bucket.error;

      // Skipped on a currency mismatch: there is no rate to convert at, and
      // inventing one is worse than leaving the entry in the queue for somebody
      // to allocate with a rate they chose. The action says which happened.
      if (
        bucket.data &&
        String(bucket.data.recv_currency || "PKR") === (fields.currency || "PKR")
      ) {
        await supabaseStore.allocate([
          {
            trancheId: allocateTo,
            sourceKind: "direct",
            sourceId: entry.id,
            amount: entry.amount,
            sourceAmount: entry.amount,
            sourceTotal: entry.amount,
            sourceCurrency: entry.currency,
            rate: 1,
            sourceRef: entry.entryNo,
            sourceLabel: entry.details || entry.payee,
            sourceCompany: entry.company,
            sourceDate: entry.date,
            note: null,
          },
        ]);
      }
    }

    return entry;
  },

  async getDirect(id) {
    const { data, error } = await supabase().from(DIRECT).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToDirect(data as DirectRow) : null;
  },

  async updateDirect(id, fields: DirectFields): Promise<DirectExpense> {
    const { data, error } = await supabase()
      .from(DIRECT)
      .update({ updated_at: new Date().toISOString(), ...directColumns(fields) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToDirect(data as DirectRow);
  },

  async softDeleteDirect(id) {
    const now = new Date().toISOString();
    const { error } = await supabase()
      .from(DIRECT)
      .update({ deleted_at: now, updated_at: now })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreDirect(id) {
    const { error } = await supabase()
      .from(DIRECT)
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async listDirect(): Promise<DirectExpense[]> {
    const { data, error } = await supabase()
      .from(DIRECT)
      .select()
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw error;
    return (data ?? []).map((r) => rowToDirect(r as DirectRow));
  },

  async directPayees(): Promise<string[]> {
    // Newest first, because the most recent spelling of a name wins.
    const { data, error } = await supabase()
      .from(DIRECT)
      .select()
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error) throw error;
    return directPayeesFrom((data ?? []) as DirectRow[]);
  },

  /* ---- settings -------------------------------------------------------- */

  async getSettings(company): Promise<CompanySettings> {
    const { data, error } = await supabase()
      .from(SETTINGS)
      .select("data")
      .eq("company", company)
      .maybeSingle();
    if (error) throw error;
    return mergeSettings(data?.data ?? null);
  },

  async saveSettings(company, patch) {
    const current = await supabaseStore.getSettings(company);
    const next = mergeSettings({ ...current, ...patch, po: { ...current.po, ...patch.po } });

    const { error } = await supabase()
      .from(SETTINGS)
      .upsert(
        { company, data: next, updated_at: new Date().toISOString() },
        { onConflict: "company" },
      );
    if (error) throw error;
    return next;
  },

  /* ---- notifications ----------------------------------------------------- */

  async createNotification({ company, fields }: NewNotification): Promise<Notification> {
    const db = supabase();
    const period = periodOf();

    // The (company, period, seq) unique index does the real work: if two
    // requests pick the same sequence, one insert fails and we try the next.
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: highest, error: maxErr } = await db
        .from(NOTIFICATIONS)
        .select("seq")
        .eq("company", company)
        .eq("period", period)
        .order("seq", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;

      const seq = (highest?.[0]?.seq ?? 0) + 1;

      const { data, error } = await db
        .from(NOTIFICATIONS)
        .insert({
          id: newId(),
          notif_no: formatNotifNo(company, period, seq),
          company,
          seq,
          period,
          headline: fields.headline,
          body: fields.body,
          tag: fields.tag,
          sender: fields.sender,
          notify_date: fields.notifyDate || null,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!error) return rowToNotification(data as NotificationRow);
      // 23505 = unique_violation → someone took this number; recompute and retry.
      if (error.code !== "23505" || attempt === 5) throw error;
    }
    throw new Error("Could not assign a notification number after several attempts");
  },

  async getNotification(id) {
    const { data, error } = await supabase().from(NOTIFICATIONS).select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToNotification(data as NotificationRow) : null;
  },

  async attachNotificationImage(id, pngKey) {
    const { error } = await supabase()
      .from(NOTIFICATIONS)
      .update({ png_key: pngKey, png_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async attachNotificationPdf(id, pdfKey) {
    const { error } = await supabase()
      .from(NOTIFICATIONS)
      .update({ pdf_key: pdfKey, pdf_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async softDeleteNotification(id) {
    const { error } = await supabase()
      .from(NOTIFICATIONS)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw error;
  },

  async restoreNotification(id) {
    const { error } = await supabase()
      .from(NOTIFICATIONS)
      .update({ deleted_at: null })
      .eq("id", id);
    if (error) throw error;
  },

  async searchNotifications(query: NotificationQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let q = supabase()
      .from(NOTIFICATIONS)
      .select("*", { count: "exact" })
      .eq("company", query.company);

    // "deleted" is the recycle-bin view; every other view hides deleted rows.
    if (query.status === "deleted") {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
    }
    if (query.tag && query.tag !== "all") q = q.eq("tag", query.tag);
    if (query.q?.trim()) {
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(
        [
          `notif_no.ilike.%${term}%`,
          `headline.ilike.%${term}%`,
          `body.ilike.%${term}%`,
          `sender.ilike.%${term}%`,
        ].join(","),
      );
    }
    if (query.from) q = q.gte("created_at", `${query.from}T00:00:00.000Z`);
    if (query.to) q = q.lte("created_at", `${query.to}T23:59:59.999Z`);

    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { rows: (data as NotificationRow[]).map(rowToNotification), total: count ?? 0 };
  },

  async notificationCounts(company: CompanySlug): Promise<NotificationCounts> {
    const { count, error } = await supabase()
      .from(NOTIFICATIONS)
      .select("id", { count: "exact", head: true })
      .eq("company", company)
      .is("deleted_at", null);
    if (error) throw error;
    return { total: count ?? 0 };
  },
};
