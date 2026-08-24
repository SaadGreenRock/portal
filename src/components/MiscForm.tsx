import Link from "next/link";
import ReceiptField from "@/components/ReceiptField";
import type { MiscFields } from "@/lib/misc/types";
import { CURRENCY_LIST } from "@/lib/money";

/**
 * The miscellaneous payment form.
 *
 * Shared by "New payment" and the correction form on a record.
 *
 * A server component, unlike `FoodForm`. That one has to be a client component
 * because its settlement fields mean nothing while an entry is pending and have
 * to disable themselves; there is no such pair here — a payment has no status,
 * so nothing on this form depends on what anything else on it says. The one bit
 * of JavaScript is inside `ReceiptField`, which shrinks a phone photograph
 * before the form posts it.
 *
 * Four fields, and the shortest form in the portal. That is the module: if a
 * payment needs a payee, a signature and a description of the task, it needs a
 * voucher — which the note under the button says out loud, because a shorter
 * form is a standing temptation to use the wrong one.
 *
 * `required` and `maxLength` mirror what the action enforces. The action is
 * still the authority; the attributes exist so the operator is told early, not
 * so the server can trust the post.
 */
export default function MiscForm({
  action,
  payment,
  company,
  submitLabel,
  cancelHref,
  paymentNo,
  /**
   * Whether to offer the receipt picker.
   *
   * On for a new payment, where a receipt in hand should not need a second
   * screen. Off on a record, which has its own Proof of payment panel — the one
   * that can also replace and remove — and where a second picker would be two
   * ways to do one thing, with only one of them able to clear what is there.
   */
  withProof = false,
}: {
  action: (form: FormData) => Promise<void>;
  payment: MiscFields;
  /** Named in the hint under the amount, so the money has a visible owner. */
  company: string;
  submitLabel: string;
  cancelHref: string;
  /** The number already assigned, shown read-only. `null` before it exists. */
  paymentNo: string | null;
  withProof?: boolean;
}) {
  return (
    <form action={action} className="card p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="label mb-1.5">Payment number</p>
          <p className="mono text-[15px] font-semibold">
            {paymentNo ?? (
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
            defaultValue={payment.date}
            required
            className="input"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            When the money actually went out, not today.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label className="label mb-1.5" htmlFor="amount">
              Amount
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              defaultValue={payment.amount || ""}
              required
              placeholder="1500"
              className="input mono"
            />
          </div>
          <div>
            <label className="label mb-1.5" htmlFor="currency">
              Currency
            </label>
            <select
              id="currency"
              name="currency"
              defaultValue={payment.currency}
              className="input"
            >
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          <p className="col-span-2 -mt-1 text-[12.5px] text-ink-soft">
            Out of {company}. Currencies are never added together in the totals.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="notes">
            What it was for
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={payment.notes}
            required
            maxLength={1000}
            rows={3}
            placeholder="Parking at the Ministry, three hours, while submitting the tender documents"
            className="input resize-y"
          />
          {/* Required where a food entry's notes are optional, and worth saying
              why: that entry still has a vendor and an order beside it, and this
              record has nothing else at all. */}
          <p className="mt-1.5 text-[12.5px] text-ink-soft">
            The only description this record has. Write it for somebody reading
            the ledger next year.
          </p>
        </div>

        {withProof ? (
          <div className="sm:col-span-2">
            <ReceiptField
              id="proof"
              name="proof"
              label="Receipt or bill"
              hint="Optional — plenty of these never have one. Photo or PDF, shrunk automatically."
            />
          </div>
        ) : null}
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
