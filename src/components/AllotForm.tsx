import EmployeePicker from "@/components/EmployeePicker";
import type { AllotFields } from "@/lib/assets/types";
import type { EmployeeSummary } from "@/lib/employees/types";

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
  company,
}: {
  action: (form: FormData) => Promise<void>;
  initial: AllotFields;
  employees: EmployeeSummary[];
  company: string;
}) {
  return (
    <form action={action} className="card p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold">Give it to somebody</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        This opens a new holding. The previous ones stay in the history below.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <EmployeePicker
          employees={employees}
          company={company}
          value={initial.employeeId}
          label="Who is taking it"
        />

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

      <button type="submit" className="btn btn-primary mt-5">
        Allot it
      </button>
    </form>
  );
}
