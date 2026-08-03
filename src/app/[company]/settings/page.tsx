import { notFound } from "next/navigation";
import { addSignatory, removeSignatory } from "@/lib/actions";
import { getCompany } from "@/lib/companies";
import { backend, store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { periodOf } from "@/lib/db/shared";
import { CURRENCY_LIST } from "@/lib/money";
import { savePoSettings } from "@/lib/po/actions";

export default async function Settings({
  params,
  searchParams,
}: {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { company: slug } = await params;
  const { saved } = await searchParams;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  // The voucher half of this screen must keep working even when the purchase
  // order module has never been migrated onto this database.
  const [signatories, counts, poCountsResult, settingsResult] = await Promise.all([
    db.listSignatories(company.slug),
    db.counts(company.slug),
    tryTable(() => db.poCounts(company.slug)),
    tryTable(() => db.getSettings(company.slug)),
  ]);
  const poCounts = poCountsResult.ok ? poCountsResult.value : null;
  const settings = settingsResult.ok ? settingsResult.value : null;

  const add = addSignatory.bind(null, company.slug);
  const savePo = savePoSettings.bind(null, company.slug);
  const period = periodOf();
  const po = settings?.po ?? null;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">{company.name} settings</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          These apply to {company.name} only — the other workspace is untouched.
        </p>
      </div>

      {saved ? (
        <div
          className="mb-5 rounded-xl border p-4"
          style={{ borderColor: "var(--accent)", background: "var(--accent-wash)" }}
        >
          <p className="text-[13.5px] font-medium">Saved. New purchase orders will use these.</p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* ---- purchase order defaults --------------------------------- */}
        <section className="card overflow-hidden lg:row-span-2">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Purchase order defaults</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
              What every new order starts with. Any of it can still be changed on an
              individual order without touching these.
            </p>
          </header>

          {!po ? (
            <p className="px-5 py-6 text-[13.5px] leading-relaxed text-ink-soft">
              Purchase orders are not set up on this database yet, so there is nothing to
              configure. Run{" "}
              <code className="rounded bg-[#f4f4f2] px-1.5 py-0.5 font-mono text-[12.5px] text-ink">
                supabase/migration.sql
              </code>{" "}
              and reload. Signatories and voucher numbering below are unaffected.
            </p>
          ) : (

          <form action={savePo} className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Currency</span>
                <select name="currency" defaultValue={po.currency} className="input mt-1.5">
                  {CURRENCY_LIST.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Tax label</span>
                  <input
                    name="taxLabel"
                    defaultValue={po.taxLabel}
                    placeholder="GST"
                    className="input mt-1.5"
                  />
                </label>
                <label className="block">
                  <span className="label">Rate %</span>
                  <input
                    name="taxRate"
                    defaultValue={po.taxRate}
                    inputMode="decimal"
                    className="input mt-1.5 text-right"
                  />
                </label>
              </div>
            </div>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                name="showTax"
                value="1"
                defaultChecked={po.showTax}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[13.5px] leading-snug">
                Show a tax row on purchase orders
                <span className="block text-[12px] text-ink-soft">
                  Off means orders print a subtotal and a total only.
                </span>
              </span>
            </label>

            <label className="block">
              <span className="label">Default payment terms</span>
              <input
                name="paymentTerms"
                defaultValue={po.paymentTerms}
                placeholder="30 days from invoice"
                className="input mt-1.5"
              />
            </label>

            <label className="block">
              <span className="label">Default delivery address</span>
              <span className="mt-0.5 block text-[12px] text-ink-soft">
                Prints as the Ship To block. Usually your office or main site.
              </span>
              <textarea
                name="deliveryAddress"
                defaultValue={po.deliveryAddress}
                rows={3}
                className="input mt-1.5 resize-y"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Prepared by</span>
                <input name="preparedBy" defaultValue={po.preparedBy} className="input mt-1.5" />
              </label>
              <label className="block">
                <span className="label">Approved by</span>
                <input name="approvedBy" defaultValue={po.approvedBy} className="input mt-1.5" />
              </label>
            </div>

            <label className="block">
              <span className="label">Terms and conditions</span>
              <span className="mt-0.5 block text-[12px] text-ink-soft">
                Printed at the foot of every order. One numbered clause per line.
              </span>
              <textarea
                name="terms"
                defaultValue={po.terms}
                rows={8}
                className="input mt-1.5 resize-y text-[13px]"
              />
            </label>

            <button type="submit" className="btn btn-primary">
              Save purchase order defaults
            </button>
          </form>
          )}
        </section>

        {/* ---- signatories --------------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Authorized signatories</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
              Names that can be printed on the voucher signature line, chosen from a
              dropdown instead of retyped. Add a new one whenever signing authority changes.
            </p>
          </header>

          {signatories.length > 0 ? (
            <ul className="divide-y divide-ink-line">
              {signatories.map((s) => {
                const drop = removeSignatory.bind(null, company.slug, s.id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="truncate text-[14px]">{s.name}</span>
                    <form action={drop}>
                      <button type="submit" className="btn btn-quiet px-2.5 py-1 text-[12.5px]">
                        Remove
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13.5px] text-ink-soft">
              No signatories saved yet. Until one is added, the Authorized Person Name
              field stays blank for handwriting.
            </p>
          )}

          <form action={add} className="flex gap-2 border-t border-ink-line px-5 py-4">
            <input
              name="name"
              required
              placeholder="Full name as it should print"
              className="input"
            />
            <button type="submit" className="btn btn-primary shrink-0">
              Add
            </button>
          </form>
        </section>

        {/* ---- reference ----------------------------------------------- */}
        <section className="space-y-5">
          <div className="card p-5">
            <h2 className="text-[15px] font-semibold">Document numbering</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
              Numbers are assigned the moment a document is created, and are never reused
              or renumbered. Each sequence restarts at 001 on the 1st of each month, and is
              counted separately per company and per document type.
            </p>
            <div className="mono mt-3.5 space-y-1.5 rounded-lg bg-[#f7f7f5] px-3.5 py-3 text-[14px]">
              <div>{company.prefix}-{period}-001</div>
              <div>{company.prefix}-PO-{period}-001</div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-[15px] font-semibold">This workspace</h2>
            <dl className="mt-3 space-y-2 text-[13.5px]">
              <Line label="Vouchers issued" value={counts.total} />
              <Line label="Awaiting signed scan" value={counts.pending} />
              <Line label="Purchase orders raised" value={poCounts?.total ?? "—"} />
              <Line label="Orders still open" value={poCounts?.open ?? "—"} />
              <div className="flex justify-between gap-3 border-t border-ink-line pt-2">
                <dt className="text-ink-soft">Storage</dt>
                <dd className="mono">
                  {backend === "supabase" ? "Supabase" : "Local disk (./.data)"}
                </dd>
              </div>
            </dl>
            {backend === "local" ? (
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
                Running locally. To upload scans from a phone, switch{" "}
                <code className="font-mono">BACKEND</code> to{" "}
                <code className="font-mono">supabase</code> and deploy — see the README.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function Line({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}
