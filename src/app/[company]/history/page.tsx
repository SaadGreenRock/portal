import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteVoucher from "@/components/DeleteVoucher";
import { deleteVoucher, restoreVoucher } from "@/lib/actions";
import { formatAmount } from "@/lib/amount-words";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { formatDate } from "@/lib/template";
import type { HistoryQuery, VoucherStatus } from "@/lib/types";

const PAGE_SIZE = 25;

type Params = {
  q?: string;
  deleted?: string;
  status?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  page?: string;
};

const num = (v: string | undefined): number | undefined => {
  if (!v?.trim()) return undefined;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

export default async function History({
  params,
  searchParams,
}: {
  params: Promise<{ company: string }>;
  searchParams: Promise<Params>;
}) {
  const { company: slug } = await params;
  const sp = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const status: VoucherStatus | "all" | "deleted" =
    sp.status === "pending" || sp.status === "completed" || sp.status === "deleted"
      ? sp.status
      : "all";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const query: HistoryQuery = {
    company: company.slug,
    q: sp.q,
    status,
    from: sp.from,
    to: sp.to,
    minAmount: num(sp.min),
    maxAmount: num(sp.max),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const db = await store();
  const { rows, total } = await db.search(query);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sp.q || sp.from || sp.to || sp.min || sp.max || status !== "all");

  /** Keeps the current filters while changing one parameter (used for paging). */
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][],
    );
    next.set(key, value);
    return `?${next.toString()}`;
  };

  return (
    <>
      {/* Shown straight after a delete, so the record isn't just gone silently. */}
      {sp.deleted ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">
            <span className="mono font-semibold">{sp.deleted}</span> was deleted. Its number
            stays spent and will not be reissued.
          </p>
          <Link
            href={`/${company.slug}/history?status=deleted`}
            className="btn btn-ghost px-3 py-1.5 text-[13px]"
          >
            View deleted
          </Link>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">History</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Every voucher ever issued for {company.name}.
          </p>
        </div>
        <p className="mono text-[13px] text-ink-soft">
          {total} {total === 1 ? "voucher" : "vouchers"}
          {filtered ? " matching" : ""}
        </p>
      </div>

      {/* GET form: filters live in the URL, so any view can be bookmarked. */}
      <form className="card mb-5 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label mb-1.5" htmlFor="q">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Voucher no., recipient, note, description…"
              className="input"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status} className="input">
              <option value="all">All</option>
              <option value="pending">Pending signature</option>
              <option value="completed">Completed</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label mb-1.5" htmlFor="min">
                Min PKR
              </label>
              <input id="min" name="min" defaultValue={sp.min ?? ""} inputMode="decimal" className="input" />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="max">
                Max PKR
              </label>
              <input id="max" name="max" defaultValue={sp.max ?? ""} inputMode="decimal" className="input" />
            </div>
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="from">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={sp.from ?? ""} className="input" />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="to">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={sp.to ?? ""} className="input" />
          </div>

          <div className="flex items-end gap-2 sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            {filtered ? (
              <Link href={`/${company.slug}/history`} className="btn btn-ghost">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">
            {filtered ? "No vouchers match those filters." : "No vouchers issued yet."}
          </p>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {filtered
              ? "Try widening the date or amount range."
              : `The first ${company.name} voucher will appear here once generated.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((v) => {
              const amount = v.fields.on.amount ? formatAmount(v.fields.amount) : null;
              const drop = deleteVoucher.bind(null, v.id);
              const undelete = restoreVoucher.bind(null, v.id);
              return (
                <li
                  key={v.id}
                  className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5"
                >
                  {/* The link covers the row's information; the actions sit
                      outside it, since a button cannot live inside an anchor. */}
                  <Link
                    href={`/${company.slug}/v/${v.id}`}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 rounded-md hover:opacity-80"
                  >
                    <div className="min-w-[9.5rem]">
                      <div className="mono text-[14.5px] font-semibold">{v.voucherNo}</div>
                      <div className="mono mt-0.5 text-[12px] text-ink-soft">
                        {formatDate(v.createdAt.slice(0, 10))}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px]">
                        {v.fields.on.recipientName ? (
                          v.fields.recipientName
                        ) : (
                          <span className="italic text-ink-soft">Recipient handwritten</span>
                        )}
                      </div>
                      <div className="truncate text-[12.5px] text-ink-soft">
                        {v.internalNote || v.fields.description || "—"}
                      </div>
                    </div>

                    <div className="mono min-w-[6.5rem] text-right text-[13.5px]">
                      {amount ? `PKR ${amount}` : <span className="text-ink-soft">—</span>}
                    </div>
                  </Link>

                  <div className="flex shrink-0 items-center gap-2">
                    {v.deletedAt ? (
                      <span className="chip bg-red-100 text-red-900">Deleted</span>
                    ) : (
                      <span
                        className={`chip ${
                          v.status === "completed" ? "chip-completed" : "chip-pending"
                        }`}
                      >
                        {v.status === "completed" ? "Completed" : "Pending"}
                      </span>
                    )}
                    {/* Two dots: PDF on file, scan on file. */}
                    <span className="flex gap-1" title="Generated PDF / signed scan on file">
                      <Dot on={Boolean(v.pdfKey)} />
                      <Dot on={Boolean(v.scanKey)} />
                    </span>

                    {v.deletedAt ? (
                      <form action={undelete}>
                        <button type="submit" className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]">
                          Restore
                        </button>
                      </form>
                    ) : (
                      <DeleteVoucher action={drop} voucherNo={v.voucherNo} compact />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {pages > 1 ? (
            <nav className="mt-5 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link href={withParam("page", String(page - 1))} className="btn btn-ghost">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="mono text-[13px] text-ink-soft">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={withParam("page", String(page + 1))} className="btn btn-ghost">
                  Older →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`block h-2 w-2 rounded-full ${on ? "bg-[var(--accent)]" : "bg-[#dcdcd8]"}`}
    />
  );
}
