import Link from "next/link";
import { notFound } from "next/navigation";
import EmployeeForm from "@/components/EmployeeForm";
import { getCompany } from "@/lib/companies";
import { createEmployee } from "@/lib/employees/actions";
import { emptyEmployee } from "@/lib/employees/types";

/**
 * Adding somebody to the register.
 *
 * Two fields are required and the rest can wait, which is deliberate: the reason
 * to log an employee today is usually that they are about to be handed a laptop,
 * and holding that up for a CNIC scan nobody has to hand would mean the laptop
 * goes out unrecorded instead.
 */
export default async function NewEmployee({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const create = createEmployee.bind(null, company.slug);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[20px] font-bold tracking-tight">New employee</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
          A {company.name} employee. Their name and the number your company issued are all that
          is needed now — everything else can be filled in whenever you have it, and none of it
          will need a change to the portal.
        </p>
      </header>

      <EmployeeForm
        action={create}
        employee={emptyEmployee()}
        submitLabel="Add employee"
        cancelHref={`/${company.slug}/employees`}
      />

      <p className="mt-4 text-[12.5px] text-ink-soft">
        <Link
          href={`/${company.slug}/employees`}
          className="underline underline-offset-2 hover:text-ink"
        >
          Back to the register
        </Link>
      </p>
    </>
  );
}
