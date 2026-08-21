import type { CompanySlug } from "../companies";

/**
 * The employee register: who works here, and how to reach them.
 *
 * This is the record that did not exist. The asset register has always known an
 * employee as two free-text columns on a holding — a name and a number, typed
 * fresh each time and offered back as a datalist assembled from every name ever
 * entered. That costs nothing to maintain, which is precisely why nothing can be
 * recorded against it: there is nowhere to put a CNIC, a phone number or an
 * address, because no row is *about a person*.
 *
 * Strictly per company, and structurally rather than by filtering. Every row
 * carries its company, every query is keyed on it, and numbering is a separate
 * sequence per company — so Green Rock and Sportech can both have an 001 and
 * they are different people. The consequence, stated because it is a real one:
 * somebody working for both companies is two records, with two numbers and two
 * sets of documents, and neither page shows the other's assets.
 *
 * Not a document. Nothing here is printed, so there is no typed document body,
 * no lifecycle status and no rendered PDF.
 */

/**
 * Whether they still work here.
 *
 * Marked rather than deleted, so a leaver stays in the register and in every
 * holding they ever had while dropping out of the asset dropdown — you cannot
 * hand a laptop to somebody who has gone. Reversible, because people come back.
 */
export type EmployeeStatus = "active" | "left";

export const EMPLOYEE_STATUSES: EmployeeStatus[] = ["active", "left"];

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  left: "Left",
};

export function isEmployeeStatus(v: unknown): v is EmployeeStatus {
  return typeof v === "string" && (EMPLOYEE_STATUSES as string[]).includes(v);
}

/**
 * What the operator types. Two fields are required and the rest are genuinely
 * optional from the first day — the columns exist, the form shows them, and an
 * employee saved with two of them filled is a complete record rather than a
 * half-finished one. "I will add these later" needs no migration.
 */
export interface EmployeeFields {
  /**
   * The number the company issued, typed by hand.
   *
   * Never generated, unlike every other number in the portal. Unique within the
   * company among live rows — see `duplicateNumberMessage`.
   */
  employeeNo: string;
  name: string;
  status: EmployeeStatus;
  /** ISO date they left. Null while active. */
  leftOn: string | null;
  /**
   * Stored exactly as typed rather than reformatted. It is a number somebody
   * will one day read off a card and compare by eye, and a portal that helpfully
   * inserted or removed dashes would be the reason the two did not match.
   */
  cnic: string | null;
  passport: string | null;
  address: string | null;
  phone: string | null;
  /**
   * Next of kin, as two fields rather than one. A number with no name beside it
   * is the thing you would least want to be guessing at on the day you need it.
   */
  kinName: string | null;
  kinPhone: string | null;
  notes: string | null;
}

export interface Employee extends EmployeeFields {
  id: string;
  company: CompanySlug;
  /**
   * Scans of the two documents, each the same three-column shape every other
   * attachment in the portal uses: the storage key, the original filename, and
   * when it was filed — which doubles as the preview's cache-buster.
   *
   * Not part of `EmployeeFields`, because they are not typed into the form: they
   * are attached, the way a voucher's signed scan is.
   */
  cnicKey: string | null;
  cnicName: string | null;
  cnicAt: string | null;
  passportKey: string | null;
  passportName: string | null;
  passportAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** True while they still work here. */
export const isActive = (e: Employee): boolean => e.status === "active" && !e.deletedAt;

/** True when either document has been filed. */
export const hasDocuments = (e: Employee): boolean =>
  Boolean(e.cnicKey) || Boolean(e.passportKey);

/**
 * How much of the optional half has been filled in.
 *
 * Shown on the record as a quiet line rather than a progress bar: the fields are
 * optional, so this is a reminder of what is still missing and not a score to be
 * improved.
 */
export function missingDetails(e: Employee): string[] {
  const gaps: string[] = [];
  if (!e.cnic) gaps.push("CNIC number");
  if (!e.cnicKey) gaps.push("CNIC scan");
  if (!e.phone) gaps.push("phone");
  if (!e.address) gaps.push("address");
  if (!e.kinPhone) gaps.push("next of kin");
  return gaps;
}

/**
 * An employee reduced to what a dropdown and a register flag need.
 *
 * Replaces the `EmployeeProfile` the asset register used to assemble from its
 * own holdings. That list could only ever contain names already typed, which is
 * exactly the circularity the register exists to break — you could not hand an
 * asset to somebody until you had already handed them one.
 *
 * `holding` is what they have out right now, which is the useful thing to know
 * while deciding whether to give them another.
 */
export interface EmployeeSummary {
  id: string;
  employeeNo: string;
  name: string;
  status: EmployeeStatus;
  holding: number;
}

/**
 * Why this employee cannot be given an asset, or null when they can.
 *
 * A function rather than three checks inlined in the asset action, so the rule
 * that keeps the two companies apart is one testable thing. The company check is
 * not a formality: the employee id arrives as a form value, and the whole point
 * of two registers is that neither can reach into the other.
 */
export function allotError(
  employee: Pick<Employee, "name" | "company" | "status" | "deletedAt"> | null,
  company: CompanySlug,
): string | null {
  if (!employee || employee.deletedAt || employee.company !== company) {
    return "That employee is not on this company's register.";
  }
  if (employee.status === "left") {
    return (
      `${employee.name} is marked as having left. ` +
      `Put them back on the register first, or choose somebody else.`
    );
  }
  return null;
}

/** Only these may be given an asset. A leaver cannot be handed a laptop. */
export const allotable = (e: EmployeeSummary): boolean => e.status === "active";

export interface EmployeeQuery {
  company: CompanySlug;
  /** Free text across name, employee number, CNIC and phone. */
  q?: string;
  /**
   * "active" still work here, "left" do not, "deleted" is the recycle bin.
   * Defaults to every live employee.
   */
  view?: "all" | "active" | "left" | "deleted";
  limit?: number;
  offset?: number;
}

export interface EmployeeCounts {
  /** Live employees on the register. */
  total: number;
  active: number;
  left: number;
}

/** A blank employee, active by default. */
export function emptyEmployee(): EmployeeFields {
  return {
    employeeNo: "",
    name: "",
    status: "active",
    leftOn: null,
    cnic: null,
    passport: null,
    address: null,
    phone: null,
    kinName: null,
    kinPhone: null,
    notes: null,
  };
}

/**
 * What a save reports back.
 *
 * Lives here rather than beside the actions because a `"use server"` module may
 * only export async functions — a constant in one is a build error, not a style
 * question.
 */
export interface FormState {
  error: string | null;
}

export const NO_ERROR: FormState = { error: null };

/**
 * An error whose message was written for the operator and is safe to show them.
 *
 * The distinction matters because of how Next handles a thrown server action.
 * In production it replaces the message with a digest, so every validation
 * message in the portal — "Enter the employee's name", and the duplicate-number
 * refusal below — arrives at the screen as a generic error page. That is
 * tolerable for a mistake nobody makes twice; it is not tolerable for a number
 * clash, which is a routine event with a specific remedy.
 *
 * So the employee actions *return* these rather than throwing them, and the form
 * renders what comes back. Anything that is not an `InputError` is a genuine
 * fault and is rethrown, where the error boundary belongs — a database message
 * is not something to paste onto a form.
 */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/**
 * The refusal when a number is already in use, worded here so both backends
 * tell the same story.
 *
 * It names the holder rather than saying "already taken": the number was typed
 * by hand, so the likeliest cause is either a typo or the person already being
 * on the register, and knowing which is the whole of what the operator needs.
 */
export function duplicateNumber(employeeNo: string, heldBy: string): InputError {
  return new InputError(
    `Employee number ${employeeNo} already belongs to ${heldBy} in this company. ` +
      `Use a different number, or open their record instead of adding a second one.`,
  );
}
