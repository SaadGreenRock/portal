import { notFound } from "next/navigation";
import PoEditor from "@/components/PoEditor";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { todayIso } from "@/lib/format";
import { createPo } from "@/lib/po/actions";
import { emptyPoDoc } from "@/lib/po/types";

export default async function NewPurchaseOrder({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const [settings, vendors] = await Promise.all([
    db.getSettings(company.slug),
    db.listVendors(company.slug),
  ]);

  // Bound to this workspace, so the form can never post into the other company.
  const save = createPo.bind(null, company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">New purchase order</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          The number is assigned when you save. Defaults come from{" "}
          <span className="font-medium text-ink">Settings</span>.
        </p>
      </div>

      <PoEditor
        company={company.slug}
        poNo={null}
        status="draft"
        initialDoc={emptyPoDoc(todayIso(), settings.po)}
        initialNote=""
        vendors={vendors}
        mode="create"
        save={save}
      />
    </>
  );
}
