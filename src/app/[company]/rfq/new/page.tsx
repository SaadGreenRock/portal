import { notFound } from "next/navigation";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import RfqEditor from "@/components/RfqEditor";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { addDays, todayIso } from "@/lib/format";
import { createRfq } from "@/lib/rfq/actions";
import { emptyRfqDoc } from "@/lib/rfq/types";

/** today + n days, as yyyy-mm-dd. */
function inDays(days: number): string {
  return addDays(todayIso(), days);
}

export default async function NewRequestForQuotation({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const ready = await tryTable(() => db.getSettings(company.slug));
  if (!ready.ok) return <ModuleUnavailable module="Quotations" />;
  const settings = ready.value;

  // Bound to this workspace, so the form can never post into the other company.
  const save = createRfq.bind(null, company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">New quotation request</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          One generic request, which you send to whichever vendors you like. Defaults come from{" "}
          <span className="font-medium text-ink">Settings</span>.
        </p>
      </div>

      <RfqEditor
        company={company.slug}
        rfqNo={null}
        status="draft"
        initialDoc={emptyRfqDoc(
          todayIso(),
          settings.rfq.replyWithinDays > 0 ? inDays(settings.rfq.replyWithinDays) : "",
          settings.rfq,
        )}
        initialNote=""
        mode="create"
        save={save}
      />
    </>
  );
}
