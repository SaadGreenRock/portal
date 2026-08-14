import Link from "next/link";
import { notFound } from "next/navigation";
import BuildRfqPdfButton from "@/components/BuildRfqPdfButton";
import ConfirmDelete from "@/components/ConfirmDelete";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import PrintButton from "@/components/PrintButton";
import RfqStatusActions from "@/components/RfqStatusActions";
import { SheetStack } from "@/components/SheetPreview";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { dueIn, formatDate, stamp } from "@/lib/format";
import { formatQty } from "@/lib/money";
import { deleteRfq, restoreRfq, setRfqStatus } from "@/lib/rfq/actions";
import { usableRfqItems } from "@/lib/rfq/parse";
import { renderRfqPages } from "@/lib/rfq/template";
import { RFQ_STATUS_LABELS } from "@/lib/rfq/types";
import { fileUrl } from "@/lib/storage";

export default async function RequestForQuotationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; id: string }>;
  searchParams: Promise<{ saved?: string; pdf?: string }>;
}) {
  const { company: slug, id } = await params;
  const { saved, pdf: pdfState } = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const found = await tryTable(() => db.getRfq(id));
  if (!found.ok) return <ModuleUnavailable module="Quotations" />;
  const rfq = found.value;
  // Guard the workspace boundary: a Green Rock URL must never open a Sportech record.
  if (!rfq || rfq.company !== company.slug) notFound();

  const drop = deleteRfq.bind(null, rfq.id);
  const undelete = restoreRfq.bind(null, rfq.id);
  const move = setRfqStatus.bind(null, rfq.id);

  const items = usableRfqItems(rfq.doc);
  const due = rfq.status === "sent" ? dueIn(rfq.doc.replyBy) : null;
  const stale = Boolean(rfq.pdfKey && rfq.pdfAt && rfq.pdfAt < rfq.updatedAt);

  // Rendered from the stored document through the same template the PDF came
  // from, rather than embedding the PDF: an <iframe> pointed at a PDF is at the
  // mercy of the browser's viewer, and iOS Safari just shows an empty box.
  const pages = renderRfqPages(rfq, company, { assets: "url" });

  return (
    <>
      {pdfState === "failed" ? (
        <Banner tone="warn" title={`${rfq.rfqNo} was saved, but its PDF could not be rendered.`}>
          The request and its number are safe — only the PDF is missing. Press{" "}
          <strong className="font-semibold">Render PDF</strong> to try again.
        </Banner>
      ) : saved === "new" ? (
        <Banner tone="accent" title={`${rfq.rfqNo} is ready.`}>
          {rfq.status === "sent"
            ? "Send the PDF to whichever vendors you want prices from."
            : "It is still a draft. Mark it as sent once it has gone out."}
        </Banner>
      ) : saved ? (
        <Banner tone="accent" title={`${rfq.rfqNo} updated.`}>
          The PDF has been re-rendered from the saved document.
        </Banner>
      ) : null}

      {rfq.deletedAt ? (
        <Banner tone="danger" title="This request is deleted.">
          It is hidden from Open and History, and the PDF is still on file so it can be restored.
          Its number stays spent either way — {rfq.rfqNo} will never be reissued.
        </Banner>
      ) : stale ? (
        <Banner tone="warn" title="The PDF on file is older than this request.">
          The document has been edited since it was last rendered. Render it again before sending
          anything out.
        </Banner>
      ) : null}

      {/* ---- header ------------------------------------------------------ */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mono text-[22px] font-bold tracking-tight">{rfq.rfqNo}</h1>
            {rfq.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : (
              <span className={`chip ${STATUS_CLASS[rfq.status]}`}>
                {RFQ_STATUS_LABELS[rfq.status]}
              </span>
            )}
            {due && due.days < 0 ? (
              <span className="chip bg-red-100 text-red-900">replies {due.label}</span>
            ) : due ? (
              <span className="chip chip-neutral">replies {due.label}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {rfq.doc.subject || "No subject"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {rfq.pdfKey && !stale ? (
            <>
              <PrintButton href={fileUrl(rfq.pdfKey, { v: rfq.pdfAt })} />
              <a
                href={fileUrl(rfq.pdfKey, { v: rfq.pdfAt, download: true })}
                className="btn btn-ghost"
                download
              >
                Download
              </a>
            </>
          ) : (
            <BuildRfqPdfButton
              rfqId={rfq.id}
              rfqNo={rfq.rfqNo}
              label={stale ? "Re-render PDF" : "Render PDF"}
            />
          )}

          {rfq.deletedAt ? null : (
            <Link href={`/${company.slug}/rfq/${rfq.id}/edit`} className="btn btn-ghost">
              Edit
            </Link>
          )}

          {rfq.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-ghost">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete action={drop} subject={rfq.rfqNo} />
          )}
        </div>
      </div>

      {rfq.deletedAt ? null : (
        <div className="mb-5">
          <RfqStatusActions status={rfq.status} setStatus={move} />
        </div>
      )}

      {/* ---- audit trail ------------------------------------------------- */}
      <dl className="card mb-5 grid grid-cols-1 divide-y divide-ink-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {[
          ["Created", rfq.createdAt],
          ["Last edited", rfq.updatedAt],
          ["Sent", rfq.sentAt],
          ["Closed", rfq.closedAt],
        ].map(([label, value]) => (
          <div key={label as string} className="px-5 py-3.5">
            <dt className="label">{label}</dt>
            <dd className="mono mt-1 text-[13.5px]">{stamp(value as string | null)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
        {/* ---- the request, as data --------------------------------------- */}
        <div className="space-y-5">
          <section className="card overflow-hidden">
            <header className="border-b border-ink-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Items to be quoted</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                No prices held here — the vendor supplies those.
              </p>
            </header>

            {items.length === 0 ? (
              <p className="px-5 py-6 text-[13.5px] text-ink-soft">No items on this request yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] text-[13.5px]">
                  <thead>
                    <tr className="border-b border-ink-line text-left">
                      <Th className="w-8 text-right">#</Th>
                      <Th>Description</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-center">Unit</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-line">
                    {items.map((item, i) => (
                      <tr key={item.id}>
                        <td className="mono px-3 py-2.5 text-right align-top text-ink-soft">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="whitespace-pre-wrap">{item.description || "—"}</div>
                          {item.code ? (
                            <div className="mono mt-0.5 text-[12px] text-ink-soft">{item.code}</div>
                          ) : null}
                        </td>
                        <td className="mono px-3 py-2.5 text-right align-top">
                          {formatQty(item.qty)}
                        </td>
                        <td className="px-3 py-2.5 text-center align-top text-ink-soft">
                          {item.unit || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Request details</h2>
            </header>
            <dl className="divide-y divide-ink-line">
              <Detail label="Subject" value={rfq.doc.subject} />
              <Detail label="Request date" value={formatDate(rfq.doc.rfqDate)} />
              <Detail label="Quotations due by" value={formatDate(rfq.doc.replyBy)} />
              <Detail label="Quote in" value={rfq.doc.currency} />
              <Detail label="Delivery location" value={rfq.doc.deliveryAddress} />
              <Detail
                label="Replies to"
                value={[rfq.doc.contactName, rfq.doc.contactPhone, rfq.doc.contactEmail]
                  .filter(Boolean)
                  .join("  ·  ")}
              />
              <Detail label="Requested by" value={rfq.doc.preparedBy} />
              <Detail label="Notes" value={rfq.doc.notes} />
              <Detail label="Internal note" value={rfq.internalNote} privateNote />
            </dl>
          </section>
        </div>

        {/* ---- the request, as it prints ---------------------------------- */}
        <section className="lg:sticky lg:top-5">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Document</h2>
            <span className="text-[12px] text-ink-soft">
              {pages.length} {pages.length === 1 ? "page" : "pages"}
            </span>
          </div>
          <SheetStack pages={pages} maxHeight="80vh" />
        </section>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`/${company.slug}/rfq`} className="btn btn-ghost">
          ← Open requests
        </Link>
        <Link href={`/${company.slug}/rfq/history`} className="btn btn-ghost">
          All {company.name} requests
        </Link>
      </div>
    </>
  );
}

const STATUS_CLASS: Record<string, string> = {
  draft: "chip-neutral",
  sent: "chip-pending",
  closed: "chip-completed",
  cancelled: "bg-red-100 text-red-900",
};

const TONES = {
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
  accent: "",
} as const;

function Banner({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`mb-5 rounded-xl border p-4 sm:p-5 ${TONES[tone]}`}
      style={
        tone === "accent"
          ? { borderColor: "var(--accent)", background: "var(--accent-wash)" }
          : undefined
      }
    >
      <p className="text-[15px] font-semibold">{title}</p>
      <p
        className={`mt-1 text-[13.5px] leading-relaxed ${
          tone === "accent" ? "text-ink-soft" : "opacity-80"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-soft ${className}`}
    >
      {children}
    </th>
  );
}

function Detail({
  label,
  value,
  privateNote,
}: {
  label: string;
  value: string;
  privateNote?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
      <dt className="w-full text-[13px] font-medium sm:w-44">
        {label}
        {privateNote ? <span className="ml-1.5 text-[11px] text-ink-soft">not printed</span> : null}
      </dt>
      <dd className="flex-1 text-[13.5px]">
        {value?.trim() ? (
          <span className="whitespace-pre-wrap">{value}</span>
        ) : (
          <span className="text-ink-soft">—</span>
        )}
      </dd>
    </div>
  );
}
