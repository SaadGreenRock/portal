"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { store } from "../db";
import { todayIso } from "../format";
import { text } from "../po/parse";
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
  );

  revalidateFood(id);
  redirect(`/food/${id}?settled=1`);
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
  const settled = await db.settleFood(
    ids,
    isoDate(form.get("paidAt")) || todayIso(),
    text(form.get("reference"), 120, "Reference") || null,
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
