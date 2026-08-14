import Link from "next/link";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import PendingCalendar from "@/components/PendingCalendar";
import SettleForm from "@/components/SettleForm";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { groupByDate, groupByPayee, summariseFood } from "@/lib/food/types";
import { todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * Everything the company still owes for food, and the buttons that clear it.
 *
 * Two panels, not one list. Money owed to an employee who paid out of pocket and
 * money owed to a café running a tab are settled by different people on
 * different days, and merging them into a single "outstanding" figure would hide
 * the one that has somebody personally out of pocket waiting on it — which is
 * why the reimbursements panel comes first even though it is usually the smaller
 * number.
 *
 * The calendar underneath is the same set of entries counted a second way. It
 * answers "how far back does this go", which the payee grouping cannot: a café
 * owed for one order last week and eleven this month reads as one debt. A month
 * grid rather than a list of dates, because the answer is usually a pattern —
 * every Tuesday, or the fortnight nobody was in the office to sign a cheque —
 * and a pattern is a shape, not a column of figures to read down.
 */
export default async function Outstanding({
  searchParams,
}: {
  searchParams: Promise<{ settled?: string }>;
}) {
  const sp = await searchParams;

  const db = await store();
  const listed = await tryTable(() => db.pendingFood());
  if (!listed.ok) return <ModuleUnavailable module="Food" />;

  const pending = listed.value;
  const counts = summariseFood(pending);
  const employees = groupByPayee(pending, "employee-paid");
  const vendors = groupByPayee(pending, "deferred");
  const byDate = groupByDate(pending);
  const today = todayIso();

  const settledCount = Number(sp.settled ?? 0) || 0;

  return (
    <>
      {sp.settled !== undefined ? (
        <div className="mb-5 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">
            {settledCount > 0
              ? `${settledCount} ${settledCount === 1 ? "entry" : "entries"} marked paid.`
              : "Nothing changed — those entries had already been settled."}
          </p>
        </div>
      ) : null}

      <div className="mb-5">
        <h2 className="text-[20px] font-bold tracking-tight">Outstanding</h2>
        <p className="mt-1 text-[14px] text-ink-soft">
          Money still owed — to employees awaiting reimbursement, and to vendors on deferred
          accounts.
        </p>
      </div>

      <dl className="card mb-6 grid grid-cols-1 divide-y divide-ink-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Total label="Owed to employees" value={counts.owedToEmployees} />
        <Total label="Owed to vendors" value={counts.owedToVendors} />
        <Total label="Total outstanding" value={counts.totalOutstanding} emphasis />
      </dl>

      {pending.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">All clear.</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-soft">
            Nothing is owed to anybody. Every order in the log has been settled.
          </p>
          <Link href="/food" className="btn btn-ghost mt-5">
            Back to the log
          </Link>
        </div>
      ) : (
        <>
          {/* ---- employees first: somebody is personally out of pocket ------ */}
          <section className="mb-7">
            <h3 className="mb-1 text-[16px] font-semibold">Employee reimbursements</h3>
            <p className="mb-3 text-[13px] text-ink-soft">
              Paid out of pocket, awaiting reimbursement from the company.
            </p>
            {employees.length === 0 ? (
              <p className="card px-5 py-6 text-[13.5px] text-ink-soft">
                Nobody is waiting to be paid back.
              </p>
            ) : (
              <div className="space-y-4">
                {employees.map((group) => (
                  <SettleForm key={group.payee} group={group} today={today} currency="₨" />
                ))}
              </div>
            )}
          </section>

          {/* ---- vendors ---------------------------------------------------- */}
          <section className="mb-7">
            <h3 className="mb-1 text-[16px] font-semibold">Vendor and café accounts</h3>
            <p className="mb-3 text-[13px] text-ink-soft">
              Deferred orders billed to the company and not yet settled.
            </p>
            {vendors.length === 0 ? (
              <p className="card px-5 py-6 text-[13.5px] text-ink-soft">
                No vendor is running a tab.
              </p>
            ) : (
              <div className="space-y-4">
                {vendors.map((group) => (
                  <SettleForm key={group.payee} group={group} today={today} currency="₨" />
                ))}
              </div>
            )}
          </section>

          {/* ---- the same debts, counted by day ----------------------------- */}
          <section>
            <h3 className="mb-1 text-[16px] font-semibold">Pending by date</h3>
            <p className="mb-3 text-[13px] text-ink-soft">
              The same entries written onto the day they were ordered, oldest month first. Amounts
              are in ₨; a blank day has nothing owed. Tap a day to open the log filtered to it.
            </p>
            <PendingCalendar days={byDate} today={today} currency="₨" />
          </section>
        </>
      )}
    </>
  );
}

function Total({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <dt className="label">{label}</dt>
      <dd
        className={`mono mt-1 font-bold ${
          emphasis ? "text-[20px]" : value > 0 ? "text-[16px] text-amber-700" : "text-[16px]"
        }`}
      >
        ₨ {formatMoney(value)}
      </dd>
    </div>
  );
}
