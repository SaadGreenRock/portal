import Link from "next/link";
import { notFound } from "next/navigation";
import PoEditor from "@/components/PoEditor";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { savePo } from "@/lib/po/actions";
import { PO_STATUS_LABELS } from "@/lib/po/types";

export default async function EditPurchaseOrder({
  params,
}: {
  params: Promise<{ company: string; id: string }>;
}) {
  const { company: slug, id } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const [po, vendors] = await Promise.all([db.getPo(id), db.listVendors(company.slug)]);
  if (!po || po.company !== company.slug) notFound();

  const save = savePo.bind(null, po.id);

  return (
    <>
      <div className="mb-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[20px] font-bold tracking-tight">Edit {po.poNo}</h1>
          <span className="text-[13px] text-ink-soft">{PO_STATUS_LABELS[po.status]}</span>
        </div>
        <p className="mt-1 text-[14px] text-ink-soft">
          {po.status === "issued"
            ? "This order has already gone to the vendor. Saving replaces the PDF, so send the new one."
            : "Saving re-renders the PDF from what you have here."}
        </p>
      </div>

      <PoEditor
        company={company.slug}
        poNo={po.poNo}
        status={po.status}
        initialDoc={po.doc}
        initialNote={po.internalNote}
        vendors={vendors}
        mode="edit"
        save={save}
      />

      <div className="mt-6">
        <Link href={`/${company.slug}/po/${po.id}`} className="btn btn-ghost">
          ← Back without saving
        </Link>
      </div>
    </>
  );
}
