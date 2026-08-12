"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { store } from "../db";
import { todayIso } from "../format";
import { text } from "../po/parse";
import { deleteFile, putFile, storageKeys } from "../storage";
import { readUpload } from "../uploads";
import { isFoodStatus, isPaymentType, type FoodExpense, type FoodFields } from "./types";

/**
 * Server actions for the food log.
 *
 * Plain FormData, like the asset register and unlike the three document modules.
 * Those post whole documents with repeating line-item groups, which FormData
 * cannot rebuild without silently dropping a row; a food entry is a dozen flat
 * fields, so the browser needs no JavaScript to submit one — including the
 * settle form, whose checkboxes come back through `getAll`.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/**
 * Every path a food entry or its totals appear on.
 *
 * `/` and `/spend` are in the list because both carry food figures — the landing
 * card and the expenditure report. Leaving them out is how a settled café tab
 * goes on reading as outstanding on the front page.
 */
function revalidateFood(id?: string) {
  revalidatePath("/");
  revalidatePath("/spend");
  revalidatePath("/food");
  revalidatePath("/food/new");
  revalidatePath("/food/outstanding");
  revalidatePath("/food/report");
  if (id) revalidatePath(`/food/${id}`);
}

/** yyyy-mm-dd, or "" — anything else is not a date a date column can hold. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/**
 * The amount, as a positive number.
 *
 * Clamped rather than refused, unlike the text fields: a nonsense figure pasted
 * into a number box is a hostile payload rather than lost work. Zero is rejected
 * by the caller — an expense of nothing is a typo, not a record.
 */
function amountOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100) / 100, 1e12);
}

/**
 * `text` refuses over-long input rather than truncating it, which is why it is
 * borrowed from the purchase order parser: quietly halving a vendor's name gives
 * nobody a way to notice.
 */
function readFood(form: FormData): FoodFields {
  const paymentTypeRaw = form.get("paymentType");
  const paymentType = isPaymentType(paymentTypeRaw) ? paymentTypeRaw : "deferred";
  const statusRaw = form.get("status");
  const status = isFoodStatus(statusRaw) ? statusRaw : "pending";

  const date = isoDate(form.get("date"));
  if (!date) throw new Error("Enter the date the food was ordered.");

  const vendor = text(form.get("vendor"), 200, "Vendor");
  if (!vendor) throw new Error("Enter who supplied the food.");

  const details = text(form.get("details"), 500, "Order details");
  if (!details) throw new Error("Enter what was ordered.");

  const amount = amountOf(form.get("amount"));
  if (amount <= 0) throw new Error("Enter what it cost.");

  const paidBy = text(form.get("paidBy"), 160, "Paid by");
  // Without a name there is nobody to reimburse, and the outstanding screen
  // would show a debt owed to no one.
  if (paymentType === "employee-paid" && !paidBy) {
    throw new Error("Enter who paid out of pocket.");
  }

  return {
    date,
    orderedFor: text(form.get("orderedFor"), 160, "Ordered for"),
    vendor,
    details,
    amount,
    currency: "PKR",
    paymentType,
    // Normalised again in foodColumns, but doing it here keeps the object that
    // the rest of this file reasons about honest.
    paidBy: paymentType === "employee-paid" ? paidBy : null,
    status,
    paidAt: status === "paid" ? isoDate(form.get("paidAt")) || null : null,
    reference: text(form.get("reference"), 120, "Reference") || null,
    notes: text(form.get("notes"), 1000, "Notes") || null,
  };
}

/**
 * A deleted entry is in the recycle bin, and nothing should act on it.
 *
 * The buttons are hidden, but a tab left open before the delete can still reach
 * these actions.
 */
function requireLive(entry: Pick<FoodExpense, "deletedAt" | "entryNo">) {
  if (entry.deletedAt) {
    throw new Error(`${entry.entryNo} is deleted. Restore it before changing it.`);
  }
}

export async function createFood(form: FormData) {
  await requireAuth();
  const db = await store();
  const entry = await db.createFood(readFood(form));

  revalidateFood();
  redirect(`/food/${entry.id}?created=1`);
}

export async function saveFood(id: string, form: FormData) {
  await requireAuth();
  const db = await store();
  const existing = await db.getFood(id);
  if (!existing) throw new Error("Food entry not found");
  requireLive(existing);

  await db.updateFood(id, readFood(form));

  revalidateFood(id);
  redirect(`/food/${id}?saved=1`);
}

/**
 * Files the receipt, if one was chosen, and returns what to record against the
 * entries. Returns null when the field was left empty, which is the normal case
 * for a payment whose paperwork arrives later.
 *
 * The settlement id is fresh per call, so two payments to the same café never
 * write to the same key and a re-settle cannot overwrite last month's proof.
 */
async function fileReceipt(form: FormData): Promise<{ key: string; name: string } | null> {
  const chosen = form.get("receipt");
  if (!(chosen instanceof File) || chosen.size === 0) return null;

  const { file, ext } = readUpload(form, "receipt");
  const key = storageKeys.foodReceipt(randomUUID(), ext);
  await putFile(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  return { key, name: file.name };
}

/** Squares up a single entry, from its own record screen. */
export async function markFoodPaid(id: string, form: FormData) {
  await requireAuth();
  const db = await store();
  const existing = await db.getFood(id);
  if (!existing) throw new Error("Food entry not found");
  requireLive(existing);

  await db.settleFood(
    [id],
    isoDate(form.get("paidAt")) || todayIso(),
    text(form.get("reference"), 120, "Reference") || null,
    await fileReceipt(form),
  );

  revalidateFood(id);
  redirect(`/food/${id}?settled=1`);
}

/**
 * Files proof against an entry that is already settled — the paperwork that
 * turned up after the payment, and every entry imported from the spreadsheet,
 * which recorded no documents at all.
 */
export async function attachFoodReceipt(id: string, form: FormData) {
  await requireAuth();
  const db = await store();
  const existing = await db.getFood(id);
  if (!existing) throw new Error("Food entry not found");
  requireLive(existing);

  const receipt = await fileReceipt(form);
  if (!receipt) throw new Error("Choose a receipt to attach.");

  // Unlink the old one first, so the file it pointed at can be cleaned up if
  // nothing else was using it. Replacing without this leaves an orphan behind.
  const previous = await db.detachFoodReceipt(id);
  if (previous.key && !previous.stillReferenced) await deleteFile(previous.key);

  await db.attachFoodReceipt(id, receipt);

  revalidateFood(id);
  redirect(`/food/${id}?filed=1`);
}

/**
 * Takes the receipt off an entry.
 *
 * The stored file goes only when no other entry still points at it. One cheque
 * clears a whole tab, so a dozen entries can share one document, and deleting it
 * on the strength of one of them would blank the proof on the other eleven.
 */
export async function removeFoodReceipt(id: string) {
  await requireAuth();
  const db = await store();
  const existing = await db.getFood(id);
  if (!existing) throw new Error("Food entry not found");
  requireLive(existing);

  const { key, stillReferenced } = await db.detachFoodReceipt(id);
  if (key && !stillReferenced) await deleteFile(key);

  revalidateFood(id);
  redirect(`/food/${id}?unfiled=1`);
}

/** Puts a settled entry back to pending — the undo for a mistaken settle. */
export async function markFoodPending(id: string) {
  await requireAuth();
  const db = await store();
  const existing = await db.getFood(id);
  if (!existing) throw new Error("Food entry not found");
  requireLive(existing);

  await db.unsettleFood(id);

  revalidateFood(id);
  redirect(`/food/${id}?reopened=1`);
}

/**
 * Settles everything ticked on the outstanding screen in one go.
 *
 * The whole reason this beats the spreadsheet: a café's tab is a dozen separate
 * orders, and squaring it up is one payment. `getAll` returns every ticked
 * checkbox, and the store's own `status = 'pending'` filter means a resubmitted
 * form settles nothing twice.
 */
export async function settleSelected(form: FormData) {
  await requireAuth();

  const ids = form
    .getAll("id")
    .map((v) => String(v))
    .filter(Boolean);
  if (ids.length === 0) throw new Error("Tick at least one entry to settle.");

  const db = await store();
  // Filed once and shared by every entry in the payment — one cheque, one
  // document. Uploaded before the update so a storage failure means nothing was
  // marked paid, rather than a settlement with proof that never arrived.
  const receipt = await fileReceipt(form);
  const settled = await db.settleFood(
    ids,
    isoDate(form.get("paidAt")) || todayIso(),
    text(form.get("reference"), 120, "Reference") || null,
    receipt,
  );

  revalidateFood();
  redirect(`/food/outstanding?settled=${settled}`);
}

/**
 * Deletes an entry. The row is kept, so the number stays spent and the figures
 * for a month that has already been reported on stay reconstructable.
 */
export async function deleteFood(id: string) {
  await requireAuth();
  const db = await store();
  const entry = await db.getFood(id);
  if (!entry) throw new Error("Food entry not found");

  await db.softDeleteFood(id);
  revalidateFood(id);
  redirect(`/food?deleted=${encodeURIComponent(entry.entryNo)}`);
}

export async function restoreFood(id: string) {
  await requireAuth();
  const db = await store();
  const entry = await db.getFood(id);
  if (!entry) throw new Error("Food entry not found");

  await db.restoreFood(id);
  revalidateFood(id);
  redirect(`/food/${id}`);
}
