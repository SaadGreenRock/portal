import Link from "next/link";
import { notFound } from "next/navigation";
import PoRow from "@/components/PoRow";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { dueIn } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/** How many open orders the screen will show before it says it is holding some back. */
const OPEN_LIMIT = 200;

/**
 * The working set: every order that is still a draft or still out with a vendor.
 *
 * Sorted by how urgent it is rather than by date — an order that is overdue on
 * delivery is the one that needs a phone call, and it should not be four pages
 * down because it was raised in March.
 */
export default async function OpenPurchaseOrders({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const listed = await tryTable(() =>
    db.searchPos({ company: company.slug, status: "open", limit: OPEN_LIMIT }),
  );
  if (!listed.ok) return <ModuleUnavailable module="Purchase Orders" />;
  const { rows, total } = listed.value;
  // A cap that hides rows without saying so reads as a complete list. It has
  // never bitten at this volume, and it must announce itself on the day it does.
  const capped = total > rows.length;

  const ranked = [...rows].sort((a, b) => urgency(a) - urgency(b));

  // Totals are per currency: adding SAR to PKR would be a meaningless number.
  const outstanding = new Map<string, number>();
  for (const po of rows) {
    if (po.status !== "issued") continue;
    outstanding.set(po.doc.currency, (outstanding.get(po.doc.currency) ?? 0) + po.total);
  }

  const drafts = rows.filter((r) => r.status === "draft").length;
  const issued = rows.length - drafts;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Open orders</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Drafts and orders still out with a vendor. Most urgent first.
          </p>
        </div>
        <Link href={`/${company.slug}/po/new`} className="btn btn-primary">
          New purchase order
        </Link>
      </div>

      {capped ? (
        <p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
          Showing the {rows.length} most urgent of {total} open orders. Use{" "}
          <Link href={`/${company.slug}/po/history`} className="font-semibold underline">
            History
          </Link>{" "}
          to search all of them.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <dl className="card mb-5 grid grid-cols-2 divide-y divide-ink-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat label="Drafts" value={String(drafts)} />
          <Stat label="Issued" value={String(issued)} />
          <Stat
            label="Value outstanding"
            value={
              outstanding.size === 0
                ? "—"
                : [...outstanding.entries()]
                    .map(([code, sum]) => `${code} ${formatMoney(sum, code)}`)
                    .join("  ·  ")
            }
          />
        </dl>
      ) : null}

      {ranked.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Nothing open.</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            Every {company.name} purchase order has been closed or cancelled.
          </p>
          <Link href={`/${company.slug}/po/new`} className="btn btn-primary mt-5">
            New purchase order
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {ranked.map((po) => (
            <PoRow key={po.id} po={po} company={company.slug} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Lower sorts first. Overdue deliveries lead, ordered by how late they are;
 * then anything with a delivery date, soonest first; then drafts, which are
 * nobody's deadline yet; then the rest, oldest first.
 */
function urgency(po: { status: string; doc: { deliveryDate: string }; createdAt: string }): number {
  const due = po.status === "issued" ? dueIn(po.doc.deliveryDate) : null;
  if (due) return due.days;
  if (po.status === "draft") return 10_000;
  return 9_000 + new Date(po.createdAt).getTime() / 1e12;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="label">{label}</dt>
      <dd className="mono mt-1 text-[13.5px]">{value}</dd>
    </div>
  );
}
