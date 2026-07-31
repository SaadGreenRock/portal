import { notFound } from "next/navigation";
import { addSignatory, removeSignatory } from "@/lib/actions";
import { getCompany } from "@/lib/companies";
import { backend, store } from "@/lib/db";
import { periodOf } from "@/lib/db/shared";

export default async function Settings({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const db = await store();
  const [signatories, counts] = await Promise.all([
    db.listSignatories(company.slug),
    db.counts(company.slug),
  ]);

  const add = addSignatory.bind(null, company.slug);
  const period = periodOf();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">{company.name} settings</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          These apply to {company.name} only — the other workspace is untouched.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* ---- signatories --------------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Authorized signatories</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
              Names that can be printed on the company signature line, chosen from a
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
            <h2 className="text-[15px] font-semibold">Voucher numbering</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
              Numbers are assigned the moment a voucher is generated, and are never reused
              or renumbered. The sequence restarts at 001 on the 1st of each month, and is
              counted separately from the other company.
            </p>
            <div className="mono mt-3.5 rounded-lg bg-[#f7f7f5] px-3.5 py-3 text-[14px]">
              {company.prefix}-{period}-001
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-[15px] font-semibold">This workspace</h2>
            <dl className="mt-3 space-y-2 text-[13.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Vouchers issued</dt>
                <dd className="mono">{counts.total}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Awaiting signed scan</dt>
                <dd className="mono">{counts.pending}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Completed</dt>
                <dd className="mono">{counts.completed}</dd>
              </div>
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
