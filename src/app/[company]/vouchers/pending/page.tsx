import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmDelete from "@/components/ConfirmDelete";
import UploadFile from "@/components/UploadFile";
import { deleteVoucher, uploadScan } from "@/lib/actions";
import { formatAmount } from "@/lib/amount-words";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { fileUrl } from "@/lib/storage";

/** "3 days ago" — how long a voucher has been waiting on its signed scan. */
function waitingFor(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default async function Pending({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const rows = await db.listPending(company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">Pending signature</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Generated but not yet uploaded. Oldest first, so nothing gets lost.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Nothing pending.</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            Every voucher issued for {company.name} has its signed copy on file.
          </p>
          <Link href={`/${company.slug}/vouchers/new`} className="btn btn-primary mt-5">
            New voucher
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((v) => {
            const attach = uploadScan.bind(null, v.id);
            const drop = deleteVoucher.bind(null, v.id);
            const amount = v.fields.on.amount ? formatAmount(v.fields.amount) : null;
            return (
              <li key={v.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Link
                        href={`/${company.slug}/vouchers/${v.id}`}
                        className="mono text-[15px] font-semibold hover:underline"
                      >
                        {v.voucherNo}
                      </Link>
                      <span className="chip chip-pending">Waiting {waitingFor(v.createdAt)}</span>
                    </div>

                    <p className="mt-1.5 truncate text-[13.5px] text-ink-soft">
                      {v.internalNote || (
                        <span className="italic">No internal note</span>
                      )}
                    </p>

                    <div className="mono mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-ink-soft">
                      {v.fields.on.recipientName ? <span>{v.fields.recipientName}</span> : null}
                      {amount ? <span>PKR {amount}</span> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {v.pdfKey ? (
                      <a
                        href={fileUrl(v.pdfKey)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost px-3 py-2 text-[13px]"
                      >
                        Open PDF
                      </a>
                    ) : null}
                    <UploadFile action={attach} label="Upload scan" compact />
                    <ConfirmDelete action={drop} subject={v.voucherNo} compact />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
