import Link from "next/link";
import DirectForm from "@/components/DirectForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { todayIso } from "@/lib/format";
import { createDirect } from "@/lib/tranches/actions";
import { DIRECT_DEFAULTS } from "@/lib/tranches/types";

/**
 * A new direct entry.
 *
 * Arriving with `?tranche=` — the link from inside a bucket — the entry and its
 * allocation are written in one action, the way `createAsset` writes an asset and
 * its first holding. An expense typed into a bucket is already attributed by the
 * act of typing it there, and asking twice is asking to be forgotten once.
 */
export default async function NewDirect({
  searchParams,
}: {
  searchParams: Promise<{ tranche?: string }>;
}) {
  const { tranche: trancheId } = await searchParams;
  const db = await store();

  // Together: the payee list and the tranche named in the query string are
  // independent reads, and the tranche is only asked for when one is named.
  const [payeesResult, tranche] = await Promise.all([
    tryTable(() => db.directPayees()),
    trancheId ? db.getTranche(trancheId) : null,
  ]);
  if (!payeesResult.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;
  const target =
    tranche && !tranche.deletedAt
      ? {
          id: tranche.id,
          trancheNo: tranche.trancheNo,
          recvCurrency: tranche.recvCurrency,
        }
      : null;

  return (
    <>
      <header className="mb-5">
        <h2 className="text-[17px] font-semibold">New direct entry</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
          {target ? (
            <>
              Money out of <span className="mono font-semibold">{target.trancheNo}</span> with no
              voucher, order or food entry behind it. Saving it attributes it to that tranche in
              the same act.
            </>
          ) : (
            <>
              Money out of a tranche with no voucher, order or food entry behind it. It is saved
              unallocated — attribute it from the Allocate tab, or start from a tranche to do both
              at once.
            </>
          )}
        </p>
      </header>

      <DirectForm
        action={createDirect}
        entry={{ ...DIRECT_DEFAULTS, date: todayIso() }}
        entryNo={null}
        payees={payeesResult.value}
        submitLabel={target ? `Save and allocate to ${target.trancheNo}` : "Save entry"}
        cancelHref={target ? `/funding/${target.id}` : "/funding/expenses"}
        tranche={target}
      />

      <p className="mt-4 text-[12.5px] text-ink-soft">
        <Link
          href={target ? `/funding/${target.id}` : "/funding/expenses"}
          className="underline underline-offset-2 hover:text-ink"
        >
          {target ? `Back to ${target.trancheNo}` : "Back to the direct entries"}
        </Link>
      </p>
    </>
  );
}
