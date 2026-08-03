"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { CURRENCIES } from "../money";
import { text } from "../po/parse";
import { readRfqDoc } from "./parse";
import type { RfqStatus } from "./types";

/**
 * Server actions for requests for quotation.
 *
 * Same shape as the purchase order actions, and for the same reason: the editor
 * posts the whole document as one JSON payload rather than as named form fields,
 * because rebuilding a repeating group out of FormData is how you silently drop
 * a row.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Every path a request appears on. */
function revalidateRfq(company: string, id?: string) {
  revalidatePath(`/${company}`);
  revalidatePath(`/${company}/rfq`);
  revalidatePath(`/${company}/rfq/history`);
  if (id) revalidatePath(`/${company}/rfq/${id}`);
}

/**
 * A deleted request is in the recycle bin, and nothing should act on it.
 *
 * The buttons are hidden, but a tab left open before the delete can still reach
 * these actions.
 */
function requireLive(rfq: { deletedAt: string | null; rfqNo: string }) {
  if (rfq.deletedAt) {
    throw new Error(`${rfq.rfqNo} is deleted. Restore it before changing it.`);
  }
}

export interface SavedRfq {
  id: string;
  rfqNo: string;
  company: string;
}

/**
 * Creates the request, which assigns its permanent number.
 *
 * The PDF is not produced here — it is rendered in the operator's browser and
 * posted back to /api/rfq/[id]/pdf, exactly as the other documents are.
 */
export async function createRfq(
  companySlug: string,
  payload: { doc: unknown; internalNote?: string; send?: boolean },
): Promise<SavedRfq> {
  await requireAuth();
  const company = requireCompany(companySlug);

  const db = await store();
  const rfq = await db.createRfq({
    company: company.slug as CompanySlug,
    internalNote: text(payload.internalNote, 400, "Internal note"),
    doc: readRfqDoc(payload.doc),
  });

  // Marking it sent here rather than as a second trip means the PDF the browser
  // renders next carries no DRAFT watermark, so it is ready to forward.
  if (payload.send) await db.setRfqStatus(rfq.id, "sent");

  revalidateRfq(company.slug);
  return { id: rfq.id, rfqNo: rfq.rfqNo, company: company.slug };
}

/** Saves an edit. The PDF is re-rendered by the caller afterwards. */
export async function saveRfq(
  id: string,
  payload: { doc: unknown; internalNote?: string },
): Promise<SavedRfq> {
  await requireAuth();
  const db = await store();
  const existing = await db.getRfq(id);
  if (!existing) throw new Error("Request for quotation not found");
  requireLive(existing);

  const rfq = await db.updateRfq(
    id,
    readRfqDoc(payload.doc),
    text(payload.internalNote, 400, "Internal note"),
  );

  revalidateRfq(rfq.company, rfq.id);
  return { id: rfq.id, rfqNo: rfq.rfqNo, company: rfq.company };
}

const ALLOWED: RfqStatus[] = ["draft", "sent", "closed", "cancelled"];

/**
 * Moves a request through its lifecycle. Any transition, including backwards —
 * a one-operator tool has nobody to appeal to when a status is set by mistake.
 */
export async function setRfqStatus(id: string, status: RfqStatus) {
  await requireAuth();
  if (!ALLOWED.includes(status)) throw new Error(`Unknown status: ${status}`);

  const db = await store();
  const rfq = await db.getRfq(id);
  if (!rfq) throw new Error("Request for quotation not found");
  requireLive(rfq);

  await db.setRfqStatus(id, status);
  revalidateRfq(rfq.company, rfq.id);
}

/**
 * Deletes a request. The row is kept, so the number stays spent and can never be
 * issued to a different request, and the delete can be undone in full.
 */
export async function deleteRfq(id: string) {
  await requireAuth();
  const db = await store();
  const rfq = await db.getRfq(id);
  if (!rfq) throw new Error("Request for quotation not found");

  await db.softDeleteRfq(id);
  revalidateRfq(rfq.company, rfq.id);
  redirect(`/${rfq.company}/rfq/history?deleted=${encodeURIComponent(rfq.rfqNo)}`);
}

export async function restoreRfq(id: string) {
  await requireAuth();
  const db = await store();
  const rfq = await db.getRfq(id);
  if (!rfq) throw new Error("Request for quotation not found");

  await db.restoreRfq(id);
  revalidateRfq(rfq.company, rfq.id);
  redirect(`/${rfq.company}/rfq/${rfq.id}`);
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------*/

export async function saveRfqSettings(companySlug: string, form: FormData) {
  await requireAuth();
  const company = requireCompany(companySlug);
  const db = await store();

  const currency = String(form.get("currency") ?? "").toUpperCase();

  await db.saveSettings(company.slug as CompanySlug, {
    rfq: {
      currency: currency in CURRENCIES ? currency : "PKR",
      replyWithinDays: Math.min(365, Math.max(0, Number(form.get("replyWithinDays")) || 0)),
      deliveryAddress: text(form.get("deliveryAddress"), 600, "Delivery location"),
      contactName: text(form.get("contactName"), 160, "Contact name"),
      contactEmail: text(form.get("contactEmail"), 160, "Contact email"),
      contactPhone: text(form.get("contactPhone"), 60, "Contact phone"),
      terms: text(form.get("terms"), 8000, "Conditions of quoting"),
      preparedBy: text(form.get("preparedBy"), 160, "Requested by"),
    },
  });

  revalidatePath(`/${company.slug}/settings`);
  revalidatePath(`/${company.slug}/rfq/new`);
  redirect(`/${company.slug}/settings?saved=rfq`);
}
