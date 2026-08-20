import Link from "next/link";
import AllocatePicker, { type PickerBucket } from "@/components/AllocatePicker";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { COMPANY_LIST } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatMoney } from "@/lib/money";
import { allocate } from "@/lib/tranches/actions";
import {
  allocationState,
  queueTotals,
  SOURCE_KINDS,
  SOURCE_LABELS_PLURAL,
  stand,
  type AllocatableItem,
  type AllocationState,
  type SourceKind,
} from "@/lib/tranches/types";

/**
 * The work queue, and the picker over it.
 *
 * Opens on everything not yet fully attributed, oldest first — which is both the
 * backlog and the order the money went out, so clearing it top to bottom matches
 * how it was spent. Anything already allocated is a click away rather than in
 * the way.
 *
 * The filters live in the URL so a view can be bookmarked, the same as the
 * ranges on the expenditure report. They are applied over the rows rather than
 * in the query, for the reason `allocatable` gives: at the scale of a small
 * company's paperwork, reading the rows and filtering them here costs nothing
 * and needs no index.
 */

const STATES: Array<{ key: string; label: string; keep: AllocationState[] }> = [
  { key: "open", label: "Not yet allocated", keep: ["none", "part", "unknown"] },
  { key: "done", label: "Allocated", keep: ["full", "over"] },
  { key: "all", label: "Everything", keep: ["none", "part", "full", "over", "unknown"] },
];

export default async function Allocate({
  searchParams,
}: {
  searchParams: Promise<{ tranche?: string; company?: string; kind?: string; state?: string }>;
}) {
  const { tranche, company, kind, state } = await searchParams;
  const db = await store();

  const ledgerResult = await tryTable(() => db.fundingLedger());
  if (!ledgerResult.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;

  const itemsResult = await tryTable(() => db.allocatable());
  if (!itemsResult.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;

  // Open buckets only, oldest received first — the order a split fills them in,
  // because that is the order the money was actually drawn down.
  const buckets: PickerBucket[] = ledgerResult.value
    .map((l) => stand(l.tranche, l.debits))
    .filter((s) => s.open)
    .sort((a, b) => (a.tranche.recvDate < b.tranche.recvDate ? -1 : 1))
    .map((s) => ({
      id: s.tranche.id,
      trancheNo: s.tranche.trancheNo,
      label: s.tranche.label,
      recvCurrency: s.tranche.recvCurrency,
      remaining: s.remaining,
      recvDate: s.tranche.recvDate,
    }));

  const active = STATES.find((s) => s.key === state) ?? STATES[0];
  const activeKind = SOURCE_KINDS.includes(kind as SourceKind) ? (kind as SourceKind) : null;
  const activeCompany = COMPANY_LIST.some((c) => c.slug === company) ? company : null;

  const all = itemsResult.value;
  const shown: AllocatableItem[] = all
    .filter((i) => active.keep.includes(allocationState(i)))
    .filter((i) => !activeKind || i.kind === activeKind)
    .filter((i) => !activeCompany || i.company === activeCompany)
    // Oldest first: the backlog in the order it was spent.
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const totals = queueTotals(shown);
  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged = { tranche: tranche ?? null, company, kind, state, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return q ? `/funding/allocate?${q}` : "/funding/allocate";
  };

  return (
    <>
      <header className="mb-4">
        <h2 className="text-[17px] font-semibold">Allocate expenses</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
          Every expense in the portal — both companies, the food log and direct entries — with how
          much of each is already in a tranche. Tick what a tranche paid for and the arithmetic is
          done below before you commit it.
        </p>
      </header>

      {/* ---- filters, in the URL so a view can be bookmarked -------------- */}
      <div className="mb-4 space-y-2">
        <FilterRow label="Show">
          {STATES.map((s) => (
            <Pill key={s.key} href={href({ state: s.key })} on={s.key === active.key}>
              {s.label}
            </Pill>
          ))}
        </FilterRow>

        <FilterRow label="Kind">
          <Pill href={href({ kind: null })} on={!activeKind}>
            All
          </Pill>
          {SOURCE_KINDS.map((k) => (
            <Pill key={k} href={href({ kind: k })} on={k === activeKind}>
              {SOURCE_LABELS_PLURAL[k]}
            </Pill>
          ))}
        </FilterRow>

        <FilterRow label="Company">
          <Pill href={href({ company: null })} on={!activeCompany}>
            All
          </Pill>
          {COMPANY_LIST.map((c) => (
            <Pill key={c.slug} href={href({ company: c.slug })} on={c.slug === activeCompany}>
              {c.name}
            </Pill>
          ))}
        </FilterRow>
      </div>

      <p className="mb-4 text-[12.5px] text-ink-soft">
        {shown.length} {shown.length === 1 ? "expense" : "expenses"}
        {totals.length > 0 ? (
          <>
            {" · "}
            <span className="mono">
              {totals.map((t) => `${t.currency} ${formatMoney(t.total, t.currency)}`).join(" · ")}
            </span>{" "}
            still to attribute
          </>
        ) : null}
      </p>

      <AllocatePicker
        action={allocate}
        items={shown}
        buckets={buckets}
        initialTranche={tranche ?? null}
      />

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        Cancelled orders are never offered — nothing was spent on one. A purchase order and the
        voucher that paid it are both offered, because the portal does not link the two: allocate
        whichever represents the money that actually left, and each tranche reports the four kinds
        on their own lines so a double count is visible rather than buried.{" "}
        <Link href="/funding" className="underline underline-offset-2 hover:text-ink">
          Back to the tranches
        </Link>
      </p>
    </>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="label w-[4.5rem] shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** The same pill the expenditure report's range filters draw. */
function Pill({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold transition-colors ${
        on
          ? "bg-[var(--accent)] text-[var(--accent-text)]"
          : "text-ink-soft hover:bg-wash-strong hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
