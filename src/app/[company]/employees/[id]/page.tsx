import Link from "next/link";
import { notFound } from "next/navigation";
import ActionButton from "@/components/ActionButton";
import ConfirmDelete from "@/components/ConfirmDelete";
import EmployeeForm from "@/components/EmployeeForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate, todayIso } from "@/lib/format";
import {
  deleteEmployee,
  markEmployeeActive,
  markEmployeeLeft,
  restoreEmployee,
  saveEmployee,
} from "@/lib/employees/actions";
import { missingDetails } from "@/lib/employees/types";

/**
 * One employee, with their own form as the body.
 *
 * Same shape as a food entry's record and for the same reason: nothing here is
 * printed and there is no lifecycle to move through, so the record *is* the
 * editable form. What sits above it is the two things that are not fields —
 * whether they still work here, and what is still missing.
 */
export default async function EmployeeRecord({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; left?: string; returned?: string }>;
}) {
  const { company: slug, id } = await params;
  const sp = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const result = await tryTable(() => db.getEmployee(id));
  if (!result.ok) return <ModuleUnavailable module="Employees" />;
  const employee = result.value;
  if (!employee) notFound();

  // Belt and braces on the company in the URL: an employee id from one company
  // pasted under the other must not open, or the separation the whole module is
  // built on would be one hand-typed URL deep.
  if (employee.company !== company.slug) notFound();

  const save = saveEmployee.bind(null, employee.id);
  const drop = deleteEmployee.bind(null, employee.id);
  const undelete = restoreEmployee.bind(null, employee.id);
  const leave = markEmployeeLeft.bind(null, employee.id);
  const comeBack = markEmployeeActive.bind(null, employee.id);

  const gaps = missingDetails(employee);
  const notice = sp.created
    ? "Added to the register."
    : sp.saved
      ? "Saved."
      : sp.left
        ? "Marked as having left. They stay on the register and in every holding they had."
        : sp.returned
          ? "Back on the active register."
          : null;

  return (
    <>
      {employee.deletedAt ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13.5px] leading-relaxed text-amber-900">
          This employee is deleted. Their record is kept so nothing that referred to them points
          into nothing. Their employee number has been freed, so restoring them can fail if
          somebody else has taken it since.
        </div>
      ) : null}

      {notice ? (
        <div className="mb-5 rounded-xl border border-ink-line bg-card p-4 text-[13.5px]">
          {notice}
        </div>
      ) : null}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[20px] font-bold tracking-tight">{employee.name}</h1>
            {employee.status === "left" ? (
              <span className="chip chip-neutral">
                Left{employee.leftOn ? ` · ${formatDate(employee.leftOn)}` : ""}
              </span>
            ) : (
              <span className="chip chip-completed">Active</span>
            )}
          </div>
          <p className="mono mt-1 text-[13.5px] text-ink-soft">
            {employee.employeeNo} · {company.name}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {employee.deletedAt ? (
            <ActionButton action={undelete} label="Restore" className="btn btn-primary" />
          ) : (
            <ConfirmDelete action={drop} subject={employee.name} />
          )}
          <Link href={`/${company.slug}/employees`} className="btn btn-ghost">
            ← Register
          </Link>
        </div>
      </header>

      {/* What is still missing, stated quietly. These fields are optional, so
          this is a reminder rather than a score — no progress bar, and no
          nagging on a record that is complete. */}
      {!employee.deletedAt && gaps.length > 0 ? (
        <p className="mb-5 rounded-xl border border-ink-line bg-wash-soft p-4 text-[13px] leading-relaxed text-ink-soft">
          Still to fill in when you have it: {gaps.join(", ")}. None of it is required, and the
          record is usable exactly as it is.
        </p>
      ) : null}

      {/* ---- still here, or not ------------------------------------------- */}
      {!employee.deletedAt ? (
        <section className="card mb-5 p-5">
          {employee.status === "active" ? (
            <form action={leave} className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-[13.5px] font-semibold">Has {employee.name} left?</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  They stay on the register and in every holding they ever had, and drop out of
                  the dropdown when an asset is handed over — you cannot give a laptop to somebody
                  who has gone. Reversible, because people come back.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label className="label mb-1.5" htmlFor="leftOn">
                    Last day
                  </label>
                  <input
                    id="leftOn"
                    name="leftOn"
                    type="date"
                    defaultValue={todayIso()}
                    className="input"
                  />
                </div>
                <button type="submit" className="btn btn-ghost">
                  Mark as left
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-[13px] leading-relaxed text-ink-soft">
                Marked as having left
                {employee.leftOn ? ` on ${formatDate(employee.leftOn)}` : ""}. They are not offered
                when an asset is handed over. Everything they held is still on their record and on
                the assets themselves.
              </p>
              <ActionButton action={comeBack} label="Back on the register" />
            </div>
          )}
        </section>
      ) : null}

      <EmployeeForm
        action={save}
        employee={employee}
        submitLabel="Save changes"
        cancelHref={`/${company.slug}/employees`}
        numberLocked={false}
      />

      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
        Document scans — CNIC and passport — and what this employee is holding arrive in the next
        two passes. Nothing you type here will need entering again.
      </p>
    </>
  );
}
