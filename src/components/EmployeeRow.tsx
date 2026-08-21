import Link from "next/link";
import { formatDate } from "@/lib/format";
import { hasDocuments, type Employee } from "@/lib/employees/types";

/**
 * One employee on the register.
 *
 * The number leads, because it is what the company files them under and what an
 * asset's paperwork will quote. The chips say only what is unusual: an active
 * employee with their details filled in draws none, so the eye goes to the rows
 * that need something.
 */
export default function EmployeeRow({
  employee,
  company,
}: {
  employee: Employee;
  company: string;
}) {
  const left = employee.status === "left";

  return (
    <li className="card">
      <Link
        href={`/${company}/employees/${employee.id}`}
        className="row-link px-5 py-3.5"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="mono text-[13.5px] font-semibold">{employee.employeeNo}</span>
            <span className={`text-[14.5px] font-medium ${left ? "text-ink-soft" : ""}`}>
              {employee.name}
            </span>
            {left ? (
              <span className="chip chip-neutral">
                Left{employee.leftOn ? ` · ${formatDate(employee.leftOn)}` : ""}
              </span>
            ) : null}
            {employee.deletedAt ? <span className="chip chip-pending">Deleted</span> : null}
          </span>

          {/* The contact line, which is the reason to open a record at all. Only
              what is there — a row of empty labels would be noise on the
              register of somebody logged with a name and a number and nothing
              else, which is the normal state of a new entry. */}
          {employee.phone || employee.cnic ? (
            <span className="mono mt-1 block text-[12.5px] text-ink-soft">
              {[employee.phone, employee.cnic].filter(Boolean).join("  ·  ")}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-right text-[12.5px] text-ink-soft">
          {hasDocuments(employee) ? "Documents on file" : "No documents"}
        </span>
      </Link>
    </li>
  );
}
