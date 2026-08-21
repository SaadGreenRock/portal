import ReceiptField from "@/components/ReceiptField";
import { addAssetPhoto, removeAssetPhoto } from "@/lib/assets/actions";
import type { AssetPhoto } from "@/lib/assets/types";
import { formatDate, todayIso } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

/**
 * An asset's photographs, newest first, and the form that adds one.
 *
 * A log rather than a single picture. One photo says what a laptop looks like;
 * four say it left in one piece in July and came back with a cracked lid in
 * September, which is the argument that actually has to be had — so nothing here
 * replaces anything, and every picture carries the date it shows and a line
 * about what is in it.
 *
 * The date is the one the picture shows, not the day it was uploaded: the log is
 * usually caught up on afterwards, and a row of upload timestamps would put the
 * evidence in the wrong order.
 *
 * Every file is served through /api/file, so a photograph of company property
 * stays behind the portal password like every other document here.
 */
export default function PhotoLog({
  photos,
  assetId,
  assetNo,
  /** Read-only once the asset is in the bin. */
  frozen,
}: {
  photos: AssetPhoto[];
  assetId: string;
  assetNo: string;
  frozen: boolean;
}) {
  const add = addAssetPhoto.bind(null, assetId);

  return (
    <section className="card overflow-hidden">
      <header className="border-b border-ink-line px-5 py-4">
        <h2 className="text-[15px] font-semibold">Photographs</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">
          {photos.length === 0
            ? "None yet. The newest picture becomes the thumbnail on the register."
            : `${photos.length} ${photos.length === 1 ? "picture" : "pictures"}, newest first.`}
        </p>
      </header>

      {photos.length > 0 ? (
        <ul className="divide-y divide-ink-line">
          {photos.map((photo) => (
            <li key={photo.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              {/* The picture itself is the link. A thumbnail somebody cannot
                  enlarge is no use for reading a serial number off a label. */}
              <a
                href={fileUrl(photo.key, { v: photo.createdAt })}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 overflow-hidden rounded-lg border border-ink-line transition-opacity hover:opacity-80"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(photo.key, { v: photo.createdAt })}
                  alt={photo.info || `${assetNo} photograph`}
                  className="block h-14 w-14 bg-wash object-cover"
                />
              </a>

              <div className="min-w-0 flex-1">
                <p className="mono text-[12.5px] text-ink-soft">{formatDate(photo.takenOn)}</p>
                <p className="mt-0.5 text-[13.5px]">
                  {photo.info || <span className="text-ink-soft">No description</span>}
                </p>
              </div>

              {!frozen ? (
                <form action={removeAssetPhoto.bind(null, assetId, photo.id)} className="shrink-0">
                  <button
                    type="submit"
                    aria-label={`Remove the photograph from ${formatDate(photo.takenOn)}`}
                    className="btn btn-quiet px-2.5 py-1.5 text-[12.5px] hover:!bg-red-50 hover:!text-red-700"
                  >
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!frozen ? (
        <form action={add} className="border-t border-ink-line px-5 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <ReceiptField
              id="photo"
              name="photo"
              label="Add a picture"
              // Images only. A PDF of a laptop is not a photograph of one, and
              // the thumbnail on the register would have nothing to show.
              accept="image/*,.heic,.heif"
              optionalLabel={false}
              required
              hint="A phone photo is fine — it is shrunk before it is sent."
            />

            <div>
              <label className="label mb-1.5" htmlFor="takenOn">
                Date taken
              </label>
              <input
                id="takenOn"
                name="takenOn"
                type="date"
                defaultValue={todayIso()}
                className="input"
              />
            </div>

            <div className="min-w-[14rem] flex-1">
              <label className="label mb-1.5" htmlFor="info">
                What it shows
              </label>
              <input
                id="info"
                name="info"
                maxLength={300}
                placeholder="Condition at handover — no marks"
                className="input"
              />
            </div>

            <button type="submit" className="btn btn-primary">
              File it
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
