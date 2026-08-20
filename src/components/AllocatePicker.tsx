"use client";

import { useMemo, useState } from "react";
import { COMPANIES } from "@/lib/companies";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import {
  allocationState,
  planSplit,
  paisa,
  SOURCE_LABELS,
  unallocated,
  type AllocatableItem,
} from "@/lib/tranches/types";

/**
 * The picker: expenses on the left, a bucket at the bottom, and the arithmetic
 * done in front of you.
 *
 * A client component, and this is the one screen in the section where that is
 * the point rather than a convenience. The question it exists to answer is "does
 * what I have ticked fit in the tranche I have chosen" — and answering that
 * after the post, as a red error page, is answering it too late. So the running
 * total sits against the bucket's balance as you tick, the overflow is named
 * while there is still something to do about it, and the split is offered before
 * it is needed rather than as a recovery from a refusal.
 *
 * Everything is still an ordinary named input inside a form posting to a server
 * action. Without JavaScript the list still submits and the server applies the
 * same two guards; what is lost is only the preview.
 *
 * The amount box defaults to whatever is still unattributed rather than to the
 * document's total, so an expense already half in another bucket offers its
 * remainder and not a figure that would be refused.
 */

export interface PickerBucket {
  id: string;
  trancheNo: string;
  label: string;
  recvCurrency: string;
  remaining: number;
  recvDate: string;
}

const keyOf = (i: AllocatableItem) => `${i.kind}:${i.id}`;

export default function AllocatePicker({
  action,
  items,
  buckets,
  initialTranche,
}: {
  action: (form: FormData) => Promise<void>;
  items: AllocatableItem[];
  /** Open buckets only, oldest received first. */
  buckets: PickerBucket[];
  initialTranche: string | null;
}) {
  const [trancheId, setTrancheId] = useState(
    initialTranche && buckets.some((b) => b.id === initialTranche)
      ? initialTranche
      : (buckets[0]?.id ?? ""),
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [split, setSplit] = useState(false);

  const chosen = buckets.find((b) => b.id === trancheId) ?? null;
  const pool = chosen?.recvCurrency ?? "PKR";

  const num = (v: string | undefined) => {
    if (!v) return 0;
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  /** What each ticked row would draw from the pool, and what is still missing. */
  const plan = useMemo(() => {
    if (!chosen) return null;

    // Same currency as the chosen bucket only — a bucket that received dollars
    // cannot absorb the spill from one that received rupees at a rate nobody
    // stated. Chosen bucket first, then the rest oldest-first, which is the
    // order the server will fill them in.
    const order = [chosen, ...buckets.filter((b) => b.id !== chosen.id && b.recvCurrency === pool)];
    const room = new Map(order.map((b) => [b.id, paisa(b.remaining)]));

    let drawnFromChosen = 0;
    let spilled = 0;
    let unplaced = 0;
    let needsRate = 0;
    const spillInto = new Set<string>();

    // Oldest first, matching the server: the order the money went out.
    const rows = items
      .filter((i) => picked.has(keyOf(i)))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    for (const item of rows) {
      const key = keyOf(item);
      const remainder = unallocated(item);
      const override = num(amounts[key]);

      let portion: number;
      if (item.amount == null) {
        // A voucher whose amount was left blank to be written in at signing.
        // There is no remainder to offer, so the figure has to be typed.
        if (override <= 0) continue;
        portion = override;
      } else {
        if (remainder == null || remainder <= 0) continue;
        portion = override > 0 ? Math.min(override, remainder) : remainder;
      }

      let rate = 1;
      if (item.currency !== pool) {
        rate = num(rates[key]);
        if (rate <= 0) {
          needsRate += 1;
          continue;
        }
      }

      const need = Math.round(portion * rate * 100) / 100;
      const walk = planSplit(
        need,
        (split ? order : [chosen]).map((b) => ({
          trancheId: b.id,
          trancheNo: b.trancheNo,
          remaining: (room.get(b.id) ?? 0) / 100,
        })),
      );

      for (const part of walk.rows) {
        room.set(part.trancheId, (room.get(part.trancheId) ?? 0) - paisa(part.amount));
        if (part.trancheId === chosen.id) drawnFromChosen += paisa(part.amount);
        else {
          spilled += paisa(part.amount);
          spillInto.add(part.trancheNo);
        }
      }
      unplaced += paisa(walk.shortfall);
    }

    return {
      count: rows.length,
      drawnFromChosen: drawnFromChosen / 100,
      spilled: spilled / 100,
      spillInto: [...spillInto],
      unplaced: unplaced / 100,
      needsRate,
      leftAfter: (paisa(chosen.remaining) - drawnFromChosen) / 100,
    };
  }, [items, picked, amounts, rates, split, chosen, buckets, pool]);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (buckets.length === 0) {
    return (
      <div className="card px-6 py-10 text-center">
        <h3 className="text-[16px] font-semibold">No open tranche to allocate to</h3>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          Every tranche is either fully spent or closed. Log the next one and these expenses can
          be attributed to it — until then they stay in this queue, which is the honest state:
          the money has gone out and it has not yet been funded.
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="tranche" value={trancheId} />
      {split ? <input type="hidden" name="split" value="1" /> : null}

      {/* ---- the list ---------------------------------------------------- */}
      <ul className="card divide-y divide-ink-line overflow-hidden">
        {items.length === 0 ? (
          <li className="px-5 py-10 text-center text-[13.5px] text-ink-soft">
            Nothing here. Every expense matching these filters is already in a tranche.
          </li>
        ) : (
          items.map((item) => {
            const key = keyOf(item);
            const state = allocationState(item);
            const remainder = unallocated(item);
            const on = picked.has(key);
            const foreign = item.currency !== pool;

            return (
              <li
                key={key}
                className={`px-5 py-3.5 transition-colors ${on ? "bg-wash-soft" : ""}`}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      name="pick"
                      value={key}
                      checked={on}
                      onChange={() => toggle(key)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="mono text-[13.5px] font-semibold">{item.ref}</span>
                        <span className="chip chip-neutral">{SOURCE_LABELS[item.kind]}</span>
                        {item.company ? (
                          <span className="text-[12px] text-ink-soft">
                            {COMPANIES[item.company].name}
                          </span>
                        ) : null}
                        {state === "part" ? (
                          <span className="chip chip-pending">
                            part allocated ·{" "}
                            {item.placements.map((p) => p.trancheNo).join(", ")}
                          </span>
                        ) : null}
                        {item.amount == null ? (
                          <span
                            className="chip chip-pending"
                            title="This voucher's amount was left blank to be written in by hand, so the portal has no figure for it."
                          >
                            no amount recorded
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[13px] text-ink-soft">
                        {formatDate(item.date)} · {item.party || "—"}
                        {item.description ? ` · ${item.description}` : ""}
                      </span>
                    </span>
                  </label>

                  <div className="shrink-0 text-right">
                    <p className="mono text-[13.5px] font-semibold">
                      {item.amount == null ? (
                        <span className="font-normal text-ink-soft">no figure</span>
                      ) : (
                        `${item.currency} ${formatMoney(item.amount, item.currency)}`
                      )}
                    </p>
                    {item.allocated > 0 && item.amount != null ? (
                      <p className="mono mt-0.5 text-[11.5px] text-ink-soft">
                        {formatMoney(remainder ?? 0, item.currency)} still to attribute
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Only for a ticked row: an override, and a rate when the
                    document's currency is not the bucket's. Hidden until
                    ticked, because a column of empty boxes down an untouched
                    list reads as work waiting to be done. */}
                {on ? (
                  <div className="mt-3 flex flex-wrap items-end gap-3 pl-7">
                    <div>
                      <label
                        className="label mb-1 block"
                        htmlFor={`amount-${key}`}
                      >
                        {item.amount == null ? `Amount paid (${item.currency})` : `Attribute (${item.currency})`}
                      </label>
                      <input
                        id={`amount-${key}`}
                        name={`amount:${key}`}
                        inputMode="decimal"
                        value={amounts[key] ?? ""}
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        placeholder={
                          item.amount == null
                            ? "type what was paid"
                            : formatMoney(remainder ?? 0, item.currency)
                        }
                        className="input mono w-40 py-1.5 text-[13.5px]"
                      />
                    </div>

                    {foreign ? (
                      <div>
                        <label className="label mb-1 block" htmlFor={`rate-${key}`}>
                          Rate ({pool} per {item.currency})
                        </label>
                        <input
                          id={`rate-${key}`}
                          name={`rate:${key}`}
                          inputMode="decimal"
                          value={rates[key] ?? ""}
                          onChange={(e) =>
                            setRates((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder="74.50"
                          className="input mono w-32 py-1.5 text-[13.5px]"
                          required
                        />
                      </div>
                    ) : null}

                    {foreign ? (
                      <p className="max-w-xs pb-1.5 text-[12px] leading-snug text-ink-soft">
                        This is in {item.currency} and the tranche received {pool}. The rate you
                        enter is stored with the row, so the ledger records what it actually cost.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {/* ---- the bucket, and the arithmetic ------------------------------ */}
      <div className="sticky bottom-0 z-10 mt-4 rounded-xl border border-ink-line bg-card p-4 shadow-[var(--lift)] sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[15rem] flex-1">
            <label className="label mb-1.5 block" htmlFor="tranche-choice">
              Allocate to
            </label>
            <select
              id="tranche-choice"
              value={trancheId}
              onChange={(e) => setTrancheId(e.target.value)}
              className="input"
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.trancheNo}
                  {b.label ? ` — ${b.label}` : ""} · {b.recvCurrency}{" "}
                  {formatMoney(b.remaining, b.recvCurrency)} left
                </option>
              ))}
            </select>
          </div>

          <div className="text-right">
            <p className="label">Ticked</p>
            <p className="mono mt-1 text-[19px] font-bold leading-none">
              {pool} {formatMoney(plan?.drawnFromChosen ?? 0, pool)}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-soft">
              {plan?.count ?? 0} {plan?.count === 1 ? "expense" : "expenses"}
            </p>
          </div>

          <div className="text-right">
            <p className="label">Left in {chosen?.trancheNo}</p>
            <p
              className={`mono mt-1 text-[19px] font-bold leading-none ${
                (plan?.leftAfter ?? 0) === 0 && (plan?.count ?? 0) > 0
                  ? "text-emerald-700"
                  : ""
              }`}
            >
              {pool} {formatMoney(plan?.leftAfter ?? chosen?.remaining ?? 0, pool)}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-soft">after this</p>
          </div>

          <button
            type="submit"
            disabled={(plan?.count ?? 0) === 0}
            className="btn btn-primary"
          >
            Allocate
          </button>
        </div>

        {/* The overflow, named while there is still something to do about it. */}
        {plan && (plan.unplaced > 0 || plan.spilled > 0 || plan.needsRate > 0) ? (
          <div className="mt-4 space-y-2 border-t border-ink-line pt-3.5 text-[12.5px] leading-relaxed">
            {plan.needsRate > 0 ? (
              <p className="text-amber-800">
                {plan.needsRate} ticked{" "}
                {plan.needsRate === 1 ? "expense needs" : "expenses need"} a rate before{" "}
                {plan.needsRate === 1 ? "it" : "they"} can be counted — {pool} is not{" "}
                {plan.needsRate === 1 ? "its" : "their"} currency.
              </p>
            ) : null}

            {plan.spilled > 0 ? (
              <p className="text-ink-soft">
                <strong className="font-semibold text-ink">
                  {pool} {formatMoney(plan.spilled, pool)}
                </strong>{" "}
                will not fit in {chosen?.trancheNo} and goes to{" "}
                {plan.spillInto.join(" and ")} instead. An expense that straddles two tranches
                becomes two rows against the one document.
              </p>
            ) : null}

            {plan.unplaced > 0 ? (
              <p className="text-amber-800">
                <strong className="font-semibold">
                  {pool} {formatMoney(plan.unplaced, pool)}
                </strong>{" "}
                {split
                  ? "will not fit in any open tranche and stays unallocated. That is fine — it waits here for the next one."
                  : `does not fit in ${chosen?.trancheNo}. Tick "split across tranches" below to fill it and put the rest in the next one.`}
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 border-t border-ink-line pt-3.5 text-[12.5px] leading-relaxed">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>
            <strong className="font-semibold">Split across tranches when one runs out.</strong>{" "}
            <span className="text-ink-soft">
              Fills {chosen?.trancheNo ?? "the chosen tranche"} to exactly zero, then continues
              into the next open tranche by date. Off, an expense that does not fit is refused
              rather than half-written.
            </span>
          </span>
        </label>
      </div>
    </form>
  );
}
