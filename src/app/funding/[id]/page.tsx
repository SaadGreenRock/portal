import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmDelete from "@/components/ConfirmDelete";
import DrawdownBar from "@/components/DrawdownBar";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import TrancheChip from "@/components/TrancheChip";
import { COMPANIES } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  closeTranche,
  deleteTranche,
  removeAllocation,
  reopenTranche,
  restoreTranche,
} from "@/lib/tranches/actions";
import {
  SOURCE_LABELS,
  stand,
  type Allocation,
  type Tranche,
} from "@/lib/tranches/types";

/**
 * One tranche: the two figures it stores, the arithmetic on them, and every
 * rupee that has come out of it.
 *
 * The dollar equivalent is computed at this tranche's own rate and nowhere near
 * the blended one on the index. That is the whole reason buckets are kept
 * separate — a July expense converted at a September rate is a figure nobody can
 * check against a bank statement, and it would be the one figure on this page
 * most likely to be quoted back to the investor.
 */
export default async function TrancheRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await store();

  // Together: both are keyed on the id in the URL, so neither waits on the
  // other's answer. Sequentially this was two round trips to show one bucket.
  const [result, allocations] = await Promise.all([
    tryTable(() => db.getTranche(id)),
    db.listAllocations(id),
  ]);
  if (!result.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;
  const tranche = result.value;
  if (!tranche) notFound();

  const standing = stand(tranche, allocations);

  const drop = deleteTranche.bind(null, id);
  const undelete = restoreTranche.bind(null, id);
  const close = closeTranche.bind(null, id);
  const reopen = reopenTranche.bind(null, id);

  return (
    <>
      {tranche.deletedAt ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13.5px] leading-relaxed text-amber-900">
          This tranche is deleted. Its number stays spent, and it counts towards nothing — the{" "}
          {allocations.length} {allocations.length === 1 ? "expense" : "expenses"} below have gone
          back into the work queue as unallocated. The allocations themselves are kept, so
          restoring the tranche puts every one of them back exactly as it was.
        </div>
      ) : null}

      {/* ---- header ------------------------------------------------------- */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="mono text-[20px] font-bold">{tranche.trancheNo}</h2>
            <TrancheChip standing={standing} />
          </div>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {tranche.label ? `${tranche.label} · ` : ""}
            Received {formatDate(tranche.recvDate)}
            {tranche.sentDate ? `, sent ${formatDate(tranche.sentDate)}` : ""}
            {tranche.funder ? ` · from ${tranche.funder}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {tranche.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-primary">
                Restore
              </button>
            </form>
          ) : (
            <>
              <Link href={`/funding/allocate?tranche=${tranche.id}`} className="btn btn-primary">
                Allocate expenses
              </Link>
              <Link href={`/funding/${tranche.id}/edit`} className="btn btn-ghost">
                Edit
              </Link>
              <ConfirmDelete
                action={drop}
                subject={tranche.trancheNo}
                // Written out as two whole sentences rather than assembled
                // from fragments: the singular and plural readings differ in
                // three places, and stitching them produced "that expense
                // return to the queue".
                warning={
                  allocations.length === 0
                    ? undefined
                    : allocations.length === 1
                      ? "Its one allocation goes with it, and that expense returns to the queue. Restoring the tranche puts it back."
                      : `Its ${allocations.length} allocations go with it, and those expenses return to the queue. Restoring the tranche puts them back.`
                }
              />
            </>
          )}
          <Link href="/funding" className="btn btn-ghost">
            ← Tranches
          </Link>
        </div>
      </header>

      {/* ---- the arithmetic ----------------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <dl className="grid gap-px bg-ink-line sm:grid-cols-3">
          <Figure
            label="Sent"
            value={`${tranche.sentCurrency} ${formatMoney(tranche.sentAmount, tranche.sentCurrency)}`}
          />
          <Figure
            label="Received"
            value={`${tranche.recvCurrency} ${formatMoney(tranche.recvAmount, tranche.recvCurrency)}`}
            hint="after bank charges"
          />
          <Figure
            label="Effective rate"
            value={
              standing.rate
                ? `${tranche.recvCurrency} ${formatMoney(standing.rate, tranche.recvCurrency)}`
                : "—"
            }
            hint={standing.rate ? `per 1 ${tranche.sentCurrency}` : "needs both figures"}
          />
        </dl>

        <div className="border-t border-ink-line px-5 py-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <p className="label">Allocated</p>
              <p className="mono mt-1 text-[24px] font-bold leading-none">
                {tranche.recvCurrency} {formatMoney(standing.allocated, tranche.recvCurrency)}
              </p>
              {/* The figure to quote back to whoever wired the money — they
                  think in dollars, and this bucket's own rate is the only
                  honest way there. */}
              {standing.sentEquivalent != null ? (
                <p className="mt-1.5 text-[12.5px] text-ink-soft">
                  the equivalent of{" "}
                  <span className="mono font-semibold text-ink">
                    {tranche.sentCurrency}{" "}
                    {formatMoney(standing.sentEquivalent, tranche.sentCurrency)}
                  </span>{" "}
                  of the {tranche.sentCurrency}{" "}
                  {formatMoney(tranche.sentAmount, tranche.sentCurrency)} sent
                </p>
              ) : null}
            </div>

            <div className="text-right">
              <p className="label">{standing.remaining < 0 ? "Overdrawn by" : "Remaining"}</p>
              <p
                className={`mono mt-1 text-[24px] font-bold leading-none ${
                  standing.remaining < 0 ? "text-[var(--danger)]" : ""
                }`}
              >
                {tranche.recvCurrency}{" "}
                {formatMoney(Math.abs(standing.remaining), tranche.recvCurrency)}
              </p>
              <p className="mt-1.5 text-[12.5px] text-ink-soft">
                {Math.round(standing.used * 100)}% of the tranche used
              </p>
            </div>
          </div>

          <DrawdownBar standing={standing} />
        </div>

        {/* The gap between this page and the expenditure report, stated rather
            than left to be discovered. */}
        {standing.directOnly > 0 ? (
          <p className="border-t border-ink-line bg-wash-soft px-5 py-3 text-[12.5px] leading-relaxed text-ink-soft">
            <span className="mono font-semibold text-ink">
              {tranche.recvCurrency} {formatMoney(standing.directOnly, tranche.recvCurrency)}
            </span>{" "}
            of this is direct entries, which exist only in this section — they are not in the
            expenditure report, on the landing page figures, or in either company workspace. The
            two totals are meant to differ by exactly this much.
          </p>
        ) : null}

        {standing.state === "overdrawn" ? (
          <p className="border-t border-ink-line bg-red-50 px-5 py-3 text-[12.5px] leading-relaxed text-red-900">
            More has been allocated out of this tranche than was received into it. Allocating
            cannot cause this — it happens when a received figure is corrected downwards or an
            allocation is edited up. Remove or reduce an allocation below, or correct the received
            amount.
          </p>
        ) : null}
      </section>

      {/* ---- provenance ---------------------------------------------------- */}
      {tranche.account || tranche.reference || tranche.notes ? (
        <section className="card mb-5 p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            {tranche.account ? (
              <div>
                <dt className="label">Landed in</dt>
                <dd className="mt-1 text-[13.5px]">{tranche.account}</dd>
              </div>
            ) : null}
            {tranche.reference ? (
              <div>
                <dt className="label">Reference</dt>
                <dd className="mono mt-1 text-[13.5px]">{tranche.reference}</dd>
              </div>
            ) : null}
            {tranche.notes ? (
              <div className="sm:col-span-2">
                <dt className="label">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed">
                  {tranche.notes}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {/* ---- the ledger ---------------------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-line px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold">What this tranche paid for</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {allocations.length === 0
                ? "Nothing allocated yet."
                : `${allocations.length} ${allocations.length === 1 ? "allocation" : "allocations"}, newest first.`}
            </p>
          </div>
          {!tranche.deletedAt ? (
            <Link
              href={`/funding/expenses/new?tranche=${tranche.id}`}
              className="btn btn-ghost px-3 py-2 text-[13px]"
            >
              Add a direct entry
            </Link>
          ) : null}
        </header>

        {allocations.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-soft">
            Nothing has been attributed to this tranche.{" "}
            <Link
              href={`/funding/allocate?tranche=${tranche.id}`}
              className="underline underline-offset-2 hover:text-ink"
            >
              Allocate some expenses
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-ink-line">
            {allocations.map((a) => (
              <LedgerRow key={a.id} allocation={a} tranche={tranche} />
            ))}
          </ul>
        )}
      </section>

      {/* ---- closing ------------------------------------------------------- */}
      {!tranche.deletedAt ? (
        <section className="card p-5">
          {tranche.closedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-[13px] leading-relaxed text-ink-soft">
                Closed on {formatDate(tranche.closedAt.slice(0, 10))}
                {standing.remaining > 0 ? (
                  <>
                    {" "}
                    with{" "}
                    <span className="mono font-semibold text-ink">
                      {tranche.recvCurrency}{" "}
                      {formatMoney(standing.remaining, tranche.recvCurrency)}
                    </span>{" "}
                    unspent. That money still counts as received; it is simply no longer offered
                    when allocating.
                  </>
                ) : (
                  "."
                )}
              </p>
              <form action={reopen}>
                <button type="submit" className="btn btn-ghost">
                  Reopen
                </button>
              </form>
            </div>
          ) : standing.remaining > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-[13px] leading-relaxed text-ink-soft">
                <strong className="font-semibold text-ink">Done with this tranche?</strong> Closing
                it stops it being offered when allocating and states the leftover on the card. The
                money is not moved anywhere — it never moved in the bank — and you can reopen it
                whenever something turns out to fit.
              </p>
              <form action={close}>
                <button type="submit" className="btn btn-ghost">
                  Close with {tranche.recvCurrency}{" "}
                  {formatMoney(standing.remaining, tranche.recvCurrency)} left
                </button>
              </form>
            </div>
          ) : (
            <p className="text-[13px] text-ink-soft">
              This tranche is fully spent, so it has already dropped out of the picker on its own.
              Nothing to close.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="label">{label}</dt>
      <dd className="mono mt-1.5 text-[18px] font-semibold leading-tight">{value}</dd>
      {hint ? <p className="mt-1 text-[11.5px] text-ink-soft">{hint}</p> : null}
    </div>
  );
}

/** Where a source document lives, or null for one that has none. */
function sourceHref(a: Allocation): string | null {
  if (a.sourceKind === "direct") return `/funding/expenses/${a.sourceId}`;
  if (a.sourceKind === "food") return `/food/${a.sourceId}`;
  if (!a.sourceCompany) return null;
  if (a.sourceKind === "voucher") return `/${a.sourceCompany}/vouchers/${a.sourceId}`;
  return `/${a.sourceCompany}/po/${a.sourceId}`;
}

/**
 * One debit.
 *
 * Two figures where the currencies differ and one where they do not, because
 * printing "PKR 62,400 → PKR 62,400" on every food entry would bury the two
 * rows a month where the conversion actually happened.
 *
 * "Part of" appears whenever this row covers less than the whole document —
 * which is how a split reads from inside a bucket, and the only way to tell at a
 * glance that the rest of that expense is sitting in another one.
 */
function LedgerRow({ allocation: a, tranche }: { allocation: Allocation; tranche: Tranche }) {
  const href = sourceHref(a);
  const converted = a.sourceCurrency !== tranche.recvCurrency;
  const partial =
    a.sourceTotal != null && Math.round(a.sourceAmount * 100) < Math.round(a.sourceTotal * 100);

  const remove = removeAllocation.bind(null, a.id, tranche.id);

  return (
    <li className="flex flex-wrap items-start gap-x-5 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {href ? (
            <Link
              href={href}
              className="mono text-[13.5px] font-semibold underline decoration-ink-line underline-offset-2 hover:decoration-current"
            >
              {a.sourceRef}
            </Link>
          ) : (
            <span className="mono text-[13.5px] font-semibold">{a.sourceRef}</span>
          )}
          <span className="chip chip-neutral">{SOURCE_LABELS[a.sourceKind]}</span>
          {a.sourceCompany ? (
            <span className="text-[12px] text-ink-soft">
              {COMPANIES[a.sourceCompany].name}
            </span>
          ) : null}
          {partial ? (
            <span
              className="chip chip-pending"
              title="Only part of this expense came out of this tranche. The rest is in another one, or not yet allocated."
            >
              part of {a.sourceCurrency} {formatMoney(a.sourceTotal, a.sourceCurrency)}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[13px] text-ink-soft">
          {a.sourceDate ? `${formatDate(a.sourceDate)} · ` : ""}
          {a.sourceLabel || "—"}
        </p>
        {a.note ? <p className="mt-1 text-[12.5px] text-ink-soft">{a.note}</p> : null}
      </div>

      <div className="shrink-0 text-right">
        <p className="mono text-[14.5px] font-semibold">
          {tranche.recvCurrency} {formatMoney(a.amount, tranche.recvCurrency)}
        </p>
        {converted ? (
          <p className="mono mt-0.5 text-[11.5px] text-ink-soft">
            {a.sourceCurrency} {formatMoney(a.sourceAmount, a.sourceCurrency)} @{" "}
            {formatMoney(a.rate, tranche.recvCurrency)}
          </p>
        ) : null}
      </div>

      {!tranche.deletedAt ? (
        <form action={remove} className="shrink-0">
          <button
            type="submit"
            className="btn btn-quiet px-2.5 py-1.5 text-[12.5px] hover:!bg-red-50 hover:!text-red-700"
            aria-label={`Remove the allocation of ${a.sourceRef}`}
          >
            Remove
          </button>
        </form>
      ) : null}
    </li>
  );
}
