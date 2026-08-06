"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { todayIso } from "../format";
import { text } from "../po/parse";
import { isCondition, type AllotFields, type AssetFields, type ReturnFields } from "./types";

/**
 * Server actions for the asset register.
 *
 * Plain FormData rather than a JSON payload, unlike the three document modules.
 * Those post whole documents with repeating line-item groups, which FormData
 * cannot rebuild without silently dropping a row; an allotment is a handful of
 * flat fields, so the browser needs no JavaScript to submit one.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Every path an asset or its history appears on. */
function revalidateAssets(company: string, id?: string) {
  revalidatePath(`/${company}`);
  revalidatePath(`/${company}/assets`);
  revalidatePath(`/${company}/assets/new`);
  revalidatePath(`/${company}/assets/history`);
  if (id) revalidatePath(`/${company}/assets/${id}`);
}

/** yyyy-mm-dd, or "" — anything else is not a date a date column can hold. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/**
 * `text` refuses over-long input rather than truncating it, which is why it is
 * borrowed from the purchase order parser: quietly cutting an employee's name in
 * half gives nobody a way to notice.
 */
function readAsset(form: FormData): AssetFields {
  const assetName = text(form.get("assetName"), 300, "Asset");
  if (!assetName) throw new Error("Enter what the asset is.");
  return { assetName };
}

function readAllot(form: FormData): AllotFields {
  const allot: AllotFields = {
    employeeName: text(form.get("employeeName"), 160, "Employee name"),
    employeeNo: text(form.get("employeeNo"), 40, "Employee number"),
    allottedOn: isoDate(form.get("allottedOn")),
  };
  // Without a name there is nobody to have it, and the holding would be a
  // period in nobody's possession.
  if (!allot.employeeName) throw new Error("Enter the employee's name.");
  return allot;
}

function readReturn(form: FormData): ReturnFields {
  const condition = form.get("condition");
  return {
    // Defaulted rather than left blank: an empty returned_on is what marks a
    // holding still open, so a return must always carry a date.
    returnedOn: isoDate(form.get("returnedOn")) || todayIso(),
    condition: isCondition(condition) ? condition : "good",
    note: text(form.get("note"), 400, "Note"),
  };
}

/**
 * A deleted asset is in the recycle bin, and nothing should act on it.
 *
 * The buttons are hidden, but a tab left open before the delete can still reach
 * these actions.
 */
function requireLive(asset: { deletedAt: string | null; assetNo: string }) {
  if (asset.deletedAt) {
    throw new Error(`${asset.assetNo} is deleted. Restore it before changing it.`);
  }
}

/**
 * Logs an asset and hands it to its first holder, which assigns its permanent
 * number. An asset enters the register by being given to somebody.
 */
export async function createAsset(companySlug: string, form: FormData) {
  await requireAuth();
  const company = requireCompany(companySlug);

  const db = await store();
  const asset = await db.createAsset({
    company: company.slug as CompanySlug,
    fields: readAsset(form),
    allot: readAllot(form),
  });

  revalidateAssets(company.slug);
  redirect(`/${company.slug}/assets/${asset.id}?created=1`);
}

/**
 * Saves a correction to the asset and, when it is out, to the open holding.
 * Closed holdings are history and are not editable here.
 */
export async function saveAsset(id: string, form: FormData) {
  await requireAuth();
  const db = await store();
  const existing = await db.getAsset(id);
  if (!existing) throw new Error("Asset not found");
  requireLive(existing);

  const asset = await db.updateAsset(
    id,
    readAsset(form),
    existing.holderName ? readAllot(form) : null,
  );

  revalidateAssets(asset.company, asset.id);
  redirect(`/${asset.company}/assets/${asset.id}?saved=1`);
}

/** Records a return: closes the holding and puts the asset back in stock. */
export async function returnAsset(id: string, form: FormData) {
  await requireAuth();
  const db = await store();
  const existing = await db.getAsset(id);
  if (!existing) throw new Error("Asset not found");
  requireLive(existing);

  const asset = await db.returnAsset(id, readReturn(form));

  revalidateAssets(asset.company, asset.id);
  redirect(`/${asset.company}/assets/${asset.id}?returned=1`);
}

/** Gives an in-stock asset to somebody, opening a new holding. */
export async function allotAsset(id: string, form: FormData) {
  await requireAuth();
  const db = await store();
  const existing = await db.getAsset(id);
  if (!existing) throw new Error("Asset not found");
  requireLive(existing);

  const asset = await db.allotAsset(id, readAllot(form));

  revalidateAssets(asset.company, asset.id);
  redirect(`/${asset.company}/assets/${asset.id}?allotted=1`);
}

/**
 * Deletes an asset. The row is kept, so the number stays spent — it is
 * stencilled on a physical item, and reissuing it would label two things alike.
 * Its holdings are kept too, and come back with it.
 */
export async function deleteAsset(id: string) {
  await requireAuth();
  const db = await store();
  const asset = await db.getAsset(id);
  if (!asset) throw new Error("Asset not found");

  await db.softDeleteAsset(id);
  revalidateAssets(asset.company, asset.id);
  redirect(`/${asset.company}/assets?deleted=${encodeURIComponent(asset.assetNo)}`);
}

export async function restoreAsset(id: string) {
  await requireAuth();
  const db = await store();
  const asset = await db.getAsset(id);
  if (!asset) throw new Error("Asset not found");

  await db.restoreAsset(id);
  revalidateAssets(asset.company, asset.id);
  redirect(`/${asset.company}/assets/${asset.id}`);
}
