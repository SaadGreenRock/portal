import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import { dueIn, formatDate } from "@/lib/format";
import { deleteRfq, restoreRfq } from "@/lib/rfq/actions";
import { RFQ_STATUS_LABELS, type RequestForQuotation } from "@/lib/rfq/types";
import { usableRfqItems } from "@/lib/rfq/parse";

/**
 * One request in a list. Shared by the Open and History screens so a request
 * reads the same wherever it appears.
 *
 * No money on the row, because there is none on the document — the count of
 * items stands in for a total.
 */
export default function RfqRow({
  rfq,
  company,
}: {
  rfq: RequestForQuotation;
  company: string;
}) {
  const drop = deleteRfq.bind(null, rfq.id);
  const undelete = restoreRfq.bind(null, rfq.id);

  // Only a sent request can be late; a draft has been promised to nobody.
  const due = rfq.status === "sent" ? dueIn(rfq.doc.replyBy) : null;
  const stale = Boolean(rfq.pdfKey && rfq.pdfAt && rfq.pdfAt < rfq.updatedAt);
  const items = usableRfqItems(rfq.doc).length;

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/${company}/rfq/${rfq.id}`}
        className="row-link"
      >
        <div className="min-w-[11rem]">
          <div className="mono text-[14.5px] font-semibold">{rfq.rfqNo}</div>
          <div className="mono mt-0.5 text-[12px] text-ink-soft">
            {formatDate(rfq.doc.rfqDate) || "No date"}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">
            {rfq.doc.subject || <span className="italic text-ink-soft">No subject</span>}
          </div>
          <div className="truncate text-[12.5px] text-ink-soft">{rfq.internalNote || "—"}</div>
        </div>

        <div className="mono min-w-[5.5rem] text-right text-[13px] text-ink-soft">
          {items} {items === 1 ? "item" : "items"}
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {due && due.days < 0 ? (
          <span className="chip bg-red-100 text-red-900">replies {due.label}</span>
        ) : due && due.days <= 3 ? (
          <span className="chip bg-amber-100 text-amber-900">replies {due.label}</span>
        ) : null}

        {stale ? (
          <span
            className="chip bg-amber-100 text-amber-900"
            title="Edited since the PDF was rendered"
          >
            PDF outdated
          </span>
        ) : null}

        {rfq.deletedAt ? (
          <span className="chip bg-red-100 text-red-900">Deleted</span>
        ) : (
          <span className={`chip ${STATUS_CLASS[rfq.status]}`}>
            {RFQ_STATUS_LABELS[rfq.status]}
          </span>
        )}

        {rfq.deletedAt ? (
          <form action={undelete}>
            <button type="submit" className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]">
              Restore
            </button>
          </form>
        ) : (
          <ConfirmDelete action={drop} subject={rfq.rfqNo} compact />
        )}
      </div>
    </li>
  );
}

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-[#ececeb] text-ink",
  sent: "chip-pending",
  closed: "chip-completed",
  cancelled: "bg-red-100 text-red-900",
};
