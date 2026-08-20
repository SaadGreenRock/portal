import Link from "next/link";
import DrawdownBar from "@/components/DrawdownBar";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import TrancheChip from "@/components/TrancheChip";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  queue,
  queueTotals,
  stand,
  summariseFunding,
  type TrancheStanding,
} from "@/lib/tranches/types";

/**
 * Every tranche, and the portfolio line above them.
 *
 * The portfolio line keeps its currencies apart for the same reason the
 * expenditure report does: one figure adding dollars to rupees looks more
 * authoritative than either of its parts and means nothing at all. The blended
 * rate is shown only when there is a single currency pair to blend, and it is
 * deliberately absent from every individual bucket — attributing a July expense
 * at a September rate produces a number nobody can check against a statement.
 *
 * The work queue sits between the summary and the buckets, because it is the
 * only thing on this screen that is a task rather than a fact.
 */
export default async function Funding() {
  const db = await store();

  const ledgerResult = await tryTable(() => db.fundingLedger());
  if (!ledgerResult.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;

  const standings: TrancheStanding[] = ledgerResult.value.map((l) => stand(l.tranche, l.debits));
  const summary = summariseFunding(standings);

  // Tolerated separately: the buckets are readable even if an expense module
  // this reads from has not been migrated, and a work queue is not the place to
  // break that news.
  const itemsResult = await tryTable(() => db.allocatable());
  const queued = itemsResult.ok ? queue(itemsResult.value) : [];
  const queuedTotals = queueTotals(queued);

  if (standings.length === 0) {
    return (
      <div className="card mx-auto max-w-xl px-6 py-12 text-center">
        <h2 className="text-[17px] font-semibold">No tranches logged yet</h2>
        <p className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          A tranche is one arrival of investor money: how many dollars were sent, and how many
          rupees landed against them. Log the first one and every expense in the portal becomes
          something you can attribute to it.
        </p>
        <Link href="/funding/new" className="btn btn-primary mt-6">
          Log the first tranche
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* ---- the portfolio ------------------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <header className="border-b border-ink-line px-5 py-4">
          <h2 className="text-[16px] font-semibold">Everything received</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {summary.counts.tranches} {summary.counts.tranches === 1 ? "tranche" : "tranches"},{" "}
            {summary.counts.open} still open.
          </p>
        </header>

        <dl className="grid gap-px bg-ink-line sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Sent" totals={summary.sent} />
          <Figure label="Received" totals={summary.received} />
          <Figure label="Allocated" totals={summary.allocated} />
          <Figure
            label="Left to spend"
            totals={summary.available}
            hint="in open tranches"
            emphasis
          />
        </dl>

        {summary.blendedRate ? (
          <p className="border-t border-ink-line px-5 py-3 text-[12.5px] text-ink-soft">
            Blended rate across every tranche:{" "}
            <span className="mono font-semibold text-ink">
              {summary.received[0].currency} {formatMoney(summary.blendedRate, "PKR")}
            </span>{" "}
            to one {summary.sent[0].currency}. A headline only — each tranche is always reported
            at its own rate, because that is the one a bank statement will agree with.
          </p>
        ) : null}

        {summary.counts.closedWithRemainder > 0 ? (
          <p className="border-t border-ink-line bg-wash-soft px-5 py-3 text-[12.5px] text-ink-soft">
            {summary.counts.closedWithRemainder}{" "}
            {summary.counts.closedWithRemainder === 1 ? "tranche was" : "tranches were"} closed
            with money still in {summary.counts.closedWithRemainder === 1 ? "it" : "them"} —{" "}
            <span className="mono">
              {summary.received[0]?.currency ?? "PKR"}{" "}
              {formatMoney(summary.counts.closedRemainder)}
            </span>{" "}
            altogether. It still counts in Received above; it is not available to allocate.
          </p>
        ) : null}
      </section>

      {/* ---- the one task on this screen ---------------------------------- */}
      {queued.length > 0 ? (
        <Link
          href="/funding/allocate"
          className="card card-link mb-5 flex flex-wrap items-center gap-4 px-5 py-4"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold">
              {queued.length} {queued.length === 1 ? "expense" : "expenses"} not yet in a tranche
            </div>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              Across both companies, the food log and direct entries. Oldest first.
            </p>
          </div>
          <span className="shrink-0 text-right">
            {queuedTotals.map((t) => (
              <span key={t.currency} className="mono block text-[14.5px] font-bold leading-tight">
                {t.currency} {formatMoney(t.total, t.currency)}
              </span>
            ))}
            <span className="mt-0.5 block text-[11.5px] font-normal text-ink-soft">
              still to attribute →
            </span>
          </span>
        </Link>
      ) : null}

      {/* ---- the buckets --------------------------------------------------- */}
      <div className="grid gap-4">
        {standings.map((s) => (
          <TrancheRow key={s.tranche.id} standing={s} />
        ))}
      </div>

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        A tranche&rsquo;s rate is its received amount divided by what was sent, so it already
        includes whatever the bank took on the way in. Cancelled orders are never offered for
        allocation. Direct entries appear here and nowhere else in the portal, so a
        tranche&rsquo;s allocations can exceed what the expenditure report knows about — each
        tranche says by how much.
      </p>
    </>
  );
}

/** One figure in the portfolio strip, per currency. */
function Figure({
  label,
  totals,
  hint,
  emphasis,
}: {
  label: string;
  totals: Array<{ currency: string; total: number }>;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="label">{label}</dt>
      <dd className="mt-1.5">
        {totals.length === 0 ? (
          <span className="text-[13.5px] text-ink-soft">—</span>
        ) : (
          totals.map((t) => (
            <span
              key={t.currency}
              className={`mono block leading-tight ${
                emphasis ? "text-[19px] font-bold" : "text-[17px] font-semibold"
              }`}
            >
              {t.currency} {formatMoney(t.total, t.currency)}
            </span>
          ))
        )}
        {hint ? <span className="mt-1 block text-[11.5px] text-ink-soft">{hint}</span> : null}
      </dd>
    </div>
  );
}

/** One bucket as a card: what it is, where it stands, what it paid for. */
function TrancheRow({ standing }: { standing: TrancheStanding }) {
  const { tranche, rate, allocated, remaining, sentEquivalent, count, directOnly } = standing;

  return (
    <Link href={`/funding/${tranche.id}`} className="card card-link block p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="mono text-[15px] font-bold">{tranche.trancheNo}</span>
            <TrancheChip standing={standing} />
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">
            {tranche.label ? `${tranche.label} · ` : ""}
            received {formatDate(tranche.recvDate)}
            {tranche.funder ? ` from ${tranche.funder}` : ""}
          </p>
        </div>

        <div className="text-right">
          <div className="mono text-[15px] font-semibold">
            {tranche.sentCurrency} {formatMoney(tranche.sentAmount, tranche.sentCurrency)}
            <span className="mx-1.5 font-normal text-ink-soft">→</span>
            {tranche.recvCurrency} {formatMoney(tranche.recvAmount, tranche.recvCurrency)}
          </div>
          {rate ? (
            <div className="mono mt-0.5 text-[12px] text-ink-soft">
              {tranche.recvCurrency} {formatMoney(rate, tranche.recvCurrency)} per{" "}
              {tranche.sentCurrency}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <DrawdownBar standing={standing} />
      </div>

      <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-t border-ink-line pt-3 text-[12.5px]">
        <span className="text-ink-soft">
          {count === 0 ? (
            "Nothing allocated yet"
          ) : (
            <>
              <span className="mono font-semibold text-ink">
                {tranche.recvCurrency} {formatMoney(allocated, tranche.recvCurrency)}
              </span>{" "}
              across {count} {count === 1 ? "allocation" : "allocations"}
              {/* Stated on the card, not just on the record: the gap between
                  this figure and the expenditure report is exactly this. */}
              {directOnly > 0 ? (
                <>
                  , of which{" "}
                  <span className="mono">
                    {tranche.recvCurrency} {formatMoney(directOnly, tranche.recvCurrency)}
                  </span>{" "}
                  is direct
                </>
              ) : null}
            </>
          )}
        </span>
        {/* The figure to quote back to whoever wired the money — they think in
            dollars, and this bucket's own rate is the only honest way there. */}
        {sentEquivalent != null && sentEquivalent > 0 ? (
          <span className="text-ink-soft">
            <span className="mono font-semibold text-ink">
              {tranche.sentCurrency} {formatMoney(sentEquivalent, tranche.sentCurrency)}
            </span>{" "}
            of {tranche.sentCurrency} {formatMoney(tranche.sentAmount, tranche.sentCurrency)} spent
          </span>
        ) : null}
        {remaining < 0 ? null : (
          <span className="mono font-semibold">
            {tranche.recvCurrency} {formatMoney(remaining, tranche.recvCurrency)} left
          </span>
        )}
      </div>
    </Link>
  );
}
