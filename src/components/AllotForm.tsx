import EmployeeSuggestions from "@/components/EmployeeSuggestions";
import type { AllotFields, EmployeeProfile } from "@/lib/assets/types";

/**
 * Hands an in-stock asset to somebody, opening a new holding.
 *
 * Shown only when nobody has it. The asset itself is not editable here — this
 * form is about the handover, and mixing the two would invite renaming a laptop
 * while giving it away.
 */
export default function AllotForm({
  action,
  initial,
  employees,
}: {
  action: (form: FormData) => Promise<void>;
  initial: AllotFields;
  employees: EmployeeProfile[];
}) {
  return (
    <form action={action} className="card p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold">Give it to somebody</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        This opens a new holding. The previous ones stay in the history below.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label mb-1.5" htmlFor="allot-name">
            Employee name
          </label>
          <input
            id="allot-name"
            name="employeeName"
            defaultValue={initial.employeeName}
            list="employee-names"
            required
            maxLength={160}
            autoComplete="off"
            placeholder="Who is taking it"
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="allot-no">
            Employee number
          </label>
          <input
            id="allot-no"
            name="employeeNo"
            defaultValue={initial.employeeNo}
            list="employee-numbers"
            maxLength={40}
            autoComplete="off"
            placeholder="As already issued"
            className="input mono"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="allot-on">
            Allotted on
          </label>
          <input
            id="allot-on"
            name="allottedOn"
            type="date"
            defaultValue={initial.allottedOn}
            className="input"
          />
        </div>
      </div>

      <EmployeeSuggestions employees={employees} />

      <button type="submit" className="btn btn-primary mt-5">
        Allot it
      </button>
    </form>
  );
}
