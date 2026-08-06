"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { CURRENCIES } from "../money";
import { deleteFile, putFile, storageKeys } from "../storage";
import { readUpload } from "../uploads";
import { readPoDoc, text } from "./parse";
import type { PoStatus } from "./types";

/**
 * Server actions for purchase orders.
 *
 * The editor posts the whole document as one JSON field rather than as fifty
 * named inputs. A PO has a variable number of line items, and reconstructing a
 * repeating group out of FormData is exactly the kind of index-juggling that
 * silently drops a row; one JSON payload validated here cannot.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Every path a purchase order appears on. */
function revalidatePo(company: string, id?: string) {
  revalidatePath(`/${company}/po`);
  revalidatePath(`/${company}/po/history`);
  if (id) revalidatePath(`/${company}/po/${id}`);
}

/**
 * A deleted order is in the recycle bin, and nothing should act on it.
 *
 * The buttons are already hidden, but a tab left open before the delete can
 * still reach these actions — and "closing" a deleted order, or filing an
 * invoice against one, would leave the record saying something untrue.
 */
function requireLive(po: { deletedAt: string | null; poNo: string }) {
  if (po.deletedAt) {
    throw new Error(`${po.poNo} is deleted. Restore it before changing it.`);
  }
}

/* -------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------------*/

export interface SavedPo {
  id: string;
  poNo: string;
  company: string;
}

/**
 * Creates the purchase order, which assigns its permanent number.
 *
 * The PDF is not produced here — it is rendered in the operator's browser and
 * posted back to /api/po/[id]/pdf. This returns the new id so the caller can
 * drive that second step, exactly as vouchers do.
 */
export async function createPo(
  companySlug: string,
  payload: { doc: unknown; internalNote?: string; issue?: boolean },
): Promise<SavedPo> {
  await requireAuth();
  const company = requireCompany(companySlug);

  const db = await store();
  const po = await db.createPo({
    company: company.slug as CompanySlug,
    internalNote: text(payload.internalNote, 400, "Internal note"),
    doc: readPoDoc(payload.doc),
  });

  // Issuing here rather than as a second trip means the PDF the browser renders
  // next carries no DRAFT watermark — the operator gets a sendable document
  // from one press.
  if (payload.issue) await db.setPoStatus(po.id, "issued");

  revalidatePo(company.slug);
  return { id: po.id, poNo: po.poNo, company: company.slug };
}

/** Saves an edit. An issued order stays editable; the PDF is re-rendered after. */
export async function savePo(
  id: string,
  payload: { doc: unknown; internalNote?: string },
): Promise<SavedPo> {
  await requireAuth();
  const db = await store();
  const existing = await db.getPo(id);
  if (!existing) throw new Error("Purchase order not found");
  requireLive(existing);

  const po = await db.updatePo(id, readPoDoc(payload.doc), text(payload.internalNote, 400, "Internal note"));

  revalidatePo(po.company, po.id);
  return { id: po.id, poNo: po.poNo, company: po.company };
}

const ALLOWED: PoStatus[] = ["draft", "issued", "closed", "cancelled"];

/**
 * Moves an order through its lifecycle.
 *
 * Any transition is permitted, including backwards. A one-operator tool has no
 * one to appeal to when a status is set by mistake, so being able to put it
 * back is worth more than a state machine that refuses.
 */
export async function setPoStatus(id: string, status: PoStatus) {
  await requireAuth();
  if (!ALLOWED.includes(status)) throw new Error(`Unknown status: ${status}`);

  const db = await store();
  const po = await db.getPo(id);
  if (!po) throw new Error("Purchase order not found");
  requireLive(po);

  await db.setPoStatus(id, status);
  revalidatePo(po.company, po.id);
}

/**
 * Files the vendor's invoice, which closes the order.
 *
 * For the equipment purchases this is used for, the invoice is the delivery
 * document — it arrives with the item — so there is no separate goods-receipt
 * step to record. Attaching it and closing the order are therefore one action,
 * not two things to remember. An order that was paid in advance and hasn't
 * arrived can be reopened from its page.
 */
export async function uploadPoInvoice(poId: string, form: FormData) {
  await requireAuth();
  const { file, ext } = readUpload(form);

  const db = await store();
  const po = await db.getPo(poId);
  if (!po) throw new Error("Purchase order not found");
  requireLive(po);

  const key = storageKeys.poInvoice(po.company, po.poNo, ext);
  await putFile(
    key,
    Buffer.from(await file.arrayBuffer()),
    file.type || "application/octet-stream",
  );
  await db.attachPoInvoice(po.id, key, file.name);

  revalidatePo(po.company, po.id);
}

/** Detaches an invoice attached in error, which reopens the order. */
export async function removePoInvoice(poId: string) {
  await requireAuth();
  const db = await store();
  const po = await db.getPo(poId);
  if (!po) throw new Error("Purchase order not found");
  requireLive(po);

  if (po.invoiceKey) await deleteFile(po.invoiceKey);
  await db.removePoInvoice(po.id);

  revalidatePo(po.company, po.id);
}

/**
 * Deletes a purchase order. The row is kept, so the number stays spent and can
 * never be issued to a different order, and the delete can be undone in full.
 */
export async function deletePo(id: string) {
  await requireAuth();
  const db = await store();
  const po = await db.getPo(id);
  if (!po) throw new Error("Purchase order not found");

  await db.softDeletePo(id);
  revalidatePo(po.company, po.id);
  redirect(`/${po.company}/po/history?deleted=${encodeURIComponent(po.poNo)}`);
}

export async function restorePo(id: string) {
  await requireAuth();
  const db = await store();
  const po = await db.getPo(id);
  if (!po) throw new Error("Purchase order not found");

  await db.restorePo(id);
  revalidatePo(po.company, po.id);
  redirect(`/${po.company}/po/${po.id}`);
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------*/

export async function savePoSettings(companySlug: string, form: FormData) {
  await requireAuth();
  const company = requireCompany(companySlug);
  const db = await store();

  const currency = String(form.get("currency") ?? "").toUpperCase();

  await db.saveSettings(company.slug as CompanySlug, {
    po: {
      currency: currency in CURRENCIES ? currency : "PKR",
      taxLabel: text(form.get("taxLabel"), 40, "Tax label") || "Tax",
      taxRate: Math.min(100, Math.max(0, Number(form.get("taxRate")) || 0)),
      showTax: form.get("showTax") === "1",
      paymentTerms: text(form.get("paymentTerms"), 300, "Payment terms"),
      deliveryAddress: text(form.get("deliveryAddress"), 600, "Delivery address"),
      terms: text(form.get("terms"), 8000, "Terms and conditions"),
      approvedBy: text(form.get("approvedBy"), 160, "Approved by"),
    },
  });

  revalidatePath(`/${company.slug}/settings`);
  revalidatePath(`/${company.slug}/po/new`);
  redirect(`/${company.slug}/settings?saved=1`);
}
