import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteVoucher from "@/components/DeleteVoucher";
import PrintButton from "@/components/PrintButton";
import SheetPreview from "@/components/SheetPreview";
import UploadScan from "@/components/UploadScan";
import {
  deleteVoucher,
  regeneratePdf,
  removeScan,
  restoreVoucher,
  uploadScan,
} from "@/lib/actions";
import { amountInWords, formatAmount } from "@/lib/amount-words";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { formatDate, renderVoucherHtml } from "@/lib/template";
import { TOGGLE_LABELS, TOGGLE_KEYS, type ToggleKey } from "@/lib/types";

/** "31 July 2026, 3:42 pm" for the audit trail. */
function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${formatDate(d.toISOString().slice(0, 10))}, ${d
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export default async function VoucherDetail({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { company: slug, id } = await params;
  const { new: justGenerated } = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const v = await db.getVoucher(id);
  // Guard the workspace boundary: a Green Rock URL must never open a Sportech record.
  if (!v || v.company !== company.slug) notFound();

  const attach = uploadScan.bind(null, v.id);
  const detach = removeScan.bind(null, v.id);
  const rerender = regeneratePdf.bind(null, v.id);
  const drop = deleteVoucher.bind(null, v.id);
  const undelete = restoreVoucher.bind(null, v.id);

  /** Printed value for a field, or null when the toggle was off. */
  const printed = (k: ToggleKey): string | null => {
    if (!v.fields.on[k]) return null;
    switch (k) {
      case "amount":
        return `PKR ${formatAmount(v.fields.amount)} — ${amountInWords(v.fields.amount)}`;
      case "voucherDate":
        return formatDate(v.fields.voucherDate);
      case "authorizedDate":
        return formatDate(v.fields.authorizedDate);
      default:
        return v.fields[k] || null;
    }
  };

  return (
    <>
      {justGenerated ? (
        <div
          className="mb-5 rounded-xl border p-4 sm:p-5"
          style={{ borderColor: "var(--accent)", background: "var(--accent-wash)" }}
        >
          <p className="text-[15px] font-semibold">
            {v.voucherNo} is ready.
          </p>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Print it, get it signed in person, then come back and upload the scan.
          </p>
        </div>
      ) : null}

      {v.deletedAt ? (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5">
          <p className="text-[15px] font-semibold text-red-900">This voucher is deleted.</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-red-900/80">
            It is hidden from Pending and History, and both files are still on file so it
            can be restored. Its number stays spent either way — {v.voucherNo} will never be
            issued to another payment.
          </p>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mono text-[22px] font-bold tracking-tight">{v.voucherNo}</h1>
            {v.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : (
              <span
                className={`chip ${v.status === "completed" ? "chip-completed" : "chip-pending"}`}
              >
                {v.status === "completed" ? "Completed" : "Pending signature"}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {v.internalNote || <span className="italic">No internal note</span>}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {v.pdfKey ? (
            <>
              <PrintButton href={fileUrl(v.pdfKey)} />
              <a href={`${fileUrl(v.pdfKey)}?download`} className="btn btn-ghost" download>
                Download
              </a>
            </>
          ) : (
            <form action={rerender}>
              <button type="submit" className="btn btn-primary">
                Render PDF
              </button>
            </form>
          )}

          {/* A deleted voucher offers the way back instead of a second delete. */}
          {v.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-ghost">
                Restore
              </button>
            </form>
          ) : (
            <DeleteVoucher action={drop} voucherNo={v.voucherNo} />
          )}
        </div>
      </div>

      {/* ---- the three dates from the plan's data model ------------------ */}
      <dl className="card mb-5 grid grid-cols-1 divide-y divide-ink-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          ["Created", v.createdAt],
          ["PDF generated", v.generatedAt],
          ["Scan uploaded", v.uploadedAt],
        ].map(([label, value]) => (
          <div key={label as string} className="px-5 py-3.5">
            <dt className="label">{label}</dt>
            <dd className="mono mt-1 text-[13.5px]">{stamp(value as string | null)}</dd>
          </div>
        ))}
      </dl>

      {/* ---- generated PDF beside signed scan ---------------------------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2.5 text-[15px] font-semibold">Generated voucher</h2>
          {/* Rendered from the stored field values through the same template the
              PDF came from, rather than embedding the PDF itself: an <iframe>
              pointed at a PDF is at the mercy of the browser's viewer, and iOS
              Safari in particular just shows an empty box. The PDF is still what
              Print and Download hand over. */}
          <SheetPreview html={renderVoucherHtml(v, company, { assets: "url" })} />
        </section>

        <section>
          <h2 className="mb-2.5 text-[15px] font-semibold">Signed scan</h2>
          {v.scanKey ? (
            <div className="space-y-2.5">
              {v.scanKey.endsWith(".pdf") ? (
                <div className="card grid place-items-center px-6 py-16 text-center">
                  <div>
                    <p className="text-[15px] font-medium">Signed scan on file</p>
                    <p className="mt-1.5 text-[13.5px] text-ink-soft">
                      Uploaded as a PDF.
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <a
                        href={fileUrl(v.scanKey)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                      >
                        Open scan
                      </a>
                      <a href={`${fileUrl(v.scanKey)}?download`} download className="btn btn-ghost">
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <a href={fileUrl(v.scanKey)} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fileUrl(v.scanKey)}
                    alt={`Signed scan of ${v.voucherNo}`}
                    className="max-h-[900px] w-full rounded-lg border border-ink-line bg-white object-contain"
                  />
                </a>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-[12.5px] text-ink-soft">{v.scanName}</span>
                <form action={detach}>
                  <button type="submit" className="btn btn-quiet px-3 py-1.5 text-[13px]">
                    Remove scan
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="card grid place-items-center px-6 py-24">
              <div className="w-full max-w-xs text-center">
                <p className="text-[15px] font-medium">Not uploaded yet</p>
                <p className="mt-1.5 mb-5 text-[13.5px] leading-relaxed text-ink-soft">
                  Print the voucher, have it signed, then photograph or scan the signed copy.
                </p>
                <UploadScan action={attach} />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ---- what was printed vs left blank ----------------------------- */}
      <section className="mt-6">
        <h2 className="mb-2.5 text-[15px] font-semibold">Fields as issued</h2>
        <dl className="card divide-y divide-ink-line">
          {TOGGLE_KEYS.map((k) => {
            const value = printed(k);
            return (
              <div key={k} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
                <dt className="w-full text-[13px] font-medium sm:w-56">{TOGGLE_LABELS[k]}</dt>
                <dd className="flex-1 text-[13.5px]">
                  {value ? (
                    <span className="whitespace-pre-wrap">{value}</span>
                  ) : (
                    <span className="text-ink-soft">Left blank — handwritten</span>
                  )}
                </dd>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
            <dt className="w-full text-[13px] font-medium sm:w-56">Payment method</dt>
            <dd className="flex-1 text-[13.5px] text-ink-soft">Always handwritten</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6">
        <Link href={`/${company.slug}/history`} className="btn btn-ghost">
          ← All {company.name} vouchers
        </Link>
      </div>
    </>
  );
}
