import Link from "next/link";
import { notFound } from "next/navigation";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import RfqRow from "@/components/RfqRow";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { dueIn } from "@/lib/format";

/** How many open requests the screen will show before it says it is holding some back. */
const OPEN_LIMIT = 200;

/**
 * The working set: every request still a draft or still out with vendors.
 *
 * Ordered by how soon replies are due rather than by date — a request whose
 * deadline has passed is the one that needs chasing.
 */
export default async function OpenRequests({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const listed = await tryTable(() =>
    db.searchRfqs({ company: company.slug, status: "open", limit: OPEN_LIMIT }),
  );
  if (!listed.ok) return <ModuleUnavailable module="Quotations" />;
  const { rows, total } = listed.value;
  // See the note on the purchase order list: a silent cap reads as a full list.
  const capped = total > rows.length;

  const ranked = [...rows].sort((a, b) => urgency(a) - urgency(b));
  const drafts = rows.filter((r) => r.status === "draft").length;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Open quotation requests</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Drafts and requests still out with vendors. Soonest deadline first.
          </p>
        </div>
        <Link href={`/${company.slug}/rfq/new`} className="btn btn-primary">
          New quotation request
        </Link>
      </div>

      {capped ? (
        <p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
          Showing the {rows.length} most urgent of {total} open requests. Use{" "}
          <Link href={`/${company.slug}/rfq/history`} className="font-semibold underline">
            History
          </Link>{" "}
          to search all of them.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <dl className="card mb-5 grid grid-cols-2 divide-y divide-ink-line sm:divide-x sm:divide-y-0">
          <Stat label="Drafts" value={String(drafts)} />
          <Stat label="Sent, awaiting replies" value={String(rows.length - drafts)} />
        </dl>
      ) : null}

      {ranked.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Nothing open.</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            Every {company.name} request has been closed or cancelled.
          </p>
          <Link href={`/${company.slug}/rfq/new`} className="btn btn-primary mt-5">
            New quotation request
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {ranked.map((rfq) => (
            <RfqRow key={rfq.id} rfq={rfq} company={company.slug} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Lower sorts first. Overdue replies lead, ordered by how late they are; then
 * anything with a deadline, soonest first; then drafts, which are nobody's
 * deadline yet; then the rest, oldest first.
 */
function urgency(rfq: { status: string; doc: { replyBy: string }; createdAt: string }): number {
  const due = rfq.status === "sent" ? dueIn(rfq.doc.replyBy) : null;
  if (due) return due.days;
  if (rfq.status === "draft") return 10_000;
  return 9_000 + new Date(rfq.createdAt).getTime() / 1e12;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="label">{label}</dt>
      <dd className="mono mt-1 text-[13.5px]">{value}</dd>
    </div>
  );
}
