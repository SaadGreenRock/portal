import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import type { CompanySlug } from "@/lib/companies";
import { formatDate } from "@/lib/format";
import { deleteMisc, restoreMisc } from "@/lib/misc/actions";
import type { MiscPayment } from "@/lib/misc/types";
import { formatMoney } from "@/lib/money";

/**
 * One miscellaneous payment in the log.
 *
 * Reads as the sentence the module exists to answer: on this date, this much
 * left, for this. The amount sits on the right in a fixed column so a column of
 * figures can be scanned down without reading any of the words beside them —
 * the same shape as the food log, deliberately, because they are read the same
 * way.
 *
 * The note is clamped to two lines rather than truncated to one. It is the only
 * description the record has, and a single ellipsed line of it is often not
 * enough to tell two payments apart.
 */
export default function MiscPaymentRow({
  payment,
  company,
}: {
  payment: MiscPayment;
  company: CompanySlug;
}) {
  const drop = deleteMisc.bind(null, company, payment.id);
  const undelete = restoreMisc.bind(null, company, payment.id);

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link href={`/${company}/misc/${payment.id}`} className="row-link">
        <div className="min-w-[7.5rem]">
          <div className="mono text-[14.5px] font-semibold">{formatDate(payment.date)}</div>
          <div className="mono mt-0.5 text-[12px] text-ink-soft">{payment.paymentNo}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13.5px]">{payment.notes}</div>
        </div>

        <div className="mono shrink-0 text-right text-[14.5px] font-semibold">
          {formatMoney(payment.amount, payment.currency)}
          <div className="mt-0.5 text-[11.5px] font-normal text-ink-soft">{payment.currency}</div>
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {payment.deletedAt ? (
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
            {/* Only when something is filed. Marking the others "no receipt"
                would shout at the ordinary case — most of these never have one,
                which is the whole reason the module exists — and turn a normal
                state into a permanent reproach. The log's filter is where that
                question gets asked, by somebody who is asking it. */}
            {payment.proofKey ? (
              <span
                title={`Receipt on file: ${payment.proofName ?? "attached"}`}
                className="chip chip-neutral"
              >
                Receipt
              </span>
            ) : null}
            <ConfirmDelete action={drop} subject={payment.paymentNo} compact />
          </>
        )}
      </div>
    </li>
  );
}
