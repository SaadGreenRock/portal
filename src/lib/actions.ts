"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "./auth";
import { requireCompany, type CompanySlug } from "./companies";
import { store } from "./db";
import { deleteFile, putFile, storageKeys } from "./storage";
import { readUpload } from "./uploads";
import { TOGGLE_KEYS, type VoucherFields } from "./types";

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/**
 * Pulls the voucher fields out of a form payload. Toggles arrive as checkbox
 * presence; a missing checkbox means OFF, which means "print a blank line".
 */
function readFields(form: FormData): VoucherFields {
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const on = Object.fromEntries(
    TOGGLE_KEYS.map((k) => [k, form.get(`on.${k}`) === "1"]),
  ) as VoucherFields["on"];

  return {
    on,
    description: str("description"),
    amount: str("amount"),
    recipientName: str("recipientName"),
    phone: str("phone"),
    voucherDate: str("voucherDate"),
    authorizedName: str("authorizedName"),
    authorizedDate: str("authorizedDate"),
  };
}

/**
 * Creates the voucher record, which assigns its permanent number.
 *
 * The PDF is *not* produced here. It is rendered in the operator's browser and
 * posted back to /api/voucher/[id]/pdf — see src/lib/client-pdf.ts for why.
 * This returns the new id so the caller can drive that second step.
 */
export async function createVoucher(
  companySlug: string,
  form: FormData,
): Promise<{ id: string; voucherNo: string; company: string }> {
  await requireAuth();
  const company = requireCompany(companySlug);
  const fields = readFields(form);
  const internalNote = String(form.get("internalNote") ?? "").trim();

  // A toggle that is ON but has nothing typed in it would print an empty value
  // and silently look like a blank line — treat it as OFF instead.
  for (const key of TOGGLE_KEYS) {
    if (fields.on[key] && !String(fields[key as keyof VoucherFields] ?? "").trim()) {
      fields.on[key] = false;
    }
  }

  const db = await store();
  const voucher = await db.createVoucher({
    company: company.slug as CompanySlug,
    internalNote,
    fields,
  });

  revalidatePath(`/${company.slug}/vouchers/pending`);
  revalidatePath(`/${company.slug}/vouchers/history`);

  return { id: voucher.id, voucherNo: voucher.voucherNo, company: company.slug };
}

/** Attaches the signed scan and completes the voucher. */
export async function uploadScan(voucherId: string, form: FormData) {
  await requireAuth();
  const { file, ext } = readUpload(form);

  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  const key = storageKeys.scan(voucher.company, voucher.voucherNo, ext);
  await putFile(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  await db.attachScan(voucher.id, key, file.name);

  revalidatePath(`/${voucher.company}/vouchers/pending`);
  revalidatePath(`/${voucher.company}/vouchers/history`);
  revalidatePath(`/${voucher.company}/vouchers/${voucher.id}`);
}

/** Detaches a scan uploaded in error, returning the voucher to pending. */
export async function removeScan(voucherId: string) {
  await requireAuth();
  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  if (voucher.scanKey) await deleteFile(voucher.scanKey);
  await db.removeScan(voucher.id);

  revalidatePath(`/${voucher.company}/vouchers/pending`);
  revalidatePath(`/${voucher.company}/vouchers/history`);
  revalidatePath(`/${voucher.company}/vouchers/${voucher.id}`);
}

/**
 * Deletes a voucher. Both files are kept, so a delete pressed by mistake can be
 * undone in full from History → Deleted; the row is kept too, so the voucher
 * number is permanently spent and can never be issued to a different payment.
 * The sequence simply shows a gap, which is how a paper voucher book behaves.
 */
export async function deleteVoucher(voucherId: string) {
  await requireAuth();
  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  await db.softDelete(voucher.id);

  revalidatePath(`/${voucher.company}/vouchers/pending`);
  revalidatePath(`/${voucher.company}/vouchers/history`);
  redirect(`/${voucher.company}/vouchers/history?deleted=${encodeURIComponent(voucher.voucherNo)}`);
}

export async function restoreVoucher(voucherId: string) {
  await requireAuth();
  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  await db.restore(voucher.id);

  revalidatePath(`/${voucher.company}/vouchers/pending`);
  revalidatePath(`/${voucher.company}/vouchers/history`);
  redirect(`/${voucher.company}/vouchers/${voucher.id}`);
}

export async function addSignatory(companySlug: string, form: FormData) {
  await requireAuth();
  const company = requireCompany(companySlug);
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;

  const db = await store();
  await db.addSignatory(company.slug as CompanySlug, name);
  revalidatePath(`/${company.slug}/settings`);
  revalidatePath(`/${company.slug}/vouchers/new`);
}

export async function removeSignatory(companySlug: string, id: string) {
  await requireAuth();
  const company = requireCompany(companySlug);
  const db = await store();
  await db.removeSignatory(id);
  revalidatePath(`/${company.slug}/settings`);
  revalidatePath(`/${company.slug}/vouchers/new`);
}
