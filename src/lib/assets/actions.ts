"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { todayIso } from "../format";
import { text } from "../po/parse";
import { allotError } from "../employees/types";
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

/**
 * Who is taking the asset, resolved from the employee register.
 *
 * The form posts an id, and this turns it into the id plus a snapshot of the
 * name and number — so a closed holding still reads correctly after somebody is
 * renamed in the register years later.
 *
 * Resolved here rather than in the store because this is the layer that knows
 * which company it is acting for, and so the only one that can refuse an
 * employee belonging to the other. That check is not a formality: an id is a
 * hidden form value, and the whole point of the two registers is that neither
 * can reach into the other.
 *
 * `keep` is the asset's current holder, supplied when correcting a holding that
 * predates the register. Leaving the dropdown alone then carries the typed name
 * through unchanged instead of blanking it.
 */
async function readAllot(
  company: CompanySlug,
  form: FormData,
  keep?: { employeeId: string; employeeName: string; employeeNo: string },
): Promise<AllotFields> {
  const allottedOn = isoDate(form.get("allottedOn"));
  const employeeId = text(form.get("employeeId"), 64, "Employee");

  if (!employeeId) {
    // Only legitimate on a correction to an unlinked holding, where "keep as
    // typed" is an option the form offers on purpose.
    if (keep?.employeeName) return { ...keep, allottedOn };
    throw new Error("Choose who is taking the asset.");
  }

  const db = await store();
  const employee = await db.getEmployee(employeeId);
  const refusal = allotError(employee, company);
  if (refusal || !employee) throw new Error(refusal ?? "That employee could not be found.");

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeNo: employee.employeeNo,
    allottedOn,
  };
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
  // Empty means nobody has it yet, which is now an ordinary way for an asset to
  // enter the register — a laptop bought last week that is still in the cupboard.
  const takenBy = text(form.get("employeeId"), 64, "Employee");
  const asset = await db.createAsset({
    company: company.slug as CompanySlug,
    fields: readAsset(form),
    allot: takenBy ? await readAllot(company.slug as CompanySlug, form) : null,
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
    existing.holderName
      ? await readAllot(existing.company, form, {
          employeeId: existing.holderId,
          employeeName: existing.holderName,
          employeeNo: existing.holderNo,
        })
      : null,
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

  const asset = await db.allotAsset(id, await readAllot(existing.company, form));

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
