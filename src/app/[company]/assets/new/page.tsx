import { notFound } from "next/navigation";
import AssetForm from "@/components/AssetForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { createAsset } from "@/lib/assets/actions";
import { emptyAllot, emptyAsset } from "@/lib/assets/types";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { todayIso } from "@/lib/format";

/**
 * Logging an asset and handing it over are one step.
 *
 * An asset enters the register because somebody is being given it, so asking for
 * the thing and its first holder together matches what actually happens. Later
 * handovers are done from the asset's own record, where its history is.
 */
export default async function LogAsset({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const employees = await tryTable(() => db.listEmployees(company.slug));
  if (!employees.ok) return <ModuleUnavailable module="Assets" />;

  // Bound to this workspace, so the form can never post into the other company.
  const save = createAsset.bind(null, company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">New asset</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Saving assigns the next {company.prefix}-A number, which is permanent — write it on the
          item.
        </p>
      </div>

      <AssetForm
        action={save}
        asset={emptyAsset()}
        holder={emptyAllot(todayIso())}
        employees={employees.value}
        submitLabel="Save and allot"
        cancelHref={`/${company.slug}/assets`}
        assetNo={null}
      />
    </>
  );
}
