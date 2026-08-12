import ReceiptField from "@/components/ReceiptField";
import { settleSelected } from "@/lib/food/actions";
import type { OwedGroup } from "@/lib/food/types";
import { formatDate, spanInDays } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * One payee's outstanding tab, and the button that clears it.
 *
 * The reason this module beats the spreadsheet it replaces. A café's tab is a
 * dozen separate orders and one payment; in the sheet, settling it meant editing
 * a dozen rows by hand, which is a dozen chances to miss one. Here it is one
 * click, and the entries that made up the figure are listed above the button so
 * the amount can be checked against what the café is actually asking for.
 *
 * Every box is ticked by default, because settling the whole tab is the normal
 * case. Unticking is for the argument about the one order that never arrived —
 * so a partial settlement needs an explicit act, and a full one needs none.
 *
 * No client JavaScript. `getAll("id")` on the server rebuilds exactly the set
 * that was left ticked, which is the one thing FormData does well.
 */
export default function SettleForm({
  group,
  today,
  currency,
}: {
  group: OwedGroup;
  /** Default payment date. Passed in so the server decides "today", not the browser. */
  today: string;
  currency: string;
}) {
  const waiting = spanInDays(group.since, "");
  const employee = group.paymentType === "employee-paid";
  // Payee names carry spaces and accents — "Kick Start Café" — and these end up
  // in `id`/`htmlFor`, where a bare name would produce duplicate or invalid ids
  // across two groups whose names differ only in punctuation.
  const slug = group.payee.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{group.payee}</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {group.entries.length} {group.entries.length === 1 ? "order" : "orders"} since{" "}
            {formatDate(group.since)}
            {waiting ? ` — ${waiting}` : ""}
          </p>
        </div>
        <p className="mono shrink-0 text-[18px] font-bold">
          {currency} {formatMoney(group.amount, currency)}
        </p>
      </header>

      <form action={settleSelected}>
        <ul className="divide-y divide-ink-line">
          {group.entries.map((entry) => (
            <li key={entry.id}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-[#fafaf8]">
                <input
                  type="checkbox"
                  name="id"
                  value={entry.id}
                  defaultChecked
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="mono w-[5.5rem] shrink-0 text-[12.5px] text-ink-soft">
                  {formatDate(entry.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {entry.details}
                  {entry.orderedFor ? (
                    <span className="text-ink-soft"> · {entry.orderedFor}</span>
                  ) : null}
                </span>
                <span className="mono shrink-0 text-[13.5px] font-semibold">
                  {formatMoney(entry.amount, entry.currency)}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="border-t border-ink-line bg-[#fbfbfa] px-5 py-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[9rem]">
              <label className="label mb-1.5" htmlFor={`paidAt-${slug}`}>
                Paid on
              </label>
              <input
                id={`paidAt-${slug}`}
                name="paidAt"
                type="date"
                defaultValue={today}
                className="input"
              />
            </div>

            <div className="min-w-[10rem] flex-1">
              <label className="label mb-1.5" htmlFor={`reference-${slug}`}>
                Reference <span className="font-normal normal-case">— optional</span>
              </label>
              <input
                id={`reference-${slug}`}
                name="reference"
                maxLength={120}
                placeholder={employee ? "Payroll run, transfer no." : "Cheque or transfer no."}
                className="input mono"
              />
            </div>

            {/* The proof and the payment it proves go in one submission: filing
                the receipt later is how a settled tab ends up with nothing
                behind it. One file covers every entry ticked above. */}
            <ReceiptField id={`receipt-${slug}`} />
          </div>

          <div className="mt-4">
            {/* "Ticked", not the group's total. Without client JavaScript the
                figure on the button cannot follow the checkboxes, and a button
                reading ₨32,970 after unticking half the list would be a lie. The
                total the operator is checking against sits in the header. */}
            <button type="submit" className="btn btn-primary">
              {employee ? "Reimburse ticked" : "Settle ticked"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
