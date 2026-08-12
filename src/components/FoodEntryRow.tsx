import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import { deleteFood, restoreFood } from "@/lib/food/actions";
import { PAYMENT_TYPE_SHORT, type FoodExpense } from "@/lib/food/types";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * One entry in the food log.
 *
 * Reads as the sentence the log exists to answer: on this date, this vendor fed
 * these people, for this much, and it is settled or it is not. The amount sits
 * on the right in a fixed column so a column of figures can be scanned down
 * without reading any of the words beside them.
 *
 * Who is owed is only shown while pending. Once an entry is settled, "Kick Start
 * Café" is already in the vendor column and repeating it would crowd out the one
 * thing that changed.
 */
export default function FoodEntryRow({ entry }: { entry: FoodExpense }) {
  const drop = deleteFood.bind(null, entry.id);
  const undelete = restoreFood.bind(null, entry.id);

  const pending = entry.status === "pending";
  const owedTo = entry.paymentType === "employee-paid" ? entry.paidBy : entry.vendor;

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/food/${entry.id}`}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 rounded-md hover:opacity-80"
      >
        <div className="min-w-[7.5rem]">
          <div className="mono text-[14.5px] font-semibold">{formatDate(entry.date)}</div>
          <div className="mono mt-0.5 text-[12px] text-ink-soft">{entry.entryNo}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">
            {entry.details}
            {entry.orderedFor ? (
              <span className="text-ink-soft"> · {entry.orderedFor}</span>
            ) : null}
          </div>
          <div className="truncate text-[12.5px] text-ink-soft">
            {entry.vendor}
            {pending && owedTo ? ` — owed to ${owedTo}` : ""}
          </div>
        </div>

        <div className="mono shrink-0 text-right text-[14.5px] font-semibold">
          {formatMoney(entry.amount, entry.currency)}
          <div className="mt-0.5 text-[11.5px] font-normal text-ink-soft">
            {PAYMENT_TYPE_SHORT[entry.paymentType]}
          </div>
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {entry.deletedAt ? (
          <>
            <span className="chip bg-red-100 text-red-900">Deleted</span>
            <form action={undelete}>
              <button type="submit" className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]">
                Restore
              </button>
            </form>
          </>
        ) : (
          <>
            {/* Only on a settled entry, and only when something is filed. A
                pending order has no payment to have proof of, and marking every
                settled one "no receipt" would shout at rows imported from the
                spreadsheet, which never had documents to begin with. */}
            {!pending && entry.receiptKey ? (
              <span
                title={`Receipt on file: ${entry.receiptName ?? "attached"}`}
                className="chip bg-[#ececeb] text-ink"
              >
                Receipt
              </span>
            ) : null}
            <span className={`chip ${pending ? "chip-pending" : "chip-completed"}`}>
              {pending ? "Pending" : "Paid"}
            </span>
            <ConfirmDelete action={drop} subject={entry.entryNo} compact />
          </>
        )}
      </div>
    </li>
  );
}
