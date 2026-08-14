import { notFound } from "next/navigation";
import GenerateForm from "@/components/GenerateForm";
import { createVoucher } from "@/lib/actions";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";

/** Today in the server's local timezone, as yyyy-mm-dd. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default async function NewVoucher({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const signatories = await db.listSignatories(company.slug);

  // Bound to this workspace, so the form can never post into the other company.
  const action = createVoucher.bind(null, company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">New voucher</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Fill in whatever is already known, then print and get it signed.
        </p>
      </div>

      <GenerateForm
        company={company.slug}
        today={todayIso()}
        signatories={signatories.map((s) => s.name)}
        action={action}
      />
    </>
  );
}
