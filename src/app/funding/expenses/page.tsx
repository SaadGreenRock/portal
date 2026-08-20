import Link from "next/link";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { COMPANIES } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { allocationState, type AllocatableItem } from "@/lib/tranches/types";

/**
 * Direct entries — the expenses that exist only in this section.
 *
 * The confidentiality is structural rather than enforced: nothing outside the
 * funding section reads this table, so these appear in no company workspace, in
 * no figure on the landing page, and nowhere in the expenditure report. That
 * also means they are the reason a tranche's allocations can exceed what the
 * expenditure report knows about — which each tranche states on its own record.
 *
 * What it does not do is keep out somebody who already has the portal password.
 * There is one gate and it opens everything, and this screen says so rather than
 * letting the word "confidential" imply more than it delivers.
 */
export default async function DirectEntries() {
  const db = await store();

  const listResult = await tryTable(() => db.listDirect());
  if (!listResult.ok) return <ModuleUnavailable module="Funding &amp; tranches" />;
  const entries = listResult.value;

  // Where each one sits, so a row can say which tranche paid for it without a
  // second query per entry.
  const itemsResult = await tryTable(() => db.allocatable());
  const placement = new Map<string, AllocatableItem>(
    (itemsResult.ok ? itemsResult.value : [])
      .filter((i) => i.kind === "direct")
      .map((i) => [i.id, i]),
  );

  return (
    <>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold">Direct entries</h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
            Expenses paid out of investor money with no voucher, order or food entry behind them.
            They exist in this section and nowhere else in the portal.
          </p>
        </div>
        <Link href="/funding/expenses/new" className="btn btn-primary shrink-0">
          New direct entry
        </Link>
      </header>

      {entries.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <h3 className="text-[16px] font-semibold">Nothing logged here yet</h3>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
            Use these for money out of a tranche that has no paperwork elsewhere in the portal.
            Everything else — vouchers, purchase orders, food — is already available to allocate
            without being retyped here.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-ink-line overflow-hidden">
          {entries.map((entry) => {
            const item = placement.get(entry.id);
            const state = item ? allocationState(item) : "none";
            return (
              <li key={entry.id} className="flex flex-wrap items-start gap-x-5 gap-y-2 px-5 py-3.5">
                <Link href={`/funding/expenses/${entry.id}`} className="row-link">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="mono text-[13.5px] font-semibold">{entry.entryNo}</span>
                      {entry.company ? (
                        <span className="text-[12px] text-ink-soft">
                          {COMPANIES[entry.company].name}
                        </span>
                      ) : null}
                      {state === "none" ? (
                        <span className="chip chip-pending">not in a tranche</span>
                      ) : (
                        <span className="chip chip-neutral">
                          {item?.placements.map((p) => p.trancheNo).join(", ")}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-[13px] text-ink-soft">
                      {formatDate(entry.date)} · {entry.payee} · {entry.details}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-right text-[14px] font-semibold">
                    {entry.currency} {formatMoney(entry.amount, entry.currency)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-soft">
        These are kept out of every other screen by living in their own table, not by a second
        password — anybody who can open the portal can open this page. Say the word if that needs
        changing.
      </p>
    </>
  );
}
