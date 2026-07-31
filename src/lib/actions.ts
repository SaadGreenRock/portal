"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "./auth";
import { requireCompany, type CompanySlug } from "./companies";
import { store } from "./db";
import { htmlToPdf } from "./pdf";
import { deleteFile, putFile, storageKeys } from "./storage";
import { renderVoucherHtml } from "./template";
import { TOGGLE_KEYS, type VoucherFields } from "./types";

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Whitelist of scan formats — whatever a phone camera or a scanner produces. */
const SCAN_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".tif", ".tiff",
]);

const MAX_SCAN_BYTES = 25 * 1024 * 1024;

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
 * Creates the voucher record — which assigns its permanent number — then
 * renders and stores the branded PDF. Lands the operator on the voucher page
 * with a Print button, because printing is always the next thing they do.
 */
export async function generateVoucher(companySlug: string, form: FormData) {
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

  const pdf = await htmlToPdf(renderVoucherHtml(voucher, company));
  const key = storageKeys.pdf(company.slug, voucher.voucherNo);
  await putFile(key, pdf, "application/pdf");
  await db.attachPdf(voucher.id, key);

  revalidatePath(`/${company.slug}/pending`);
  revalidatePath(`/${company.slug}/history`);
  redirect(`/${company.slug}/v/${voucher.id}?new=1`);
}

/** Re-renders and replaces the stored PDF — used if a render was interrupted. */
export async function regeneratePdf(voucherId: string) {
  await requireAuth();
  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  const company = requireCompany(voucher.company);
  const pdf = await htmlToPdf(renderVoucherHtml(voucher, company));
  const key = storageKeys.pdf(company.slug, voucher.voucherNo);
  await putFile(key, pdf, "application/pdf");
  await db.attachPdf(voucher.id, key);

  revalidatePath(`/${company.slug}/v/${voucher.id}`);
}

/** Attaches the signed scan and completes the voucher. */
export async function uploadScan(voucherId: string, form: FormData) {
  await requireAuth();
  const file = form.get("scan");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a scanned file to upload.");
  }
  if (file.size > MAX_SCAN_BYTES) {
    throw new Error("That file is larger than 25 MB. Try a lower-resolution scan.");
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!SCAN_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type "${ext || "unknown"}". Upload a PDF or an image.`);
  }

  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  const key = storageKeys.scan(voucher.company, voucher.voucherNo, ext);
  await putFile(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  await db.attachScan(voucher.id, key, file.name);

  revalidatePath(`/${voucher.company}/pending`);
  revalidatePath(`/${voucher.company}/history`);
  revalidatePath(`/${voucher.company}/v/${voucher.id}`);
}

/** Detaches a scan uploaded in error, returning the voucher to pending. */
export async function removeScan(voucherId: string) {
  await requireAuth();
  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  if (voucher.scanKey) await deleteFile(voucher.scanKey);
  await db.removeScan(voucher.id);

  revalidatePath(`/${voucher.company}/pending`);
  revalidatePath(`/${voucher.company}/history`);
  revalidatePath(`/${voucher.company}/v/${voucher.id}`);
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

  revalidatePath(`/${voucher.company}/pending`);
  revalidatePath(`/${voucher.company}/history`);
  redirect(`/${voucher.company}/history?deleted=${encodeURIComponent(voucher.voucherNo)}`);
}

export async function restoreVoucher(voucherId: string) {
  await requireAuth();
  const db = await store();
  const voucher = await db.getVoucher(voucherId);
  if (!voucher) throw new Error("Voucher not found");

  await db.restore(voucher.id);

  revalidatePath(`/${voucher.company}/pending`);
  revalidatePath(`/${voucher.company}/history`);
  redirect(`/${voucher.company}/v/${voucher.id}`);
}

export async function addSignatory(companySlug: string, form: FormData) {
  await requireAuth();
  const company = requireCompany(companySlug);
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;

  const db = await store();
  await db.addSignatory(company.slug as CompanySlug, name);
  revalidatePath(`/${company.slug}/settings`);
  revalidatePath(`/${company.slug}/new`);
}

export async function removeSignatory(companySlug: string, id: string) {
  await requireAuth();
  const company = requireCompany(companySlug);
  const db = await store();
  await db.removeSignatory(id);
  revalidatePath(`/${company.slug}/settings`);
  revalidatePath(`/${company.slug}/new`);
}
