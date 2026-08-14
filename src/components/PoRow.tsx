import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import { dueIn, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { deletePo, restorePo } from "@/lib/po/actions";
import { PO_STATUS_LABELS, type PurchaseOrder } from "@/lib/po/types";

/**
 * One purchase order in a list.
 *
 * Shared by the Open and History screens so a PO reads the same wherever it
 * appears — the alternative is two row layouts that slowly stop agreeing on
 * what matters about an order.
 */
export default function PoRow({ po, company }: { po: PurchaseOrder; company: string }) {
  const drop = deletePo.bind(null, po.id);
  const undelete = restorePo.bind(null, po.id);

  // Only an issued order can be late; a draft has not been promised to anyone
  // and a closed one has already been dealt with.
  const due = po.status === "issued" ? dueIn(po.doc.deliveryDate) : null;
  const stale = Boolean(po.pdfKey && po.pdfAt && po.pdfAt < po.updatedAt);

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/${company}/po/${po.id}`}
        className="row-link"
      >
        <div className="min-w-[10.5rem]">
          <div className="mono text-[14.5px] font-semibold">{po.poNo}</div>
          <div className="mono mt-0.5 text-[12px] text-ink-soft">
            {formatDate(po.doc.poDate) || "No date"}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">
            {po.doc.vendor.name || <span className="italic text-ink-soft">No vendor named</span>}
          </div>
          <div className="truncate text-[12.5px] text-ink-soft">
            {po.doc.subject || po.internalNote || "—"}
          </div>
        </div>

        <div className="mono min-w-[7.5rem] text-right text-[13.5px] font-medium">
          {po.total > 0 ? (
            `${po.doc.currency} ${formatMoney(po.total, po.doc.currency)}`
          ) : (
            <span className="font-normal text-ink-soft">—</span>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {due && due.days < 0 ? (
          <span className="chip bg-red-100 text-red-900">{due.label}</span>
        ) : due && due.days <= 3 ? (
          <span className="chip bg-amber-100 text-amber-900">{due.label}</span>
        ) : null}

        {stale ? (
          <span
            className="chip bg-amber-100 text-amber-900"
            title="Edited since the PDF was rendered"
          >
            PDF outdated
          </span>
        ) : null}

        {/* An order marked done with nothing on file to show it arrived. */}
        {po.status === "closed" && !po.invoiceKey && !po.deletedAt ? (
          <span className="chip bg-amber-100 text-amber-900" title="Closed with no invoice on file">
            No invoice
          </span>
        ) : null}

        {po.deletedAt ? (
          <span className="chip bg-red-100 text-red-900">Deleted</span>
        ) : (
          <span className={`chip ${STATUS_CLASS[po.status]}`}>{PO_STATUS_LABELS[po.status]}</span>
        )}

        {po.deletedAt ? (
          <form action={undelete}>
            <button type="submit" className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]">
              Restore
            </button>
          </form>
        ) : (
          <ConfirmDelete action={drop} subject={po.poNo} compact />
        )}
      </div>
    </li>
  );
}

const STATUS_CLASS: Record<string, string> = {
  draft: "chip-neutral",
  issued: "chip-pending",
  closed: "chip-completed",
  cancelled: "bg-red-100 text-red-900",
};
