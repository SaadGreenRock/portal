import Link from "next/link";
import ConfirmDelete from "@/components/ConfirmDelete";
import { deleteAsset, restoreAsset } from "@/lib/assets/actions";
import { CONDITION_LABELS, inStock, type Asset } from "@/lib/assets/types";
import { formatDate, spanInDays } from "@/lib/format";

/**
 * One asset on the register.
 *
 * Reads as the sentence the register exists to answer: this number, this thing,
 * is with this person, since this date. An asset nobody has says so plainly
 * rather than showing an empty column, because "in stock" is an answer.
 */
export default function AssetRow({ asset, company }: { asset: Asset; company: string }) {
  const drop = deleteAsset.bind(null, asset.id);
  const undelete = restoreAsset.bind(null, asset.id);

  const free = inStock(asset);
  const held = free ? "" : spanInDays(asset.heldSince, "");

  return (
    <li className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <Link
        href={`/${company}/assets/${asset.id}`}
        className="row-link"
      >
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
            <span className={`chip ${free ? "bg-[#ececeb] text-ink" : "chip-pending"}`}>
              {free ? "In stock" : "Out"}
            </span>
            <ConfirmDelete action={drop} subject={asset.assetNo} compact />
          </>
        )}
      </div>
    </li>
  );
}
