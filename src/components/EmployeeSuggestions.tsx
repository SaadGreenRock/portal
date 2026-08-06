import type { EmployeeProfile } from "@/lib/assets/types";

/**
 * Datalists of employees the register already knows, for the name and number
 * fields to offer back.
 *
 * Built from previous holdings, so nothing has to be maintained and the same
 * person's second asset does not get a second spelling of their name. The hint
 * beside each name is what they are holding right now, which is the useful thing
 * to know while deciding whether to give them another.
 *
 * Rendered once per form; both ids are referenced by `list=` on the inputs.
 */
export default function EmployeeSuggestions({
  employees,
}: {
  employees: EmployeeProfile[];
}) {
  // Only worth offering a number back when the employee actually has one.
  const numbered = employees.filter((e) => e.no);

  return (
    <>
      <datalist id="employee-names">
        {employees.map((e) => (
          <option key={`${e.name}|${e.no}`} value={e.name}>
            {[e.no, e.holding > 0 ? `holding ${e.holding}` : "nothing out"]
              .filter(Boolean)
              .join(" · ")}
          </option>
        ))}
      </datalist>
      <datalist id="employee-numbers">
        {numbered.map((e) => (
          <option key={`${e.no}|${e.name}`} value={e.no}>
            {e.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
