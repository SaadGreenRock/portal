"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  NO_ERROR,
  type EmployeeFields,
  type FormState,
} from "@/lib/employees/types";

/**
 * The employee form, for both New employee and the record.
 *
 * A client component for one reason: it reports its own errors. The commonest
 * failure here is an employee number already in use — routine, with a specific
 * remedy, and it must name whose number it is. Thrown from a server action that
 * message would be redacted in production and arrive as a full-page error, so
 * the action returns it and `useActionState` puts it above the fields, with what
 * was typed still in them.
 *
 * `status` and `leftOn` ride along as hidden inputs rather than being editable
 * here. Whether somebody has left is a decision made with a button on the
 * record, and offering it twice — once as a select, once as a button — is two
 * ways to do one thing that can disagree. Hidden, they simply survive a save
 * that was about somebody's phone number.
 */

function Optional() {
  return (
    <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-soft">optional</span>
  );
}

export default function EmployeeForm({
  action,
  employee,
  submitLabel,
  cancelHref,
  /** Locked once assigned: a record already referred to by number keeps it. */
  numberLocked = false,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  employee: EmployeeFields;
  submitLabel: string;
  cancelHref: string;
  numberLocked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, NO_ERROR);

  return (
    <form action={formAction} className="card p-5 sm:p-6">
      <input type="hidden" name="status" value={employee.status} />
      <input type="hidden" name="leftOn" value={employee.leftOn ?? ""} />

      {/* Above the fields, not beside the button: the message is about
          something that was typed, and the fix is up here. */}
      {state.error ? (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] leading-relaxed text-red-900"
        >
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label mb-1.5" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            defaultValue={employee.name}
            required
            maxLength={160}
            autoComplete="off"
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="employeeNo">
            Employee number
          </label>
          <input
            id="employeeNo"
            name="employeeNo"
            defaultValue={employee.employeeNo}
            required
            maxLength={40}
            autoComplete="off"
            placeholder="GR-001"
            readOnly={numberLocked}
            className={`input mono ${numberLocked ? "cursor-not-allowed bg-wash text-ink-soft" : ""}`}
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            {numberLocked
              ? "Fixed once assigned. Ask whoever maintains the portal if it truly has to change."
              : "The number your company issued. The portal never makes one up."}
          </p>
        </div>

        {/* ---- identity ---------------------------------------------------- */}
        <div className="sm:col-span-2">
          <p className="label border-t border-ink-line pt-4">Identity</p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="cnic">
            CNIC number
            <Optional />
          </label>
          <input
            id="cnic"
            name="cnic"
            defaultValue={employee.cnic ?? ""}
            maxLength={40}
            autoComplete="off"
            placeholder="42101-1234567-8"
            className="input mono"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            Stored exactly as you type it, so it still matches the card by eye.
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="passport">
            Passport number
            <Optional />
          </label>
          <input
            id="passport"
            name="passport"
            defaultValue={employee.passport ?? ""}
            maxLength={40}
            autoComplete="off"
            className="input mono"
          />
        </div>

        {/* ---- contact ----------------------------------------------------- */}
        <div className="sm:col-span-2">
          <p className="label border-t border-ink-line pt-4">Contact</p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="phone">
            Phone
            <Optional />
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={employee.phone ?? ""}
            maxLength={60}
            autoComplete="off"
            className="input mono"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="address">
            Address
            <Optional />
          </label>
          <textarea
            id="address"
            name="address"
            defaultValue={employee.address ?? ""}
            rows={2}
            maxLength={500}
            className="input resize-y"
          />
        </div>

        {/* ---- next of kin ------------------------------------------------- */}
        <div className="sm:col-span-2">
          <p className="label border-t border-ink-line pt-4">
            Next of kin
            <Optional />
          </p>
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            Somebody to call about them rather than for them. Two fields, because a
            number with no name beside it is the thing you would least want to be
            guessing at on the day you need it.
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="kinName">
            Their name
          </label>
          <input
            id="kinName"
            name="kinName"
            defaultValue={employee.kinName ?? ""}
            maxLength={160}
            autoComplete="off"
            placeholder="Brother, wife, father…"
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="kinPhone">
            Their phone
          </label>
          <input
            id="kinPhone"
            name="kinPhone"
            type="tel"
            defaultValue={employee.kinPhone ?? ""}
            maxLength={60}
            autoComplete="off"
            className="input mono"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="notes">
            Notes
            <Optional />
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={employee.notes ?? ""}
            rows={3}
            maxLength={2000}
            className="input resize-y"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink-line pt-5">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href={cancelHref} className="btn btn-quiet">
          Cancel
        </Link>
      </div>
    </form>
  );
}
