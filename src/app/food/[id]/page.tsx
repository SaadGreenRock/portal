import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmDelete from "@/components/ConfirmDelete";
import FoodForm from "@/components/FoodForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import {
  deleteFood,
  markFoodPaid,
  markFoodPending,
  restoreFood,
  saveFood,
} from "@/lib/food/actions";
import { PAYMENT_TYPE_LABELS, type FoodExpense } from "@/lib/food/types";
import { formatDate, stamp, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * One food entry: what it was, and whether it has been squared up.
 *
 * The record and its edit form are the same screen, like the asset register —
 * every field worth reading here is worth correcting. What changes with state is
 * the settlement: a pending entry can be paid, a paid one can be put back, and
 * never both.
 *
 * A deleted entry drops every form. It is in the bin, and the only thing to do
 * with it is put it back.
 */
export default async function FoodRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string;
    saved?: string;
    settled?: string;
    reopened?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const db = await store();
  const [found, names] = await Promise.all([
    tryTable(() => db.getFood(id)),
    tryTable(() => db.foodNames()),
  ]);
  if (!found.ok) return <ModuleUnavailable module="Food" />;

  const entry = found.value;
  if (!entry) notFound();

  const suggestions = names.ok
    ? names.value
    : { vendors: [], payers: [], orderedFor: [] };

  const pending = entry.status === "pending";
  const owedTo = entry.paymentType === "employee-paid" ? entry.paidBy : entry.vendor;

  const drop = deleteFood.bind(null, entry.id);
  const undelete = restoreFood.bind(null, entry.id);
  const save = saveFood.bind(null, entry.id);
  const settle = markFoodPaid.bind(null, entry.id);
  const reopen = markFoodPending.bind(null, entry.id);

  const banner = sp.created
    ? `Logged as ${entry.entryNo}.`
    : sp.settled
      ? "Marked paid."
      : sp.reopened
        ? "Put back to pending. It is owed again, and the payment date was cleared."
        : sp.saved
          ? "Saved."
          : null;

  return (
    <>
      {banner ? (
        <div className="mb-5 rounded-xl border border-ink-line bg-white p-4">
          <p className="text-[13.5px]">{banner}</p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="mono text-[20px] font-bold tracking-tight">{entry.entryNo}</h2>
            {entry.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : (
              <span className={`chip ${pending ? "chip-pending" : "chip-completed"}`}>
                {pending ? "Pending" : "Paid"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[14px] text-ink-soft">
            {entry.details} — {entry.vendor}, {formatDate(entry.date)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {entry.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-primary">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete action={drop} subject={entry.entryNo} />
          )}
          <Link href="/food" className="btn btn-ghost">
            ← Log
          </Link>
        </div>
      </div>

      {/* ---- the record ---------------------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <dl className="divide-y divide-ink-line">
          <Field label="Amount">
            <span className="mono text-[16px] font-bold">
              {entry.currency} {formatMoney(entry.amount, entry.currency)}
            </span>
          </Field>
          <Field label="Ordered for">
            {entry.orderedFor || <span className="text-ink-soft">Not recorded</span>}
          </Field>
          <Field label="Payment">{PAYMENT_TYPE_LABELS[entry.paymentType]}</Field>
          <Field label={pending ? "Owed to" : "Was owed to"}>
            {owedTo || <span className="text-ink-soft">Not recorded</span>}
          </Field>
          {!pending ? (
            <Field label="Paid on">
              {/* A settled entry always carries a date — foodColumns falls back
                  to the order date. The empty case is kept only so a row that
                  somehow lacks one says so rather than rendering a blank. */}
              {entry.paidAt ? (
                formatDate(entry.paidAt)
              ) : (
                <span className="text-ink-soft">Recorded as paid, date not known</span>
              )}
            </Field>
          ) : null}
          {entry.reference ? (
            <Field label="Reference">
              <span className="mono">{entry.reference}</span>
            </Field>
          ) : null}
          {entry.notes ? (
            <Field label="Notes">
              <span className="whitespace-pre-wrap">{entry.notes}</span>
            </Field>
          ) : null}
        </dl>

        <p className="border-t border-ink-line bg-[#fbfbfa] px-5 py-3 text-[12.5px] text-ink-soft">
          Logged {stamp(entry.createdAt)}
          {entry.updatedAt !== entry.createdAt ? ` · last changed ${stamp(entry.updatedAt)}` : ""}
          {entry.deletedAt ? ` · deleted ${stamp(entry.deletedAt)}` : ""}
        </p>
      </section>

      {/* ---- settlement ---------------------------------------------------- */}
      {entry.deletedAt ? null : pending ? (
        <section className="card mb-5 overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h3 className="text-[16px] font-semibold">Mark it paid</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {entry.paymentType === "employee-paid"
                ? `Records that ${entry.paidBy ?? "the employee"} has been reimbursed.`
                : `Records that ${entry.vendor} has been settled for this order.`}{" "}
              To clear a whole tab at once, use{" "}
              <Link href="/food/outstanding" className="underline">
                Outstanding
              </Link>
              .
            </p>
          </header>

          <form action={settle} className="flex flex-wrap items-end gap-3 px-5 py-4">
            <div className="min-w-[9rem]">
              <label className="label mb-1.5" htmlFor="paidAt">
                Paid on
              </label>
              <input
                id="paidAt"
                name="paidAt"
                type="date"
                defaultValue={todayIso()}
                className="input"
              />
            </div>
            <div className="min-w-[10rem] flex-1">
              <label className="label mb-1.5" htmlFor="reference">
                Reference <span className="font-normal normal-case">— optional</span>
              </label>
              <input
                id="reference"
                name="reference"
                maxLength={120}
                placeholder="Cheque or transfer no."
                className="input mono"
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Mark paid
            </button>
          </form>
        </section>
      ) : (
        <section className="card mb-5 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-[13.5px] text-ink-soft">
            Settled. If that was a mistake, put it back and it will show as owed again.
          </p>
          <form action={reopen}>
            <button type="submit" className="btn btn-ghost">
              Put back to pending
            </button>
          </form>
        </section>
      )}

      {/* ---- correct it ---------------------------------------------------- */}
      {entry.deletedAt ? null : (
        <>
          <h3 className="mb-3 text-[16px] font-semibold">Correct this entry</h3>
          <FoodForm
            action={save}
            entry={entry as FoodExpense}
            vendors={suggestions.vendors}
            payers={suggestions.payers}
            orderedFor={suggestions.orderedFor}
            submitLabel="Save changes"
            cancelHref="/food"
            entryNo={entry.entryNo}
          />
        </>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
      <dt className="label w-40 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13.5px]">{children}</dd>
    </div>
  );
}
