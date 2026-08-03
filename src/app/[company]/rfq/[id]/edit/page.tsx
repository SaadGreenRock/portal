import Link from "next/link";
import { notFound } from "next/navigation";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import RfqEditor from "@/components/RfqEditor";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { saveRfq } from "@/lib/rfq/actions";
import { RFQ_STATUS_LABELS } from "@/lib/rfq/types";

export default async function EditRequestForQuotation({
  params,
}: {
  params: Promise<{ company: string; id: string }>;
}) {
  const { company: slug, id } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const found = await tryTable(() => db.getRfq(id));
  if (!found.ok) return <ModuleUnavailable module="Quotations" />;
  const rfq = found.value;
  if (!rfq || rfq.company !== company.slug) notFound();

  const save = saveRfq.bind(null, rfq.id);

  return (
    <>
      <div className="mb-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[20px] font-bold tracking-tight">Edit {rfq.rfqNo}</h1>
          <span className="text-[13px] text-ink-soft">{RFQ_STATUS_LABELS[rfq.status]}</span>
        </div>
        <p className="mt-1 text-[14px] text-ink-soft">
          {rfq.status === "sent"
            ? "This request has already gone out. Saving replaces the PDF, so send the new one."
            : "Saving re-renders the PDF from what you have here."}
        </p>
      </div>

      <RfqEditor
        company={company.slug}
        rfqNo={rfq.rfqNo}
        status={rfq.status}
        initialDoc={rfq.doc}
        initialNote={rfq.internalNote}
        mode="edit"
        save={save}
      />

      <div className="mt-6">
        <Link href={`/${company.slug}/rfq/${rfq.id}`} className="btn btn-ghost">
          ← Back without saving
        </Link>
      </div>
    </>
  );
}
