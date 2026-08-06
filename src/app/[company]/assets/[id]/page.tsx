import Link from "next/link";
import { notFound } from "next/navigation";
import AllotForm from "@/components/AllotForm";
import AssetForm from "@/components/AssetForm";
import ConfirmDelete from "@/components/ConfirmDelete";
import HoldingTimeline from "@/components/HoldingTimeline";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import ReturnForm from "@/components/ReturnForm";
import {
  allotAsset,
  deleteAsset,
  restoreAsset,
  returnAsset,
  saveAsset,
} from "@/lib/assets/actions";
import {
  CONDITION_LABELS,
  emptyAllot,
  emptyReturn,
  inStock,
} from "@/lib/assets/types";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate, spanInDays, stamp, todayIso } from "@/lib/format";

/**
 * One asset: what it is, who has it, and everyone who has had it.
 *
 * The record and its edit form are the same screen — the two fields worth
 * reading are the two worth correcting. What changes with state is the handover:
 * an asset that is out can be returned, one in stock can be given to somebody,
 * and never both, because a holding is closed before the next one opens.
 *
 * A deleted asset drops every form. It is in the bin, and the only thing to do
 * with it is put it back.
 */
export default async function AssetRecord({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; id: string }>;
  searchParams: Promise<{
    created?: string;
    saved?: string;
    returned?: string;
    allotted?: string;
  }>;
}) {
  const { company: slug, id } = await params;
  const sp = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  // One pass: three sequential round trips on a serverless request is a visible
  // pause, and every screen state needs all three.
  const [found, holdings, employees] = await Promise.all([
    tryTable(() => db.getAsset(id)),
    tryTable(() => db.listHoldings(id)),
    tryTable(() => db.listEmployees(company.slug)),
  ]);
  if (!found.ok) return <ModuleUnavailable module="Assets" />;

  const asset = found.value;
  // Also 404 for a real asset reached through the wrong workspace, so a URL
  // cannot be used to read across companies.
  if (!asset || asset.company !== company.slug) notFound();

  const free = inStock(asset);
  const timeline = holdings.ok ? holdings.value : [];
  const people = employees.ok ? employees.value : [];

  const drop = deleteAsset.bind(null, asset.id);
  const undelete = restoreAsset.bind(null, asset.id);
  const save = saveAsset.bind(null, asset.id);
  const giveBack = returnAsset.bind(null, asset.id);
  const giveOut = allotAsset.bind(null, asset.id);

  const banner = sp.created
    ? `Logged as ${asset.assetNo}. Write that number on the item — it is permanent, and no other asset will get it.`
    : sp.returned
      ? "Return recorded. The holding is closed and kept in the history below."
      : sp.allotted
        ? "Allotted. The previous holdings are kept in the history below."
        : sp.saved
          ? "Saved."
          : null;

  return (
    <>
      {banner ? (
        <div className="mb-5 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">{banner}</p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="mono text-[20px] font-bold tracking-tight">{asset.assetNo}</h1>
            {asset.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : (
              <span className={`chip ${free ? "bg-[#ececeb] text-ink" : "chip-pending"}`}>
                {free ? "In stock" : "Out"}
              </span>
            )}
            {asset.condition !== "good" ? (
              <span className="chip bg-red-100 text-red-900">
                {CONDITION_LABELS[asset.condition]}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] text-ink-soft">
            {asset.assetName}
            {free
              ? " — nobody has it"
              : ` — with ${asset.holderName}${
                  asset.heldSince ? ` since ${formatDate(asset.heldSince)}` : ""
                }`}
            {!free && spanInDays(asset.heldSince, "")
              ? ` (${spanInDays(asset.heldSince, "")})`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/${company.slug}/assets`} className="btn btn-ghost">
            Register
          </Link>
          {asset.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-primary">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete action={drop} subject={asset.assetNo} />
          )}
        </div>
      </div>

      {asset.deletedAt ? (
        <div className="card p-5 sm:p-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset" value={asset.assetName} />
            <Field label="Condition" value={CONDITION_LABELS[asset.condition]} />
            <Field label="Held by" value={free ? "Nobody" : asset.holderName} />
            <Field label="Held since" value={formatDate(asset.heldSince) || "—"} />
          </dl>
          <p className="mt-5 text-[13px] text-ink-soft">
            Restore it to make changes. Its number stays spent either way.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* The handover comes first: it is why the screen was opened. */}
          {free ? (
            <AllotForm action={giveOut} initial={emptyAllot(todayIso())} employees={people} />
          ) : (
            <ReturnForm
              action={giveBack}
              initial={emptyReturn(todayIso())}
              holderName={asset.holderName}
            />
          )}

          <AssetForm
            action={save}
            asset={{ assetName: asset.assetName }}
            holder={
              free
                ? null
                : {
                    employeeName: asset.holderName,
                    employeeNo: asset.holderNo,
                    allottedOn: asset.heldSince,
                  }
            }
            employees={people}
            submitLabel="Save changes"
            cancelHref={`/${company.slug}/assets`}
            assetNo={asset.assetNo}
          />
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Holding history</h2>
          <p className="text-[12.5px] text-ink-soft">
            {timeline.length} {timeline.length === 1 ? "holding" : "holdings"} · newest first
          </p>
        </div>
        {holdings.ok ? (
          <HoldingTimeline holdings={timeline} />
        ) : (
          <div className="card px-5 py-8 text-center">
            <p className="text-[13.5px] text-ink-soft">
              The holdings table is missing from this database — run the migration to see history.
            </p>
          </div>
        )}
      </div>

      <dl className="card mt-5 grid gap-x-6 gap-y-3 p-5 sm:grid-cols-3">
        <Field label="Logged" value={stamp(asset.createdAt)} />
        <Field label="Last changed" value={stamp(asset.updatedAt)} />
        <Field label="Deleted" value={asset.deletedAt ? stamp(asset.deletedAt) : "—"} />
      </dl>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-[13.5px]">{value}</dd>
    </div>
  );
}
