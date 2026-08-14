import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import { formatDate } from "@/lib/format";
import { deleteNotification, restoreNotification } from "@/lib/notifications/actions";
import { TAG_LABELS, type Notification } from "@/lib/notifications/types";

const TAG_CLASS: Record<string, string> = {
  notice: "chip-neutral",
  announcement: "chip-neutral",
  "action-required": "bg-amber-100 text-amber-900",
  urgent: "bg-red-100 text-red-900",
};

/** One notification in a list. Shared by History so a row reads the same
 *  wherever it appears. */
export default function NotificationRow({
  notification: n,
  company,
}: {
  notification: Notification;
  company: string;
}) {
  const drop = deleteNotification.bind(null, n.id);
  const undelete = restoreNotification.bind(null, n.id);

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/${company}/notifications/${n.id}`}
        className="row-link"
      >
        <div className="min-w-[10.5rem]">
          <div className="mono text-[14.5px] font-semibold">{n.notifNo}</div>
          <div className="mono mt-0.5 text-[12px] text-ink-soft">
            {formatDate(n.notifyDate) || formatDate(n.createdAt.slice(0, 10))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">
            {n.headline || <span className="italic text-ink-soft">No headline</span>}
          </div>
          <div className="truncate text-[12.5px] text-ink-soft">{n.sender || "Management"}</div>
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!n.pngKey || !n.pdfKey ? (
          <span
            className="chip bg-amber-100 text-amber-900"
            title="One or both files did not finish rendering"
          >
            Not rendered
          </span>
        ) : null}

        {n.deletedAt ? (
          <span className="chip bg-red-100 text-red-900">Deleted</span>
        ) : (
          <span className={`chip ${TAG_CLASS[n.tag]}`}>{TAG_LABELS[n.tag]}</span>
        )}

        {n.deletedAt ? (
          <form action={undelete}>
            <button type="submit" className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]">
              Restore
            </button>
          </form>
        ) : (
          <ConfirmDelete action={drop} subject={n.notifNo} compact />
        )}
      </div>
    </li>
  );
}
