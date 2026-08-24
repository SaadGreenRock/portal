import Link from "next/link";
import { notFound } from "next/navigation";
import MiscForm from "@/components/MiscForm";
import { getCompany } from "@/lib/companies";
import { createMisc } from "@/lib/misc/actions";
import { emptyMisc } from "@/lib/misc/types";
import { todayIso } from "@/lib/format";

/**
 * Logging a payment.
 *
 * Dated today and in Rupees, which is much the commonest case: somebody paid
 * something small this morning and is writing it down before they forget.
 *
 * The receipt picker is offered here and only here — see `withProof` on
 * MiscForm. A receipt in hand while typing should not need a second screen, and
 * one that turns up later has the record's own panel waiting for it.
 */
export default async function NewMiscPayment({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  const log = createMisc.bind(null, company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">New payment</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Saving assigns the next {company.prefix}-MP number for this month.
        </p>
      </div>

      {/* Said before the form rather than after it. The shortest form in the
          portal is a standing temptation to use for something that should have
          been signed for, and the moment to say so is before it is filled in. */}
      <div className="card mb-5 border-l-[3px] border-l-[var(--accent)] px-5 py-4">
        <p className="text-[13.5px] leading-relaxed">
          For the payments nobody signs for — parking, a courier, a tip, a
          top-up. If somebody <em>can</em> be made to sign for it, raise a{" "}
          <Link href={`/${company.slug}/vouchers/new`} className="underline">
            voucher
          </Link>{" "}
          instead: it prints, it is acknowledged, and the signed copy comes back
          to the file.
        </p>
      </div>

      <MiscForm
        action={log}
        payment={emptyMisc(todayIso())}
        company={company.name}
        submitLabel="Log payment"
        cancelHref={`/${company.slug}/misc`}
        paymentNo={null}
        withProof
      />
    </>
  );
}
