import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmDelete from "@/components/ConfirmDelete";
import MiscForm from "@/components/MiscForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import ReceiptField from "@/components/ReceiptField";
import ScanPreview from "@/components/ScanPreview";
import { getCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatDate, stamp } from "@/lib/format";
import {
  attachMiscProof,
  deleteMisc,
  removeMiscProof,
  restoreMisc,
  saveMisc,
} from "@/lib/misc/actions";
import { formatMoney } from "@/lib/money";

/**
 * One miscellaneous payment: what left, when, and what it was for.
 *
 * The record and its correction form are the same screen, like the food log and
 * the asset register — every field worth reading here is worth fixing.
 *
 * What is *not* the same as the food log is the panel in the middle. There is no
 * settlement to perform: the money went before the row existed. So the only
 * thing that panel offers is the receipt — attach one, replace a bad photograph,
 * or take a wrong one off — and it is available always rather than only in one
 * state, because a receipt for a payment made in March can turn up in June.
 *
 * A deleted payment drops every form. It is in the bin, and the only thing to do
 * with it is put it back.
 */
export default async function MiscRecord({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; id: string }>;
  searchParams: Promise<{
    created?: string;
    saved?: string;
    filed?: string;
    unfiled?: string;
  }>;
}) {
  const { company: slug, id } = await params;
  const sp = await searchParams;

  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const found = await tryTable(() => db.getMisc(id));
  if (!found.ok) return <ModuleUnavailable module="Miscellaneous payments" />;

  const payment = found.value;
  // Reaching another workspace's payment through this company's URL is a 404
  // rather than a redirect: the record belongs to one company's totals, and
  // quietly showing it here would put Green Rock's money on a Sportech screen.
  if (!payment || payment.company !== company.slug) notFound();

  const drop = deleteMisc.bind(null, company.slug, payment.id);
  const undelete = restoreMisc.bind(null, company.slug, payment.id);
  const save = saveMisc.bind(null, company.slug, payment.id);
  const file = attachMiscProof.bind(null, company.slug, payment.id);
  const unfile = removeMiscProof.bind(null, company.slug, payment.id);

  const banner = sp.created
    ? payment.proofKey
      ? `Logged as ${payment.paymentNo}, with the receipt filed against it.`
      : `Logged as ${payment.paymentNo}. No receipt was attached — you can add one below.`
    : sp.filed
      ? "Receipt filed."
      : sp.unfiled
        ? "Receipt removed. The payment itself still counts towards expenditure."
        : sp.saved
          ? "Saved."
          : null;

  return (
    <>
      {banner ? (
        <div className="mb-5 rounded-xl border border-ink-line bg-card p-4">
          <p className="text-[13.5px]">{banner}</p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="mono text-[20px] font-bold tracking-tight">{payment.paymentNo}</h1>
            {payment.deletedAt ? (
              <span className="chip bg-red-100 text-red-900">Deleted</span>
            ) : payment.proofKey ? (
              <span className="chip chip-neutral">Receipt on file</span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] text-ink-soft">
            {formatDate(payment.date)} — {company.name}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {payment.deletedAt ? (
            <form action={undelete}>
              <button type="submit" className="btn btn-primary">
                Restore
              </button>
            </form>
          ) : (
            <ConfirmDelete
              action={drop}
              subject={payment.paymentNo}
              warning="It will stop counting towards expenditure. The receipt is kept, so a restore puts everything back."
            />
          )}
          <Link href={`/${company.slug}/misc`} className="btn btn-ghost">
            ← Payments
          </Link>
        </div>
      </div>

      {/* ---- the record ---------------------------------------------------- */}
      <section className="card mb-5 overflow-hidden">
        <dl className="divide-y divide-ink-line">
          <Field label="Amount">
            <span className="mono text-[16px] font-bold">
              {payment.currency} {formatMoney(payment.amount, payment.currency)}
            </span>
          </Field>
          <Field label="Date paid">{formatDate(payment.date)}</Field>
          <Field label="What it was for">
            <span className="whitespace-pre-wrap">{payment.notes}</span>
          </Field>
        </dl>

        <p className="border-t border-ink-line bg-wash-soft px-5 py-3 text-[12.5px] text-ink-soft">
          Logged {stamp(payment.createdAt)}
          {payment.updatedAt !== payment.createdAt
            ? ` · last changed ${stamp(payment.updatedAt)}`
            : ""}
          {payment.deletedAt ? ` · deleted ${stamp(payment.deletedAt)}` : ""}
        </p>
      </section>

      {/* ---- the receipt --------------------------------------------------- */}
      {payment.deletedAt ? null : (
        <section className="card mb-5 overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold">Proof of payment</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                {payment.proofKey ? (
                  <>
                    <span className="mono">{payment.proofName}</span>, filed{" "}
                    {stamp(payment.proofAt)}.
                  </>
                ) : (
                  // Stated as ordinary rather than as a warning. Plenty of these
                  // will never have a document, and a screen that treats that as
                  // an error is a screen that is wrong most of the time.
                  "Nothing on file. That is fine — the payment counts either way."
                )}
              </p>
            </div>
            {payment.proofKey ? (
              <form action={unfile} className="shrink-0">
                <button type="submit" className="btn btn-quiet px-3 py-2 text-[13px]">
                  Remove
                </button>
              </form>
            ) : null}
          </header>

          {payment.proofKey ? (
            <div className="px-5 py-4">
              <ScanPreview
                fileKey={payment.proofKey}
                version={payment.proofAt}
                alt={`Receipt for ${payment.paymentNo}`}
                openLabel="Open receipt"
                maxHeight="520px"
              />
            </div>
          ) : null}

          <form action={file} className="border-t border-ink-line bg-wash-soft px-5 py-4">
            <div className="flex flex-wrap items-start gap-3">
              <ReceiptField
                id="attach"
                name="proof"
                label={payment.proofKey ? "Replace it" : "Attach a receipt"}
                hint="Photo or PDF — photos are shrunk automatically."
              />
              <button type="submit" className="btn btn-ghost mt-[1.6rem]">
                {payment.proofKey ? "Replace" : "Attach"}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ---- correct it ---------------------------------------------------- */}
      {payment.deletedAt ? null : (
        <>
          <h2 className="mb-3 text-[16px] font-semibold">Correct this payment</h2>
          <MiscForm
            action={save}
            payment={payment}
            company={company.name}
            submitLabel="Save changes"
            cancelHref={`/${company.slug}/misc`}
            paymentNo={payment.paymentNo}
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
