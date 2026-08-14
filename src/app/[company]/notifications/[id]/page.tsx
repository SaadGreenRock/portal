import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmDelete from "@/components/ConfirmDelete";
import CopyImageButton from "@/components/CopyImageButton";
import RenderNotificationButton from "@/components/RenderNotificationButton";
import SheetPreview from "@/components/SheetPreview";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { stamp } from "@/lib/format";
import { deleteNotification, restoreNotification } from "@/lib/notifications/actions";
import { CARD } from "@/lib/notifications/geometry";
import { renderNotificationHtml } from "@/lib/notifications/template";
import { TAG_LABELS } from "@/lib/notifications/types";
import { fileUrl } from "@/lib/storage";

export default async function NotificationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; id: string }>;
  searchParams: Promise<{ new?: string; render?: string }>;
}) {
  const { company: slug, id } = await params;
  const { new: justCreated, render: renderState } = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const n = await db.getNotification(id);
  // Guard the workspace boundary: a Green Rock URL must never open a Sportech record.
  if (!n || n.company !== company.slug) notFound();

  const drop = deleteNotification.bind(null, n.id);
  const undelete = restoreNotification.bind(null, n.id);
  const rendered = Boolean(n.pngKey && n.pdfKey);

  return (
    <>
      {renderState === "failed" && !rendered ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
          <p className="text-[15px] font-semibold text-amber-900">
            {n.notifNo} was saved, but its files could not be rendered.
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-amber-900/80">
            The notification and its number are safe — only the PNG and PDF are missing. Press{" "}
            <strong className="font-semibold">Render files</strong> to try again.
          </p>
        </div>
      ) : justCreated ? (
        <div
          className="mb-5 rounded-xl border p-4 sm:p-5"
          style={{ borderColor: "var(--accent)", background: "var(--accent-wash)" }}
        >
          <p className="text-[15px] font-semibold">{n.notifNo} is ready.</p>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Download the image for WhatsApp, or the PDF for email.
          </p>
        </div>
      ) : null}

      {n.deletedAt ? (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5">
          <p className="text-[15px] font-semibold text-red-900">This notification is deleted.</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-red-900/80">
            It is hidden from History, and both files are still on file so it can be restored.
            Its number stays spent either way — {n.notifNo} will never be reissued.
          </p>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mono text-[22px] font-bold tracking-tight">{n.notifNo}</h1>
            {n.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : (
              <span className="chip chip-neutral">{TAG_LABELS[n.tag]}</span>
            )}
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {n.headline || <span className="italic">No headline</span>}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {rendered ? (
            <>
              <a href={fileUrl(n.pngKey!, { download: true })} className="btn btn-primary" download>
                Download image
              </a>
              <a href={fileUrl(n.pdfKey!, { download: true })} className="btn btn-ghost" download>
                Download PDF
              </a>
              <CopyImageButton pngUrl={fileUrl(n.pngKey!)} />
            </>
          ) : (
            <RenderNotificationButton notificationId={n.id} />
          )}

          {/* A deleted notification offers the way back instead of a second delete. */}
          {n.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-ghost">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete action={drop} subject={n.notifNo} />
          )}
        </div>
      </div>

      <dl className="card mb-5 grid grid-cols-1 divide-y divide-ink-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {[
          ["Created", n.createdAt],
          ["Sender", n.sender || "Management"],
        ].map(([label, value]) => (
          <div key={label as string} className="px-5 py-3.5">
            <dt className="label">{label}</dt>
            <dd className="mono mt-1 text-[13.5px]">
              {label === "Created" ? stamp(value as string) : value}
            </dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-2.5 text-[15px] font-semibold">The card</h2>
        {/* Rendered from the stored field values through the same template the
            PNG/PDF came from, rather than embedding the image itself — same
            reasoning as the voucher's own detail page: an <iframe> pointed at
            an image is at the mercy of the browser's viewer. */}
        <div className="mx-auto max-w-sm">
          <SheetPreview
            html={renderNotificationHtml(n, company, { assets: "url" })}
            width={CARD.widthPx}
            height={CARD.heightPx}
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2.5 text-[15px] font-semibold">Message as sent</h2>
        <dl className="card divide-y divide-ink-line">
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
            <dt className="w-full text-[13px] font-medium sm:w-40">Headline</dt>
            <dd className="flex-1 text-[13.5px]">{n.headline}</dd>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
            <dt className="w-full text-[13px] font-medium sm:w-40">Message</dt>
            <dd className="flex-1 whitespace-pre-wrap text-[13.5px]">{n.body}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6">
        <Link href={`/${company.slug}/notifications/history`} className="btn btn-ghost">
          ← All {company.name} notifications
        </Link>
      </div>
    </>
  );
}
