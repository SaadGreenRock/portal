"use client";

import Link from "next/link";
import { useState } from "react";
import {
  FOOD_STATUSES,
  FOOD_STATUS_LABELS,
  ORDERED_FOR_SUGGESTIONS,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS,
  type FoodFields,
} from "@/lib/food/types";

/**
 * The food entry form.
 *
 * Shared by "New entry" and the edit view on a record.
 *
 * A client component for one reason: the settlement pair. `Paid on` and
 * `Reference` mean nothing while an entry is pending, and the action discards
 * them — so leaving them typeable was an invitation to fill in a payment date,
 * press Save, and believe it recorded. They are disabled while the status reads
 * Pending, which needs to know what the status select currently says. Nothing
 * else here depends on JavaScript: the fields are ordinary named inputs posting
 * to a server action, so the form still submits if it never loads.
 *
 * `Paid by` stays visible in both states rather than being revealed by the
 * payment type. Requiring it would block the commonest case — a deferred order,
 * where nobody paid out of pocket and there is nothing to put in the box — and
 * the action rejects an employee-paid entry with no name anyway.
 *
 * `required` and `maxLength` mirror what the action enforces. The action is
 * still the authority; the attributes exist so the operator is told early, not
 * so the server can trust the post.
 */

/** Marks the fields the form will accept without. Most are required, so the few that aren't are what's worth saying. */
function Optional() {
  return <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-soft">optional</span>;
}

export default function FoodForm({
  action,
  entry,
  vendors,
  payers,
  orderedFor,
  submitLabel,
  cancelHref,
  entryNo,
}: {
  action: (form: FormData) => Promise<void>;
  entry: FoodFields;
  vendors: string[];
  payers: string[];
  orderedFor: string[];
  submitLabel: string;
  cancelHref: string;
  /** The number already assigned, shown read-only. `null` before it exists. */
  entryNo: string | null;
}) {
  // Whatever has been typed before, with the three known labels behind it. A
  // suggestion list, never a constraint — see ORDERED_FOR_SUGGESTIONS.
  const orderedForOptions = [
    ...new Set([...orderedFor, ...ORDERED_FOR_SUGGESTIONS].map((v) => v.trim()).filter(Boolean)),
  ];

  // Only so the settlement pair below knows whether it applies yet. The select
  // remains an ordinary named input; this shadows its value, it does not own it.
  const [status, setStatus] = useState(entry.status);
  const owed = status === "pending";

  return (
    <form action={action} className="card p-5 sm:p-6">
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
            Date ordered
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
          <label className="label mb-1.5" htmlFor="orderedFor">
            Ordered for
            <Optional />
          </label>
          <input
            id="orderedFor"
            name="orderedFor"
            defaultValue={entry.orderedFor}
            list="food-ordered-for"
            maxLength={160}
            autoComplete="off"
            placeholder="Green Rock + Sportech"
            className="input"
          />
          <datalist id="food-ordered-for">
            {orderedForOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            A label for who ate. The cost is never split between the companies.
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="vendor">
            Vendor
          </label>
          <input
            id="vendor"
            name="vendor"
            defaultValue={entry.vendor}
            list="food-vendors"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="Kick Start Café"
            className="input"
          />
          <datalist id="food-vendors">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="amount">
            Total cost (PKR)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            defaultValue={entry.amount || ""}
            required
            placeholder="2413"
            className="input mono"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="details">
            Order details
          </label>
          <input
            id="details"
            name="details"
            defaultValue={entry.details}
            required
            maxLength={500}
            placeholder="Lunch (Multiple Items)"
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="paymentType">
            Payment type
          </label>
          <select
            id="paymentType"
            name="paymentType"
            defaultValue={entry.paymentType}
            className="input"
          >
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="paidBy">
            Paid by
            <Optional />
          </label>
          <input
            id="paidBy"
            name="paidBy"
            defaultValue={entry.paidBy ?? ""}
            list="food-payers"
            maxLength={160}
            autoComplete="off"
            placeholder="Who paid out of pocket"
            className="input"
          />
          <datalist id="food-payers">
            {payers.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            Only for an out-of-pocket payment. Left blank on the vendor&rsquo;s tab.
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="status">
            Payment status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={entry.status}
            onChange={(e) => setStatus(e.target.value as FoodFields["status"])}
            className="input"
          >
            {FOOD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FOOD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {/* Disabled rather than hidden while pending: the pair has to stay
            visible so it is obvious where a payment date will go once there is
            one, and disabled is the honest state — the action discards both on
            a pending entry, so a typeable box was a promise the save broke. */}
        <div>
          <label className="label mb-1.5" htmlFor="paidAt">
            Paid on
            {owed ? null : <Optional />}
          </label>
          <input
            id="paidAt"
            name="paidAt"
            type="date"
            defaultValue={entry.paidAt ?? ""}
            disabled={owed}
            className="input"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            {owed
              ? "Set the status to Paid to fill this in."
              : "Left blank, the date ordered is used."}
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="reference">
            Reference
            {owed ? null : <Optional />}
          </label>
          <input
            id="reference"
            name="reference"
            defaultValue={entry.reference ?? ""}
            maxLength={120}
            disabled={owed}
            placeholder="Cheque or transfer number"
            className="input mono"
          />
          {owed ? (
            <p className="mt-1.5 text-[12.5px] text-ink-soft">
              Set the status to Paid to fill this in.
            </p>
          ) : null}
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
            maxLength={1000}
            rows={2}
            placeholder="Anything worth remembering about this order"
            className="input resize-y"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
        <Link href={cancelHref} className="btn btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
