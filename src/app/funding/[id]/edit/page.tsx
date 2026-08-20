import Link from "next/link";
import { notFound } from "next/navigation";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import TrancheForm from "@/components/TrancheForm";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatMoney } from "@/lib/money";
import { updateTranche } from "@/lib/tranches/actions";
import { stand } from "@/lib/tranches/types";

/**
 * Correcting a tranche.
 *
 * The one thing worth warning about before the form: lowering the received
 * amount below what has already been allocated is refused rather than allowed
 * with a warning, because it would put the bucket into the overdrawn state by
 * way of a typo — and a bucket showing red for a typo teaches you to stop
 * reading the colour. So the figure already committed is stated up front.
 */
export default async function EditTranche({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await store();

  const result = await tryTable(() => db.getTranche(id));
  if (!result.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;
  const tranche = result.value;
  if (!tranche) notFound();

  const allocations = await db.listAllocations(id);
  const standing = stand(tranche, allocations);
  const save = updateTranche.bind(null, id);

  return (
    <>
      <header className="mb-5">
        <h2 className="text-[17px] font-semibold">
          Edit <span className="mono">{tranche.trancheNo}</span>
        </h2>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
          The number and everything already allocated out of this tranche stay as they are.
        </p>
      </header>

      {standing.allocated > 0 ? (
        <p className="mb-5 rounded-xl border border-ink-line bg-wash-soft p-4 text-[13px] leading-relaxed text-ink-soft">
          <span className="mono font-semibold text-ink">
            {tranche.recvCurrency} {formatMoney(standing.allocated, tranche.recvCurrency)}
          </span>{" "}
          has already been allocated out of this tranche, so the received amount cannot be set
          below that. Remove allocations first if you need to go lower.
        </p>
      ) : null}

      <TrancheForm
        action={save}
        tranche={tranche}
        trancheNo={tranche.trancheNo}
        submitLabel="Save changes"
        cancelHref={`/funding/${tranche.id}`}
      />

      <p className="mt-4 text-[12.5px] text-ink-soft">
        <Link
          href={`/funding/${tranche.id}`}
          className="underline underline-offset-2 hover:text-ink"
        >
          Back to {tranche.trancheNo}
        </Link>
      </p>
    </>
  );
}
