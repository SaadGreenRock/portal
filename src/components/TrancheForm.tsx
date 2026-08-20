"use client";

import Link from "next/link";
import { useState } from "react";
import { CURRENCY_LIST, formatMoney } from "@/lib/money";
import type { TrancheFields } from "@/lib/tranches/types";

/**
 * The form for logging or correcting a tranche.
 *
 * A client component for one reason, and it is the reason the whole module
 * exists: the rate. Typing 10,000 dollars and 2,790,000 rupees means an
 * effective rate of ₨ 279.00, and seeing that figure appear as you type is how a
 * transposed digit gets caught — before the bucket is written and expenses start
 * being attributed against it. A rate that only showed up on the next screen
 * would be checked by nobody.
 *
 * The rate is shown, never typed. Stored as a third field it could disagree with
 * the two numbers beside it after a correction; derived, it cannot. It is also
 * automatically the *effective* rate: the received figure is what actually
 * landed in the account, so whatever the bank took on the way in is already
 * inside it. That is why there is no "bank charges" box — a gross amount plus a
 * fee gives two ways to state one thing, and the statement only agrees with one.
 *
 * Everything else is an ordinary named input posting to a server action, so the
 * form still submits if the JavaScript never loads.
 */

function Optional() {
  return (
    <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-soft">optional</span>
  );
}

export default function TrancheForm({
  action,
  tranche,
  trancheNo,
  submitLabel,
  cancelHref,
  id,
}: {
  action: (form: FormData) => Promise<void>;
  tranche: TrancheFields;
  /** The number already assigned, shown read-only. `null` before it exists. */
  trancheNo: string | null;
  submitLabel: string;
  cancelHref: string;
  /** Present when editing. */
  id?: string;
}) {
  const [sent, setSent] = useState(String(tranche.sentAmount || ""));
  const [sentCurrency, setSentCurrency] = useState(tranche.sentCurrency);
  const [recv, setRecv] = useState(String(tranche.recvAmount || ""));
  const [recvCurrency, setRecvCurrency] = useState(tranche.recvCurrency);

  const num = (v: string) => {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const sentValue = num(sent);
  const recvValue = num(recv);
  const rate = sentValue > 0 && recvValue > 0 ? recvValue / sentValue : null;

  return (
    <form action={action} className="card p-5 sm:p-6">
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="label mb-1.5">Tranche number</p>
          <p className="mono text-[15px] font-semibold">
            {trancheNo ?? (
              <span className="text-[14px] font-normal text-ink-soft">
                Assigned when you save, and permanent afterwards.
              </span>
            )}
          </p>
        </div>

        {/* ---- what was sent --------------------------------------------- */}
        <div className="sm:col-span-2">
          <p className="label border-t border-ink-line pt-4">What the investor sent</p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="sentAmount">
            Amount sent
          </label>
          <div className="flex gap-2">
            <select
              name="sentCurrency"
              value={sentCurrency}
              onChange={(e) => setSentCurrency(e.target.value)}
              aria-label="Currency sent"
              className="input w-[7.5rem] shrink-0"
            >
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            <input
              id="sentAmount"
              name="sentAmount"
              inputMode="decimal"
              value={sent}
              onChange={(e) => setSent(e.target.value)}
              required
              placeholder="10000"
              className="input mono"
            />
          </div>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="sentDate">
            Date sent
            <Optional />
          </label>
          <input
            id="sentDate"
            name="sentDate"
            type="date"
            defaultValue={tranche.sentDate}
            className="input"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            Leave blank if you are logging this the day it landed and haven&rsquo;t looked it up.
          </p>
        </div>

        {/* ---- what was received ----------------------------------------- */}
        <div className="sm:col-span-2">
          <p className="label border-t border-ink-line pt-4">What landed in the account</p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="recvAmount">
            Amount received
          </label>
          <div className="flex gap-2">
            <select
              name="recvCurrency"
              value={recvCurrency}
              onChange={(e) => setRecvCurrency(e.target.value)}
              aria-label="Currency received"
              className="input w-[7.5rem] shrink-0"
            >
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            <input
              id="recvAmount"
              name="recvAmount"
              inputMode="decimal"
              value={recv}
              onChange={(e) => setRecv(e.target.value)}
              required
              placeholder="2790000"
              className="input mono"
            />
          </div>
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            What actually cleared, after the bank&rsquo;s charges. That is the money you have to
            spend.
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="recvDate">
            Date received
          </label>
          <input
            id="recvDate"
            name="recvDate"
            type="date"
            defaultValue={tranche.recvDate}
            required
            className="input"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            Orders the tranches, and a split fills the oldest open one first.
          </p>
        </div>

        {/* ---- the derived figure ---------------------------------------- */}
        <div className="sm:col-span-2">
          <div
            className={`rounded-lg border px-4 py-3 transition-colors ${
              rate ? "border-ink-line bg-wash-soft" : "border-dashed border-ink-line"
            }`}
            aria-live="polite"
          >
            <p className="label">Effective rate</p>
            {rate ? (
              <>
                <p className="mono mt-1 text-[19px] font-bold">
                  {recvCurrency} {formatMoney(rate, recvCurrency)}
                  <span className="ml-1.5 text-[13px] font-normal text-ink-soft">
                    per 1 {sentCurrency}
                  </span>
                </p>
                <p className="mt-1 text-[12.5px] text-ink-soft">
                  Worked out from the two figures above, so it can never disagree with them —
                  and it already includes whatever the bank took.
                </p>
              </>
            ) : (
              <p className="mt-1 text-[13.5px] text-ink-soft">
                Fill in both amounts and the rate appears here. Check it before saving.
              </p>
            )}
          </div>
        </div>

        {/* ---- provenance ------------------------------------------------ */}
        <div className="sm:col-span-2">
          <p className="label border-t border-ink-line pt-4">For the record</p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="label">
            Label
            <Optional />
          </label>
          <input
            id="label"
            name="label"
            defaultValue={tranche.label}
            maxLength={160}
            placeholder="July wire"
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="funder">
            Sent by
            <Optional />
          </label>
          <input
            id="funder"
            name="funder"
            defaultValue={tranche.funder}
            maxLength={160}
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="account">
            Landed in
            <Optional />
          </label>
          <input
            id="account"
            name="account"
            defaultValue={tranche.account ?? ""}
            maxLength={200}
            placeholder="Meezan current — 0123"
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="reference">
            Reference
            <Optional />
          </label>
          <input
            id="reference"
            name="reference"
            defaultValue={tranche.reference ?? ""}
            maxLength={200}
            placeholder="SWIFT / advice number"
            className="input"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="notes">
            Notes
            <Optional />
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={tranche.notes ?? ""}
            rows={3}
            maxLength={2000}
            className="input resize-y"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink-line pt-5">
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
        <Link href={cancelHref} className="btn btn-quiet">
          Cancel
        </Link>
      </div>
    </form>
  );
}
