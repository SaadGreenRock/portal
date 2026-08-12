import Link from "next/link";
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
 * Shared by "Log an entry" and the edit view on a record. A plain
 * server-rendered form with no client JavaScript, like the asset register and
 * unlike the purchase order and quotation editors — those maintain a repeating
 * line-item table and a live preview, which needs state, while this is a dozen
 * fields and a form that submits without JavaScript cannot half-work.
 *
 * `Paid by` is always shown rather than revealed by the payment type, and is not
 * marked `required`. Hiding it would need client state, and requiring it would
 * block the commonest case — a deferred order, where nobody paid out of pocket
 * and there is nothing to put in the box. The action rejects an employee-paid
 * entry with no name, and the hint says so before the round trip.
 *
 * `required` and `maxLength` mirror what the action enforces. The action is
 * still the authority; the attributes exist so the operator is told early, not
 * so the server can trust the post.
 */
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
          <select id="status" name="status" defaultValue={entry.status} className="input">
            {FOOD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FOOD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="paidAt">
            Paid on
          </label>
          <input
            id="paidAt"
            name="paidAt"
            type="date"
            defaultValue={entry.paidAt ?? ""}
            className="input"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            Ignored while pending. Blank on a paid entry means the date is not known.
          </p>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="reference">
            Reference
          </label>
          <input
            id="reference"
            name="reference"
            defaultValue={entry.reference ?? ""}
            maxLength={120}
            placeholder="Cheque or transfer number"
            className="input mono"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="notes">
            Notes
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
