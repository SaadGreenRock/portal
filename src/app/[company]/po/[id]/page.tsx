import Link from "next/link";
import { notFound } from "next/navigation";
import BuildPoPdfButton from "@/components/BuildPoPdfButton";
import ConfirmDelete from "@/components/ConfirmDelete";
import PoStatusActions from "@/components/PoStatusActions";
import PrintButton from "@/components/PrintButton";
import UploadFile from "@/components/UploadFile";
import { SheetStack } from "@/components/SheetPreview";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { dueIn, formatDate, stamp } from "@/lib/format";
import { amountToWords, formatMoney, formatMoneyFixed, formatQty } from "@/lib/money";
import {
  deletePo,
  removePoInvoice,
  restorePo,
  setPoStatus,
  uploadPoInvoice,
} from "@/lib/po/actions";
import { renderPoPages } from "@/lib/po/template";
import { poTotals, usableItems } from "@/lib/po/totals";
import { PO_STATUS_LABELS } from "@/lib/po/types";
import { fileUrl } from "@/lib/storage";

export default async function PurchaseOrderDetail({
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
  const po = await db.getPo(id);
  // Guard the workspace boundary: a Green Rock URL must never open a Sportech record.
  if (!po || po.company !== company.slug) notFound();

  const drop = deletePo.bind(null, po.id);
  const undelete = restorePo.bind(null, po.id);
  const move = setPoStatus.bind(null, po.id);
  const attachInvoice = uploadPoInvoice.bind(null, po.id);
  const detachInvoice = removePoInvoice.bind(null, po.id);

  const totals = poTotals(po.doc);
  const items = usableItems(po.doc);
  const code = po.doc.currency;
  const due = po.status === "issued" ? dueIn(po.doc.deliveryDate) : null;
  const stale = Boolean(po.pdfKey && po.pdfAt && po.pdfAt < po.updatedAt);

  // Rendered from the stored document through the same template the PDF came
  // from, rather than embedding the PDF: an <iframe> pointed at a PDF is at the
  // mercy of the browser's viewer, and iOS Safari just shows an empty box.
  const pages = renderPoPages(po, company, { assets: "url" });

  return (
    <>
      {pdfState === "failed" ? (
        <Banner tone="warn" title={`${po.poNo} was saved, but its PDF could not be rendered.`}>
          The order and its number are safe — only the PDF is missing. Press{" "}
          <strong className="font-semibold">Render PDF</strong> to try again, or open this page
          in a different browser if it keeps failing.
        </Banner>
      ) : saved === "new" ? (
        <Banner tone="accent" title={`${po.poNo} is ready.`}>
          {po.status === "issued"
            ? "Send the PDF to the vendor, then close the order once it has been delivered."
            : "It is still a draft. Mark it as issued when it goes to the vendor."}
        </Banner>
      ) : saved ? (
        <Banner tone="accent" title={`${po.poNo} updated.`}>
          The PDF has been re-rendered from the saved document.
        </Banner>
      ) : null}

      {po.deletedAt ? (
        <Banner tone="danger" title="This purchase order is deleted.">
          It is hidden from Open and History, and the PDF is still on file so it can be
          restored. Its number stays spent either way — {po.poNo} will never be issued to
          another order.
        </Banner>
      ) : stale ? (
        <Banner tone="warn" title="The PDF on file is older than this order.">
          The document has been edited since it was last rendered. Render it again before
          sending anything to the vendor.
        </Banner>
      ) : po.status === "closed" && !po.invoiceKey ? (
        <Banner tone="warn" title="Closed with no invoice on file.">
          Nothing on record shows this order actually arrived. Upload the vendor's invoice
          below, or reopen the order if it hasn't.
        </Banner>
      ) : null}

      {/* ---- header ------------------------------------------------------ */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mono text-[22px] font-bold tracking-tight">{po.poNo}</h1>
            {po.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : (
              <span className={`chip ${STATUS_CLASS[po.status]}`}>
                {PO_STATUS_LABELS[po.status]}
              </span>
            )}
            {due && due.days < 0 ? (
              <span className="chip bg-red-100 text-red-900">{due.label}</span>
            ) : due ? (
              <span className="chip bg-[#ececeb] text-ink">{due.label}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {po.doc.vendor.name || "No vendor named"}
            {po.doc.subject ? ` — ${po.doc.subject}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {po.pdfKey && !stale ? (
            <>
              <PrintButton href={fileUrl(po.pdfKey, { v: po.pdfAt })} />
              <a
                href={fileUrl(po.pdfKey, { v: po.pdfAt, download: true })}
                className="btn btn-ghost"
                download
              >
                Download
              </a>
            </>
          ) : (
            <BuildPoPdfButton
              poId={po.id}
              poNo={po.poNo}
              label={stale ? "Re-render PDF" : "Render PDF"}
            />
          )}

          {po.deletedAt ? null : (
            <Link href={`/${company.slug}/po/${po.id}/edit`} className="btn btn-ghost">
              Edit
            </Link>
          )}

          {po.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-ghost">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete action={drop} subject={po.poNo} />
          )}
        </div>
      </div>

      {po.deletedAt ? null : (
        <div className="mb-5">
          <PoStatusActions status={po.status} setStatus={move} />
        </div>
      )}

      {/* ---- audit trail ------------------------------------------------- */}
      <dl className="card mb-5 grid grid-cols-1 divide-y divide-ink-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {[
          ["Created", po.createdAt],
          ["Issued", po.issuedAt],
          ["Invoice filed", po.invoiceAt],
          ["Closed", po.closedAt],
        ].map(([label, value]) => (
          <div key={label as string} className="px-5 py-3.5">
            <dt className="label">{label}</dt>
            <dd className="mono mt-1 text-[13.5px]">{stamp(value as string | null)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
        {/* ---- the order, as data ---------------------------------------- */}
        <div className="space-y-5">
          <section className="card overflow-hidden">
            <header className="border-b border-ink-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Line items</h2>
            </header>

            {items.length === 0 ? (
              <p className="px-5 py-6 text-[13.5px] text-ink-soft">
                No line items on this order yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-[13.5px]">
                  <thead>
                    <tr className="border-b border-ink-line text-left">
                      <Th className="w-8 text-right">#</Th>
                      <Th>Description</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-center">Unit</Th>
                      <Th className="text-right">Rate</Th>
                      <Th className="text-right">Amount</Th>
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
                            <div className="mono mt-0.5 text-[12px] text-ink-soft">
                              {item.code}
                            </div>
                          ) : null}
                        </td>
                        <td className="mono px-3 py-2.5 text-right align-top">
                          {formatQty(item.qty)}
                        </td>
                        <td className="px-3 py-2.5 text-center align-top text-ink-soft">
                          {item.unit || "—"}
                        </td>
                        <td className="mono px-3 py-2.5 text-right align-top">
                          {formatMoneyFixed(item.unitPrice, code)}
                        </td>
                        <td className="mono px-3 py-2.5 text-right align-top font-semibold">
                          {formatMoneyFixed(totals.lines[i], code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-ink-line bg-[#fbfbfa] px-5 py-4">
              <div className="ml-auto max-w-xs space-y-1">
                <Money label="Subtotal" value={formatMoneyFixed(totals.subtotal, code)} />
                {totals.discount > 0 ? (
                  <Money label="Discount" value={`− ${formatMoneyFixed(totals.discount, code)}`} />
                ) : null}
                {po.doc.showTax ? (
                  <Money
                    label={`${po.doc.taxLabel} @ ${formatQty(po.doc.taxRate)}%`}
                    value={formatMoneyFixed(totals.tax, code)}
                  />
                ) : null}
                {totals.shipping > 0 ? (
                  <Money label="Freight" value={formatMoneyFixed(totals.shipping, code)} />
                ) : null}
                <div className="flex items-baseline justify-between gap-3 border-t border-ink-line pt-2 text-[15px] font-bold">
                  <span>Total</span>
                  <span className="mono">
                    {code} {formatMoney(totals.total, code)}
                  </span>
                </div>
                {totals.total > 0 ? (
                  <p className="pt-1 text-right text-[12px] leading-snug text-ink-soft">
                    {amountToWords(totals.total, code)}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Order details</h2>
            </header>
            <dl className="divide-y divide-ink-line">
              <Detail label="Vendor" value={po.doc.vendor.name} />
              <Detail label="Vendor address" value={po.doc.vendor.address} />
              <Detail
                label="Vendor contact"
                value={[po.doc.vendor.contact, po.doc.vendor.phone, po.doc.vendor.email]
                  .filter(Boolean)
                  .join("  ·  ")}
              />
              <Detail label="Tax registration" value={po.doc.vendor.taxId} />
              <Detail label="PO date" value={formatDate(po.doc.poDate)} />
              <Detail label="Required by" value={formatDate(po.doc.deliveryDate)} />
              <Detail label="Deliver to" value={po.doc.deliveryAddress} />
              <Detail label="Payment terms" value={po.doc.paymentTerms} />
              <Detail label="Reference" value={po.doc.reference} />
              <Detail label="Prepared by" value={po.doc.preparedBy} />
              <Detail label="Approved by" value={po.doc.approvedBy} />
              <Detail label="Notes" value={po.doc.notes} />
              <Detail label="Internal note" value={po.internalNote} privateNote />
            </dl>
          </section>
        </div>

        <div className="space-y-5 lg:sticky lg:top-5">
          {/* ---- the vendor's invoice -------------------------------------- */}
          {po.deletedAt ? null : (
            <section>
              <div className="mb-2.5 flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">Invoice</h2>
                {po.invoiceAt ? (
                  <span className="text-[12px] text-ink-soft">Filed {stamp(po.invoiceAt)}</span>
                ) : null}
              </div>

              {po.invoiceKey ? (
                <div className="space-y-2.5">
                  {po.invoiceKey.endsWith(".pdf") ? (
                    <div className="card grid place-items-center px-6 py-10 text-center">
                      <div>
                        <p className="text-[15px] font-medium">Invoice on file</p>
                        <p className="mt-1.5 text-[13.5px] text-ink-soft">Uploaded as a PDF.</p>
                        <div className="mt-5 flex flex-wrap justify-center gap-2">
                          <a
                            href={fileUrl(po.invoiceKey, { v: po.invoiceAt })}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-primary"
                          >
                            Open invoice
                          </a>
                          <a
                            href={fileUrl(po.invoiceKey, { v: po.invoiceAt, download: true })}
                            download
                            className="btn btn-ghost"
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <a
                      href={fileUrl(po.invoiceKey, { v: po.invoiceAt })}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fileUrl(po.invoiceKey, { v: po.invoiceAt })}
                        alt={`Invoice for ${po.poNo}`}
                        className="max-h-[560px] w-full rounded-lg border border-ink-line bg-white object-contain"
                      />
                    </a>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] text-ink-soft">{po.invoiceName}</span>
                    <form action={detachInvoice}>
                      <button type="submit" className="btn btn-quiet px-3 py-1.5 text-[13px]">
                        Remove invoice
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="card grid place-items-center px-6 py-10">
                  <div className="w-full max-w-xs text-center">
                    <p className="text-[15px] font-medium">No invoice yet</p>
                    <p className="mb-5 mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                      {po.status === "closed"
                        ? "This order is closed but has no invoice on file."
                        : "When the equipment arrives, photograph or scan the vendor's invoice. Uploading it closes the order."}
                    </p>
                    <UploadFile action={attachInvoice} label="Upload invoice" />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ---- the order, as it prints ------------------------------------ */}
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">Document</h2>
              <span className="text-[12px] text-ink-soft">
                {pages.length} {pages.length === 1 ? "page" : "pages"}
              </span>
            </div>
            <SheetStack pages={pages} maxHeight="70vh" />
          </section>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`/${company.slug}/po`} className="btn btn-ghost">
          ← Open orders
        </Link>
        <Link href={`/${company.slug}/po/history`} className="btn btn-ghost">
          All {company.name} orders
        </Link>
      </div>
    </>
  );
}

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-[#ececeb] text-ink",
  issued: "chip-pending",
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
      <p className={`mt-1 text-[13.5px] leading-relaxed ${tone === "accent" ? "text-ink-soft" : "opacity-80"}`}>
        {children}
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-soft ${className}`}>
      {children}
    </th>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-ink-soft">{label}</span>
      <span className="mono">{value}</span>
    </div>
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
