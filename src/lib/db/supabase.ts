import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CompanySlug } from "../companies";
import { OPEN_STATUSES, type PoCounts, type PoDoc, type PoQuery, type PoStatus, type PurchaseOrder } from "../po/types";
import { mergeSettings, type CompanySettings } from "../settings";
import type { HistoryQuery, Signatory, Voucher } from "../types";
import type { NewPurchaseOrder, NewVoucher, Store } from "./types";
import {
  denormalize,
  denormalizePo,
  formatPoNo,
  formatVoucherNo,
  newId,
  periodOf,
  poStatusPatch,
  rowToPo,
  rowToVoucher,
  vendorProfilesFrom,
  type PoRow,
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
const SETTINGS = "company_settings";

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
    const { data, error: readErr } = await db.from(POS).select("status").eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error("Purchase order not found");

    const now = new Date().toISOString();
    // A cancelled order that turns out to have been delivered anyway keeps its
    // status: reviving it is a decision for the operator, not a side effect of
    // filing a document.
    const closing = data.status !== "cancelled";

    const { error } = await db
      .from(POS)
      .update({
        invoice_key: invoiceKey,
        invoice_name: invoiceName,
        invoice_at: now,
        updated_at: now,
        ...(closing ? { status: "closed", closed_at: now } : {}),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async removePoInvoice(id) {
    const db = supabase();
    const { data, error: readErr } = await db.from(POS).select("status").eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error("Purchase order not found");

    const now = new Date().toISOString();
    const reopening = data.status === "closed";

    const { error } = await db
      .from(POS)
      .update({
        invoice_key: null,
        invoice_name: null,
        invoice_at: null,
        updated_at: now,
        ...(reopening ? { status: "issued", closed_at: null } : {}),
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
      .order("po_date", { ascending: false })
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
