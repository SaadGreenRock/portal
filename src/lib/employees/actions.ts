"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { todayIso } from "../format";
import { text } from "../po/parse";
import {
  InputError,
  isEmployeeStatus,
  type EmployeeFields,
  type FormState,
} from "./types";

/**
 * Server actions for the employee register.
 *
 * Plain FormData, like the asset register and the food log: every field here is
 * flat, so the browser needs no JavaScript to submit one.
 *
 * The two that save a record return their errors rather than throwing them, and
 * that is a departure from the rest of the portal worth explaining. Next
 * replaces a thrown server-action message with a digest in production, so every
 * validation message elsewhere in this app reaches the operator as a generic
 * error page. That is survivable for "enter a name", which nobody hits twice —
 * but the commonest failure here is an employee number already in use, which is
 * routine, has a specific remedy, and must say whose number it is. So these
 * return an `{ error }` and the form renders it in place.
 *
 * Anything that is not an `InputError` is a genuine fault and is left to throw:
 * a database message belongs in the error boundary, not pasted onto a form.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Every path an employee or their count appears on. */
function revalidateEmployees(company: string, id?: string) {
  revalidatePath(`/${company}`);
  revalidatePath(`/${company}/employees`);
  revalidatePath(`/${company}/employees/new`);
  if (id) revalidatePath(`/${company}/employees/${id}`);
}

/** yyyy-mm-dd, or "" — anything else is not a date a date column can hold. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/** "" becomes null: absence and an empty string mean the same thing here. */
const optional = (v: unknown, max: number, field: string): string | null =>
  text(v, max, field) || null;

/**
 * `text` refuses over-long input rather than truncating it, which is why it is
 * borrowed from the purchase order parser: quietly halving somebody's address
 * gives nobody a way to notice.
 */
function readEmployee(form: FormData): EmployeeFields {
  const name = text(form.get("name"), 160, "Name");
  if (!name) throw new InputError("Enter the employee's name.");

  // Required, and typed rather than generated — the only number in the portal
  // that is. Nothing here invents one if it is left blank.
  const employeeNo = text(form.get("employeeNo"), 40, "Employee number");
  if (!employeeNo) {
    throw new InputError(
      "Enter the employee number. It is the number your company issued — the portal never makes one up.",
    );
  }

  const statusRaw = form.get("status");
  const status = isEmployeeStatus(statusRaw) ? statusRaw : "active";
  const leftOn = isoDate(form.get("leftOn"));

  // A leaver with no date gets today rather than a blank, for the same reason a
  // settled food entry does: the register is read as a record, and an empty
  // column in the middle of it reads as a gap rather than as "we did not write
  // this down".
  if (status === "left" && !leftOn) {
    return { ...base(form), name, employeeNo, status, leftOn: todayIso() };
  }

  return { ...base(form), name, employeeNo, status, leftOn: status === "left" ? leftOn : null };
}

/** The optional half, which is every field except the name and the number. */
function base(form: FormData) {
  return {
    cnic: optional(form.get("cnic"), 40, "CNIC number"),
    passport: optional(form.get("passport"), 40, "Passport number"),
    address: optional(form.get("address"), 500, "Address"),
    phone: optional(form.get("phone"), 60, "Phone"),
    kinName: optional(form.get("kinName"), 160, "Next of kin"),
    kinPhone: optional(form.get("kinPhone"), 60, "Next of kin phone"),
    notes: optional(form.get("notes"), 2000, "Notes"),
  };
}

/** Operator-facing errors come back; everything else is a real fault. */
function asFormState(err: unknown): FormState {
  if (err instanceof InputError) return { error: err.message };
  throw err;
}

export async function createEmployee(
  companySlug: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAuth();
  const company = requireCompany(companySlug);

  let id: string;
  try {
    const db = await store();
    const employee = await db.createEmployee({
      company: company.slug as CompanySlug,
      fields: readEmployee(form),
    });
    id = employee.id;
  } catch (err) {
    return asFormState(err);
  }

  // Outside the try: a redirect is thrown, and catching it would turn a
  // successful save into a reported failure.
  revalidateEmployees(company.slug, id);
  redirect(`/${company.slug}/employees/${id}?created=1`);
}

export async function saveEmployee(
  id: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAuth();

  let company: string;
  try {
    const db = await store();
    const existing = await db.getEmployee(id);
    if (!existing) throw new InputError("That employee no longer exists.");
    if (existing.deletedAt) {
      throw new InputError(`${existing.name} is deleted. Restore them before making changes.`);
    }
    const employee = await db.updateEmployee(id, readEmployee(form));
    company = employee.company;
  } catch (err) {
    return asFormState(err);
  }

  revalidateEmployees(company, id);
  redirect(`/${company}/employees/${id}?saved=1`);
}

/**
 * Marks somebody as having left, which is what takes them out of the asset
 * dropdown without taking them out of the register.
 */
export async function markEmployeeLeft(id: string, form: FormData): Promise<void> {
  await requireAuth();
  const db = await store();
  const employee = await db.getEmployee(id);
  if (!employee) throw new Error("Employee not found");

  await db.setEmployeeStatus(id, "left", isoDate(form.get("leftOn")) || todayIso());
  revalidateEmployees(employee.company, id);
  redirect(`/${employee.company}/employees/${id}?left=1`);
}

/** Brings somebody back. Clears the leaving date — see `setEmployeeStatus`. */
export async function markEmployeeActive(id: string): Promise<void> {
  await requireAuth();
  const db = await store();
  const employee = await db.getEmployee(id);
  if (!employee) throw new Error("Employee not found");

  await db.setEmployeeStatus(id, "active", null);
  revalidateEmployees(employee.company, id);
  redirect(`/${employee.company}/employees/${id}?returned=1`);
}

/**
 * Deletes an employee. The row is kept, so their holdings never point into
 * nothing — but their number is freed, unlike every other number in the portal.
 * It was typed by hand, so a typo has to be undoable.
 */
export async function deleteEmployee(id: string): Promise<{ error: string } | void> {
  await requireAuth();
  const db = await store();
  const employee = await db.getEmployee(id);
  if (!employee) return { error: "That employee no longer exists." };

  await db.softDeleteEmployee(id);
  revalidateEmployees(employee.company, id);
  redirect(
    `/${employee.company}/employees?deleted=${encodeURIComponent(employee.name)}`,
  );
}

/**
 * Restores a deleted employee.
 *
 * Can fail, and for a reason specific to this module: their number was freed
 * when they were deleted, so somebody else may be using it by now. The store
 * refuses rather than breaking its own unique index, and the message names who
 * has it.
 */
export async function restoreEmployee(id: string): Promise<{ error: string } | void> {
  await requireAuth();
  const db = await store();
  const employee = await db.getEmployee(id);
  if (!employee) return { error: "That employee no longer exists." };

  try {
    await db.restoreEmployee(id);
  } catch (err) {
    if (err instanceof InputError) return { error: err.message };
    throw err;
  }

  revalidateEmployees(employee.company, id);
  redirect(`/${employee.company}/employees/${id}`);
}
