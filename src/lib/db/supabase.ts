import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AllotFields,
  AssetCounts,
  AssetFields,
  AssetHolding,
  AssetQuery,
  EmployeeProfile,
  HoldingQuery,
  ReturnFields,
} from "../assets/types";
import type { CompanySlug } from "../companies";
import {
  summariseFood,
  type FoodCounts,
  type FoodExpense,
  type FoodFields,
  type FoodQuery,
} from "../food/types";
import { todayIso } from "../format";
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
import type { HistoryQuery, Signatory, Voucher } from "../types";
import type { NewAsset, NewPurchaseOrder, NewRfq, NewVoucher, Store } from "./types";
import {
  denormalize,
  denormalizePo,
  denormalizeRfq,
  employeeKey,
  employeeProfilesFrom,
  foodColumns,
  foodNamesFrom,
  formatAssetNo,
  formatFoodNo,
  formatPoNo,
  formatRfqNo,
  formatVoucherNo,
  holderColumns,
  IN_STOCK_COLUMNS,
  newId,
  periodOf,
  poStatusPatch,
  rfqStatusPatch,
  rowToAsset,
  rowToFood,
  rowToHolding,
  rowToHoldingWithAsset,
  rowToPo,
  rowToRfq,
  rowToVoucher,
  statusChangesDocument,
  vendorProfilesFrom,
  type AssetRow,
  type FoodRow,
  type HoldingRow,
  type HoldingWithAssetRow,
  type PoRow,
  type RfqRow,
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
          ...holderColumns(allot),
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation -> someone took this number; recompute.
        if (error.code !== "23505" || attempt === 5) throw error;
        continue;
      }

      // The asset owns the number, so it goes in first; the holding references it.
      const { error: holdErr } = await db.from(HOLDINGS).insert({
        id: newId(),
        asset_id: id,
        company,
        employee_name: allot.employeeName,
        employee_no: allot.employeeNo,
        allotted_on: allot.allottedOn || null,
        returned_on: null,
        condition: "good",
        note: "",
        created_at: now,
        updated_at: now,
      });
      if (holdErr) throw holdErr;

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
        .update({
          employee_name: holder.employeeName,
          employee_no: holder.employeeNo,
          allotted_on: holder.allottedOn || null,
          updated_at: now,
        })
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
      employee_name: allot.employeeName,
      employee_no: allot.employeeNo,
      allotted_on: allot.allottedOn || null,
      returned_on: null,
      condition: "good",
      note: "",
      created_at: now,
      updated_at: now,
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

  async listEmployees(company: CompanySlug): Promise<EmployeeProfile[]> {
    // Capped like the vendor list; see the note in the SQLite backend.
    const { data, error } = await supabase()
      .from(HOLDINGS)
      .select("employee_name, employee_no, returned_on, created_at")
      .eq("company", company)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return employeeProfilesFrom(
      (data ?? []) as Array<{
        employee_name: string;
        employee_no: string;
        returned_on: string | null;
        created_at: string;
      }>,
    );
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

  /* ---- expenditure ------------------------------------------------------ */

  async spendRows(company: CompanySlug): Promise<SpendRow[]> {
    const db = supabase();

    // Vouchers are PKR by construction; see the note in the SQLite backend.
    const [vouchers, orders] = await Promise.all([
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
    ]);
    if (vouchers.error) throw vouchers.error;
    if (orders.error) throw orders.error;

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
    ];
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
};
