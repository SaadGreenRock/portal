import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmDelete from "@/components/ConfirmDelete";
import DirectForm from "@/components/DirectForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatMoney } from "@/lib/money";
import { deleteDirect, restoreDirect, updateDirect } from "@/lib/tranches/actions";
import { allocationState } from "@/lib/tranches/types";

/**
 * One direct entry, with its own form as the body.
 *
 * Same shape as a food entry's record: there is nothing to print and no
 * lifecycle to move through, so the record *is* the editable form, and the only
 * thing worth stating above it is where the money was taken from.
 */
export default async function DirectRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await store();

  const result = await tryTable(() => db.getDirect(id));
  if (!result.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;
  const entry = result.value;
  if (!entry) notFound();

  const payees = await db.directPayees();
  const items = await db.allocatable();
  const item = items.find((i) => i.kind === "direct" && i.id === id);
  const state = item ? allocationState(item) : "none";

  const save = updateDirect.bind(null, id);
  const drop = deleteDirect.bind(null, id);
  const undelete = restoreDirect.bind(null, id);

  return (
    <>
      {entry.deletedAt ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13.5px] leading-relaxed text-amber-900">
          This entry is deleted, and whatever it had drawn from a tranche has gone back. Its
          number stays spent, so nothing else can take it. Restoring it brings the entry back
          unallocated, into the queue, to be attributed again.
        </div>
      ) : null}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="mono text-[18px] font-bold">{entry.entryNo}</h2>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {entry.payee} · {entry.currency} {formatMoney(entry.amount, entry.currency)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entry.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-primary">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete
              action={drop}
              subject={entry.entryNo}
              warning={
                item && item.placements.length > 0
                  ? `${entry.currency} ${formatMoney(entry.amount, entry.currency)} goes back to ${item.placements
                      .map((p) => p.trancheNo)
                      .join(" and ")}.`
                  : undefined
              }
            />
          )}
          <Link href="/funding/expenses" className="btn btn-ghost">
            ← Direct entries
          </Link>
        </div>
      </header>

      {/* Where the money came from — the one fact about this entry that lives
          outside it. */}
      <section className="card mb-5 px-5 py-4">
        <p className="label">Paid out of</p>
        {state === "none" || !item || item.placements.length === 0 ? (
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            Not attributed to any tranche yet.{" "}
            <Link
              href="/funding/allocate?kind=direct"
              className="underline underline-offset-2 hover:text-ink"
            >
              Allocate it
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {item.placements.map((p) => (
              <li key={p.trancheId} className="flex items-baseline justify-between gap-4">
                <Link
                  href={`/funding/${p.trancheId}`}
                  className="mono text-[13.5px] font-semibold underline decoration-ink-line underline-offset-2 hover:decoration-current"
                >
                  {p.trancheNo}
                </Link>
                <span className="mono text-[13.5px]">
                  {entry.currency} {formatMoney(p.sourceAmount, entry.currency)}
                </span>
              </li>
            ))}
            {state === "part" ? (
              <li className="pt-1 text-[12.5px] text-amber-800">
                Part of this entry is still unattributed — it is split across tranches, or waiting
                for the next one.
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {state !== "none" ? (
        <p className="mb-5 rounded-xl border border-ink-line bg-wash-soft p-4 text-[12.5px] leading-relaxed text-ink-soft">
          Changing the amount here does not move any tranche&rsquo;s balance — an allocation
          carries its own figure, which is what stops an edit from silently altering a bucket you
          may have closed months ago. If you change it, adjust the allocation on the tranche too.
        </p>
      ) : null}

      <DirectForm
        action={save}
        entry={entry}
        entryNo={entry.entryNo}
        payees={payees}
        submitLabel="Save changes"
        cancelHref="/funding/expenses"
      />
    </>
  );
}
