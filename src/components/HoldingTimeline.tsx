import {
  CONDITION_LABELS,
  isOpen,
  type AssetHolding,
} from "@/lib/assets/types";
import { formatDate, spanInDays } from "@/lib/format";

/**
 * One asset's holdings, newest first — who had it, from when to when.
 *
 * The open holding leads and reads "→ present" rather than being left blank,
 * because a missing end date and an unknown end date look the same otherwise.
 */
export default function HoldingTimeline({ holdings }: { holdings: AssetHolding[] }) {
  if (holdings.length === 0) {
    return (
      <div className="card px-5 py-8 text-center">
        <p className="text-[13.5px] text-ink-soft">No holdings recorded.</p>
      </div>
    );
  }

  return (
    <ol className="card divide-y divide-ink-line">
      {holdings.map((h) => {
        const open = isOpen(h);
        const span = spanInDays(h.allottedOn, h.returnedOn);

        return (
          <li key={h.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">
                {h.employeeName}
                {h.employeeNo ? (
                  <span className="mono font-normal text-ink-soft"> · {h.employeeNo}</span>
                ) : null}
              </div>
              {h.note ? (
                <div className="mt-0.5 text-[12.5px] text-ink-soft">{h.note}</div>
              ) : null}
            </div>

            <div className="mono shrink-0 text-[12.5px] text-ink-soft">
              {formatDate(h.allottedOn) || "unknown"} →{" "}
              {open ? (
                <span className="font-semibold text-ink">present</span>
              ) : (
                formatDate(h.returnedOn) || "unknown"
              )}
              {span ? <span className="ml-1.5">({span})</span> : null}
            </div>

            <div className="shrink-0">
              {open ? (
                <span className="chip chip-pending">Out</span>
              ) : h.condition !== "good" ? (
                <span className="chip bg-red-100 text-red-900">
                  {CONDITION_LABELS[h.condition]}
                </span>
              ) : (
                <span className="chip chip-completed">Returned</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
