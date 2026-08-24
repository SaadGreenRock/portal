"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { currency as currencyOf } from "../money";
import { text } from "../po/parse";
import { deleteFile, putFile, storageKeys } from "../storage";
import { readUpload } from "../uploads";
import type { MiscFields, MiscPayment } from "./types";

/**
 * Server actions for miscellaneous payments.
 *
 * Plain FormData, like the food log and the asset register and unlike the three
 * document modules. Those post whole documents with repeating line-item groups,
 * which FormData cannot rebuild without silently dropping a row; a payment is
 * four flat fields, so the browser needs no JavaScript to submit one.
 *
 * The proof is uploaded by its own action rather than as part of a save. Two
 * reasons, and the second is the one that matters: a receipt often arrives days
 * after the payment, so attaching has to work on a row that already exists; and
 * an ordinary Save carries no file, so if it wrote the proof columns it would
 * blank a receipt filed last week every time somebody fixed a typo in the note.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/**
 * Every path a payment or its totals appear on.
 *
 * `/spend` and `/spend/report` are in the list because both carry these
 * figures. Leaving them out is how a payment logged this morning goes on being
 * absent from the expenditure total until something else happens to revalidate
 * it — which is the failure this module exists to fix, arriving by a different
 * route.
 */
function revalidateMisc(company: CompanySlug, id?: string) {
  revalidatePath("/spend");
  revalidatePath("/spend/report");
  revalidatePath(`/${company}`);
  revalidatePath(`/${company}/misc`);
  revalidatePath(`/${company}/misc/new`);
  if (id) revalidatePath(`/${company}/misc/${id}`);
}

/** yyyy-mm-dd, or "" — anything else is not a date a date column can hold. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/**
 * The amount, as a positive number.
 *
 * Clamped rather than refused, the same way the food log treats it: a nonsense
 * figure pasted into a number box is a hostile payload rather than lost work.
 * Zero is rejected by the caller — a payment of nothing is a typo, not a record.
 */
function amountOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100) / 100, 1e12);
}

/**
 * `text` refuses over-long input rather than truncating it, which is why it is
 * borrowed from the purchase order parser: quietly halving the one description
 * this record has gives nobody a way to notice.
 */
function readMisc(form: FormData): MiscFields {
  const date = isoDate(form.get("date"));
  if (!date) throw new Error("Enter the date the money went out.");

  const amount = amountOf(form.get("amount"));
  if (amount <= 0) throw new Error("Enter how much was paid.");

  // The only description the record has, so it is required where a food entry's
  // notes are optional — that entry still has a vendor and an order to identify
  // it, and this one has nothing else at all.
  const notes = text(form.get("notes"), 1000, "Notes");
  if (!notes) throw new Error("Say what the payment was for — it is the only record of it.");

  // An unknown code would store a figure in a currency nothing can format, and
  // the select only ever offers real ones, so this catches a hand-made post.
  const currency = currencyOf(text(form.get("currency"), 8, "Currency")).code;

  return { date, amount, currency, notes };
}

/**
 * A deleted payment is in the recycle bin, and nothing should act on it.
 *
 * The buttons are hidden, but a tab left open before the delete can still reach
 * these actions.
 */
function requireLive(payment: Pick<MiscPayment, "deletedAt" | "paymentNo">) {
  if (payment.deletedAt) {
    throw new Error(`${payment.paymentNo} is deleted. Restore it before changing it.`);
  }
}

/** Resolves the payment and guards the workspace it is being reached through. */
async function load(company: CompanySlug, id: string): Promise<MiscPayment> {
  const db = await store();
  const payment = await db.getMisc(id);
  if (!payment) throw new Error("Payment not found");
  // A payment belongs to one company's totals, so reaching it through the other
  // workspace's URL must not work — otherwise a Green Rock receipt could be
  // removed from a Sportech screen and the audit trail would name the wrong
  // workspace.
  if (payment.company !== company) throw new Error("Payment not found");
  return payment;
}

export async function createMisc(company: CompanySlug, form: FormData) {
  await requireAuth();
  requireCompany(company);

  const db = await store();
  const fields = readMisc(form);
  // Both the typed fields and the chosen file are checked before anything is
  // written, so a rejected receipt costs the operator a corrected upload rather
  // than a payment already logged behind an error page. See `takeProof`.
  const upload = takeProof(form);

  const payment = await db.createMisc({ company, fields });

  // Filed straight away when one was chosen, so the commonest case — a receipt
  // in hand while typing — is one screen rather than two. The write itself has
  // to come after the insert, because the key is named for the payment number
  // the insert assigns; what could not wait was the validation above.
  if (upload) {
    const proof = await storeProof(upload, company, payment.paymentNo);
    await db.attachMiscProof(payment.id, proof);
  }

  revalidateMisc(company);
  redirect(`/${company}/misc/${payment.id}?created=1`);
}

export async function saveMisc(company: CompanySlug, id: string, form: FormData) {
  await requireAuth();
  const existing = await load(company, id);
  requireLive(existing);

  const db = await store();
  await db.updateMisc(id, readMisc(form));

  revalidateMisc(company, id);
  redirect(`/${company}/misc/${id}?saved=1`);
}

/**
 * The chosen receipt, checked but not yet stored. Null when the field was left
 * empty — an ordinary answer here rather than an oversight, see the note at the
 * top of `misc/types.ts`.
 *
 * Deliberately separate from `storeProof` below, and the split is the whole
 * point: `readUpload` refuses an oversized file or an unsupported type by
 * throwing, and on a *new* payment that has to happen before the row is written.
 * Fused into one step — validate and upload together, after the insert — a
 * rejected file left a payment already logged behind an error page, and the
 * obvious response to an error page is to fill the form in again, which is how
 * one parking fee becomes two.
 */
function takeProof(form: FormData): { file: File; ext: string } | null {
  const chosen = form.get("proof");
  if (!(chosen instanceof File) || chosen.size === 0) return null;
  return readUpload(form, "proof");
}

/**
 * Puts a checked receipt in storage and returns what to record against the row.
 *
 * Keyed on the payment number, so replacing a badly-photographed receipt
 * overwrites in place and the row's key never goes stale.
 */
async function storeProof(
  upload: { file: File; ext: string },
  company: CompanySlug,
  paymentNo: string,
): Promise<{ key: string; name: string }> {
  const { file, ext } = upload;
  const key = storageKeys.miscProof(company, paymentNo, ext);
  await putFile(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  return { key, name: file.name };
}

/**
 * Files proof against a payment already logged — the receipt that turned up
 * afterwards, and the one photographed badly the first time.
 */
export async function attachMiscProof(company: CompanySlug, id: string, form: FormData) {
  await requireAuth();
  const existing = await load(company, id);
  requireLive(existing);

  const upload = takeProof(form);
  if (!upload) throw new Error("Choose a receipt to attach.");
  const proof = await storeProof(upload, company, existing.paymentNo);

  const db = await store();
  const { previousKey } = await db.attachMiscProof(id, proof);

  // Only when the replacement landed somewhere else. A different extension
  // gives a different key, and the old file would otherwise sit in the bucket
  // with nothing pointing at it; the same extension overwrote it already, and
  // deleting that key here would remove the file just uploaded.
  if (previousKey && previousKey !== proof.key) await deleteFile(previousKey);

  revalidateMisc(company, id);
  redirect(`/${company}/misc/${id}?filed=1`);
}

/**
 * Takes the receipt off a payment, and deletes the file.
 *
 * Unconditionally, unlike a food receipt: that one is shared by everything
 * settled in the same payment, so it can only go once nothing else points at it.
 * A payment's proof belongs to that payment alone.
 *
 * The payment itself stays. The receipt was evidence of it, not the reason to
 * believe it happened — the row is the record, and removing a wrong photograph
 * must not remove the money from the totals.
 */
export async function removeMiscProof(company: CompanySlug, id: string) {
  await requireAuth();
  const existing = await load(company, id);
  requireLive(existing);

  const db = await store();
  const { key } = await db.detachMiscProof(id);
  if (key) await deleteFile(key);

  revalidateMisc(company, id);
  redirect(`/${company}/misc/${id}?unfiled=1`);
}

/**
 * Deletes a payment. The row is kept, so the number stays spent and the figures
 * for a month that has already been reported on stay reconstructable.
 *
 * The receipt is left in storage. A restore has to put the record back exactly
 * as it was, and a deleted payment is one undo away from being a live one again.
 */
export async function deleteMisc(company: CompanySlug, id: string) {
  await requireAuth();
  const payment = await load(company, id);

  const db = await store();
  await db.softDeleteMisc(id);

  revalidateMisc(company, id);
  redirect(`/${company}/misc?deleted=${encodeURIComponent(payment.paymentNo)}`);
}

export async function restoreMisc(company: CompanySlug, id: string) {
  await requireAuth();
  const payment = await load(company, id);

  const db = await store();
  await db.restoreMisc(id);

  revalidateMisc(company, id);
  redirect(`/${company}/misc/${payment.id}`);
}
