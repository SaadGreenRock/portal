import Link from "next/link";
import { allotable, type EmployeeSummary } from "@/lib/employees/types";

/**
 * Who is taking the asset, chosen from the company's register.
 *
 * This replaces two free-text boxes and a datalist assembled from names already
 * typed — a list that could only contain people who had already been given
 * something, which is the circularity the register exists to break.
 *
 * Only active employees are offered. A leaver is on the register and in every
 * holding they ever had, but they cannot be handed a laptop, and leaving them in
 * the list would make that a matter of the operator remembering.
 *
 * `keep` is the currently-recorded holder of a holding that predates the
 * register, offered as the first option so that correcting the date does not
 * silently blank a name nobody can get back. Choosing a real employee is how
 * such a holding gets linked, which is the incremental path to a register that
 * covers the history too.
 */
export default function EmployeePicker({
  employees,
  company,
  /** Preselected id. "" for nobody. */
  value,
  keep,
  /** Off on the new-asset form, where "nobody yet" is a legitimate answer. */
  required = true,
  id = "employeeId",
  label = "Holder",
}: {
  employees: EmployeeSummary[];
  company: string;
  value: string;
  keep?: { name: string; no: string } | null;
  required?: boolean;
  id?: string;
  label?: string;
}) {
  const active = employees.filter(allotable);

  return (
    <div>
      <label className="label mb-1.5" htmlFor={id}>
        {label}
      </label>
      <select id={id} name="employeeId" defaultValue={value} required={required} className="input">
        {/* Two different empty options, and the difference matters. "Keep as
            typed" preserves a name the register never knew; "nobody" puts the
            asset in stock. Only one of them is ever shown. */}
        {keep ? (
          <option value="">
            Keep as typed — {keep.name}
            {keep.no ? ` (${keep.no})` : ""}
          </option>
        ) : (
          <option value="">{required ? "Choose an employee…" : "In stock — nobody yet"}</option>
        )}

        {active.map((e) => (
          <option key={e.id} value={e.id}>
            {e.employeeNo} — {e.name}
            {e.holding > 0 ? ` · holding ${e.holding}` : ""}
          </option>
        ))}
      </select>

      {active.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-amber-800">
          Nobody is on this company&rsquo;s register yet.{" "}
          <Link
            href={`/${company}/employees/new`}
            className="underline underline-offset-2 hover:text-ink"
          >
            Add an employee
          </Link>{" "}
          and they will appear here.
        </p>
      ) : (
        <p className="mt-1.5 text-[12.5px] text-ink-soft">
          {keep ? "Pick somebody to link this holding to their record. " : ""}
          Only active employees are listed —{" "}
          <Link
            href={`/${company}/employees/new`}
            className="underline underline-offset-2 hover:text-ink"
          >
            add a new one
          </Link>{" "}
          if they are missing.
        </p>
      )}
    </div>
  );
}
