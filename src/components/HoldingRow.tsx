import Link from "next/link";
import { CONDITION_LABELS, isOpen, type HoldingWithAsset } from "@/lib/assets/types";
import { formatDate, spanInDays } from "@/lib/format";

/**
 * One holding on the company-wide history: who had what, from when to when.
 *
 * The asset's number links to its record, where the rest of that asset's chain
 * is. This screen answers "what did Bilal have last year"; the record answers
 * "everyone who has ever had this laptop".
 */
export default function HoldingRow({
  holding,
  company,
}: {
  holding: HoldingWithAsset;
  company: string;
}) {
  const open = isOpen(holding);
  const span = spanInDays(holding.allottedOn, holding.returnedOn);

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/${company}/assets/${holding.assetId}`}
        className="row-link"
      >
        <div className="min-w-[8.5rem]">
          <div className="mono text-[14.5px] font-semibold">{holding.assetNo}</div>
          <div className="truncate text-[12px] text-ink-soft">{holding.assetName}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">
            {holding.employeeName}
            {holding.employeeNo ? (
              <span className="mono text-ink-soft"> · {holding.employeeNo}</span>
            ) : null}
          </div>
          {holding.note ? (
            <div className="truncate text-[12.5px] text-ink-soft">{holding.note}</div>
          ) : null}
        </div>

        <div className="mono min-w-[13rem] text-[12.5px] text-ink-soft">
          {formatDate(holding.allottedOn) || "unknown"} →{" "}
          {open ? (
            <span className="font-semibold text-ink">present</span>
          ) : (
            formatDate(holding.returnedOn) || "unknown"
          )}
          {span ? <span className="ml-1.5">({span})</span> : null}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        {open ? (
          <span className="chip chip-pending">Out</span>
        ) : holding.condition !== "good" ? (
          <span className="chip bg-red-100 text-red-900">
            {CONDITION_LABELS[holding.condition]}
          </span>
        ) : (
          <span className="chip chip-completed">Returned</span>
        )}
      </div>
    </li>
  );
}
