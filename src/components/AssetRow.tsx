import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import { deleteAsset, restoreAsset } from "@/lib/assets/actions";
import { CONDITION_LABELS, inStock, type Asset, type AssetThumb } from "@/lib/assets/types";
import { formatDate, spanInDays } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

/**
 * One asset on the register.
 *
 * Reads as the sentence the register exists to answer: this number, this thing,
 * is with this person, since this date. An asset nobody has says so plainly
 * rather than showing an empty column, because "in stock" is an answer.
 *
 * `leavers` is the set of register entries marked as having left. An asset still
 * out with one of them is the case worth catching on this screen — the laptop
 * really is still in their bag, and nothing else will bring it up.
 */
export default function AssetRow({
  asset,
  company,
  leavers,
  thumb,
}: {
  asset: Asset;
  company: string;
  /** Ids of employees who have left. Empty when the register is unavailable. */
  leavers?: Set<string>;
  /**
   * The asset's newest photograph. Absent for anything never photographed, which
   * is most of the register on the day this ships — so the placeholder has to
   * look deliberate rather than broken.
   */
  thumb?: AssetThumb;
}) {
  const drop = deleteAsset.bind(null, asset.id);
  const undelete = restoreAsset.bind(null, asset.id);

  const free = inStock(asset);
  const held = free ? "" : spanInDays(asset.heldSince, "");
  const withLeaver = !free && Boolean(asset.holderId) && Boolean(leavers?.has(asset.holderId));

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/${company}/assets/${asset.id}`}
        className="row-link"
      >
        {/* The picture leads, where there is one: on a register of physical
            things, what it looks like identifies it faster than its number. */}
        {thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={fileUrl(thumb.key)}
            alt=""
            className="h-10 w-10 shrink-0 rounded-md border border-ink-line bg-wash object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-ink-line text-ink-soft"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
          </span>
        )}

        <div className="min-w-[8.5rem]">
          <div className="mono text-[14.5px] font-semibold">{asset.assetNo}</div>
          <div className="mono mt-0.5 text-[12px] text-ink-soft">
            {free ? "in stock" : formatDate(asset.heldSince) || "no date"}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">{asset.assetName}</div>
          <div className="truncate text-[12.5px] text-ink-soft">
            {free ? (
              <span className="italic">Nobody has it</span>
            ) : (
              <>
                {asset.holderName}
                {asset.holderNo ? <span className="mono"> · {asset.holderNo}</span> : null}
                {held ? ` — ${held}` : ""}
              </>
            )}
          </div>
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Condition only when it is news. Every asset being "Good" would make
            the one that isn't harder to spot, not easier. */}
        {asset.condition !== "good" ? (
          <span className="chip bg-red-100 text-red-900">
            {CONDITION_LABELS[asset.condition]}
          </span>
        ) : null}

        {/* Nothing is auto-returned when somebody leaves: the laptop really is
            still with them, and pretending otherwise is how it stops being
            chased. So it is flagged instead. */}
        {withLeaver ? (
          <span className="chip bg-amber-100 text-amber-900" title="The person holding this has left the company.">
            Holder has left
          </span>
        ) : null}

        {asset.deletedAt ? (
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
            <span className={`chip ${free ? "chip-neutral" : "chip-pending"}`}>
              {free ? "In stock" : "Out"}
            </span>
            <ConfirmDelete action={drop} subject={asset.assetNo} compact />
          </>
        )}
      </div>
    </li>
  );
}
