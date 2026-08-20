"use client";

import Link from "next/link";
import { COMPANY_LIST } from "@/lib/companies";
import { CURRENCY_LIST } from "@/lib/money";
import type { DirectFields } from "@/lib/tranches/types";

/**
 * The form for a direct entry — an expense that exists only in this ledger.
 *
 * A client component only because it takes a datalist and a company select that
 * read better with the same idioms as the food form; nothing here depends on
 * JavaScript, and the fields are ordinary named inputs posting to a server
 * action.
 *
 * `company` is offered as a label and stored as one. It is never parsed into an
 * accounting split — the same rule the food log's `orderedFor` follows, and for
 * the same reason: a shared cost split on a rule nobody agreed to is worse than
 * a shared cost reported once.
 */

function Optional() {
  return (
    <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-soft">optional</span>
  );
}

export default function DirectForm({
  action,
  entry,
  entryNo,
  payees,
  submitLabel,
  cancelHref,
  /** Set when logging from inside a tranche: the bucket it will be allocated to. */
  tranche,
}: {
  action: (form: FormData) => Promise<void>;
  entry: DirectFields;
  entryNo: string | null;
  payees: string[];
  submitLabel: string;
  cancelHref: string;
  tranche?: { id: string; trancheNo: string; recvCurrency: string } | null;
}) {
  return (
    <form action={action} className="card p-5 sm:p-6">
      {tranche ? <input type="hidden" name="tranche" value={tranche.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="label mb-1.5">Entry number</p>
          <p className="mono text-[15px] font-semibold">
            {entryNo ?? (
              <span className="text-[14px] font-normal text-ink-soft">
                Assigned when you save, and permanent afterwards.
              </span>
            )}
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="date">
            Date paid
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={entry.date}
            required
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="payee">
            Paid to
          </label>
          <input
            id="payee"
            name="payee"
            defaultValue={entry.payee}
            list="direct-payees"
            required
            maxLength={200}
            autoComplete="off"
            className="input"
          />
          <datalist id="direct-payees">
            {payees.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="details">
            What it was for
          </label>
          <input
            id="details"
            name="details"
            defaultValue={entry.details}
            required
            maxLength={500}
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="amount">
            Amount
          </label>
          <div className="flex gap-2">
            <select
              name="currency"
              defaultValue={entry.currency}
              aria-label="Currency"
              className="input w-[7.5rem] shrink-0"
            >
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            <input
              id="amount"
              name="amount"
              inputMode="decimal"
              defaultValue={entry.amount || ""}
              required
              className="input mono"
            />
          </div>
          {/* Said here rather than discovered on the next screen: the entry is
              written either way, but only a matching currency can be attributed
              in the same act. */}
          {tranche ? (
            <p className="mt-1.5 text-[12.5px] text-ink-soft">
              {tranche.trancheNo} received {tranche.recvCurrency}. An entry in another currency is
              still saved, but you will need to allocate it separately with a rate.
            </p>
          ) : null}
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="company">
            Company
            <Optional />
          </label>
          <select id="company" name="company" defaultValue={entry.company ?? ""} className="input">
            <option value="">Neither in particular</option>
            {COMPANY_LIST.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            A label only. Nothing is ever split between the companies on the strength of it.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="notes">
            Notes
            <Optional />
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={entry.notes ?? ""}
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
