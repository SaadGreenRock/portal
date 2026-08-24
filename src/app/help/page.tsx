import Link from "next/link";
import { redirect } from "next/navigation";
import HeaderControls from "@/components/HeaderControls";
import HomeButton from "@/components/HomeButton";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST } from "@/lib/companies";
import { periodOf } from "@/lib/db/shared";
import { MODULES } from "@/lib/modules";

/**
 * How the portal works, for whoever is sitting at it.
 *
 * The portal is run by one person, but not always the same person — the desk
 * gets handed over for a holiday, and the next operator arrives with no tour
 * and nobody to ask. Everything explained here was previously only written
 * down in the source comments, which is to say it was not written down at all
 * for the person who needs it.
 *
 * Deliberately outside /[company]: none of it is company-specific, and it has
 * to be readable before you have picked a workspace. Kept to what someone
 * cannot work out by looking at a screen — the lifecycles, the numbering rule,
 * and which things are shared between the two companies. Anything obvious from
 * the interface itself is left out; a help page that narrates the buttons is a
 * help page nobody finishes.
 */

export const metadata = { title: "How the portal works" };

export default async function Help() {
  if (!(await isAuthenticated())) redirect("/login");

  const period = periodOf();
  const [first] = COMPANY_LIST;

  return (
    // No accent of its own: help belongs to no company, so it keeps the
    // portal's, which globals.css states for both themes. Restating it here
    // would restate only the light half.
    <div>
      <header className="sticky top-0 z-10 border-b border-ink-line bg-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* The way back, at the start of the header rather than the end of
              it — see HomeButton. The negative margin pulls the glyph out to the
              container's own left edge, so it lines up with the prose below
              rather than sitting a padding-width inside it. */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <HomeButton className="btn btn-quiet -ml-2.5 p-2.5" />
            <div className="min-w-0">
              <h1 className="text-[17px] font-bold tracking-tight">How the portal works</h1>
              <p className="text-[12.5px] text-ink-soft">
                Everything you need to run it for someone else
              </p>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <HeaderControls />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
        <Section title="The one rule">
          <p>
            Every document gets a number the moment it is created, and that number is never
            reused, renumbered or given to anything else. Deleting a document does not free its
            number — a deleted voucher stays deleted <em>and</em> stays spent, so the sequence
            still reads straight when somebody audits it a year from now.
          </p>
          <p>
            This is why nothing in the portal asks you to confirm a number, and why a mistake is
            corrected by editing or deleting the document rather than by making the number go
            away.
          </p>
        </Section>

        <Section title="Where things live">
          <p>
            <strong>{COMPANY_LIST.map((c) => c.name).join(" and ")}</strong> are separate
            workspaces. They share nothing: separate numbering, separate history, separate
            settings. A document raised in one is invisible in the other, and that is deliberate.
          </p>
          <p>
            <strong>Food</strong> and <strong>Expenditure</strong> sit outside both, and you reach
            them from the company picker or the right-hand end of the workspace bar. Food is
            outside because roughly a quarter of the orders were bought for both companies at
            once — one lunch, two companies at the table — so an entry belongs to neither.
            Expenditure is outside because its whole point is the combined figure.
          </p>
        </Section>

        <Section title="Numbering">
          <p>
            Numbers restart at 001 on the 1st of each month, and are counted separately per
            company and per document type. Today&rsquo;s sequences for {first.name} look like
            this:
          </p>
          <div className="mono mt-3 space-y-1.5 rounded-lg bg-page px-3.5 py-3 text-[13.5px]">
            <div>
              {first.prefix}-{period}-001 <span className="text-ink-soft">— voucher</span>
            </div>
            <div>
              {first.prefix}-PO-{period}-001 <span className="text-ink-soft">— purchase order</span>
            </div>
            <div>
              {first.prefix}-RFQ-{period}-001{" "}
              <span className="text-ink-soft">— quotation request</span>
            </div>
            <div>
              {first.prefix}-A-001 <span className="text-ink-soft">— asset, one running sequence</span>
            </div>
            <div>
              F-{period}-001 <span className="text-ink-soft">— food entry, no company prefix</span>
            </div>
          </div>
        </Section>

        <Section title="What each section is for">
          <dl className="space-y-3">
            {MODULES.map((m) => (
              <div key={m.key}>
                <dt className="text-[14px] font-semibold">{m.label}</dt>
                <dd className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">{m.blurb}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[14px] font-semibold">Food &amp; refreshments</dt>
              <dd className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">
                Lunches, snacks and drinks for both companies, and who is still owed for them.
              </dd>
            </div>
            <div>
              <dt className="text-[14px] font-semibold">Expenditure</dt>
              <dd className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">
                What has been spent, per company and combined, from vouchers, purchase orders and
                the food log.
              </dd>
            </div>
          </dl>
        </Section>

        <Section title="A voucher, start to finish">
          <Steps
            steps={[
              ["New voucher", "Fill in what is known. Anything switched off prints as a blank line to be written in by hand — that is the normal way to handle a detail you do not have yet."],
              ["Print it", "Saving assigns the number and renders the PDF. Print that PDF; do not retype it."],
              ["Get it signed", "In person, on paper. The portal never replaces the signature."],
              ["Upload the scan", "Photograph or scan the signed copy and upload it from the voucher's own page, or from the Pending tab. Photos taken on a phone are shrunk automatically."],
            ]}
          />
          <p className="mt-3">
            A voucher counts as <strong>pending</strong> until its signed scan is on file. The
            number beside <em>Vouchers</em> in the workspace bar is how many are still waiting —
            if it is not zero, that is the work.
          </p>
        </Section>

        <Section title="Purchase orders and quotation requests">
          <p>
            A <strong>quotation request</strong> is the same list of items as an order with the
            prices left blank, sent out so vendors can fill them in. A{" "}
            <strong>purchase order</strong> is what you raise once you know the price and have
            decided to buy. In practice one leads to the other, but neither requires the other.
          </p>
          <p>Both move through the same four states:</p>
          <dl className="mt-2.5 space-y-2 text-[13.5px]">
            <State name="Draft">
              Written but not sent. Nothing has left the building; edit or delete it freely.
            </State>
            <State name="Issued / Sent">
              The vendor has it. Still editable — correcting a quantity on an order the vendor
              already holds is a real thing that happens — but assume they are working from the
              copy you sent.
            </State>
            <State name="Closed">
              Done with. The goods arrived, or the quotes came back and you chose one.
            </State>
            <State name="Cancelled">
              Abandoned. The number stays spent, and it is the one state change the portal asks
              you to confirm, because the vendor may already hold a copy.
            </State>
          </dl>
          <p className="mt-3">
            The <strong>Open</strong> tab is everything still in the first two states, sorted by
            what is most urgent rather than by date — an overdue delivery leads, because it is the
            one that needs a phone call.
          </p>
        </Section>

        <Section title="Assets">
          <p>
            An asset goes on the register because somebody is being given it, so logging the item
            and handing it over are one step. Write the number the portal assigns onto the item
            itself.
          </p>
          <p>
            After that, everything happens on the asset&rsquo;s own page: record a return when it
            comes back, allot it to somebody else when it goes out again. Every holder it has ever
            had is kept, so &ldquo;who had this before Aslam&rdquo; is always answerable. An asset
            being out with somebody is the normal state and is not a task — only{" "}
            <strong>damaged or lost</strong> is something to act on.
          </p>
        </Section>

        <Section title="Food, and who is owed">
          <p>Two facts about a food entry are independent, and mixing them up is the usual error:</p>
          <dl className="mt-2.5 space-y-2 text-[13.5px]">
            <State name="Payment type">
              Who fronted the money. <em>Deferred</em> means the café is running a tab for us;{" "}
              <em>employee paid</em> means somebody paid out of their own pocket.
            </State>
            <State name="Payment status">
              Whether that café or that person has been squared up yet.
            </State>
          </dl>
          <p className="mt-3">
            The <strong>Outstanding</strong>{" "}
            tab is where both get settled, and it separates them
            on purpose: money owed to an employee who is personally out of pocket and money owed
            to a café on a tab get paid by different people on different days. One café&rsquo;s
            whole tab is settled in a single press, with the individual orders listed above the
            button so the figure can be checked against what they are actually asking for.
          </p>
          <p>
            The calendar underneath shows the same debts written onto the day they were ordered,
            which is how you spot that it is every Tuesday, or that a fortnight went unsettled
            while nobody was in to sign a cheque.
          </p>
        </Section>

        <Section title="If something goes wrong">
          <p>
            <strong>An error screen.</strong> Press <em>Try again</em>. Nothing is lost when a
            screen fails — the portal is failing to show records, not to keep them. If it keeps
            happening, send the reference under &ldquo;Technical details&rdquo; to whoever
            maintains the portal.
          </p>
          <p>
            <strong>&ldquo;Not switched on yet.&rdquo;</strong> That section needs enabling on the
            database. It is not something to fix from here — ask whoever maintains the portal.
          </p>
          <p>
            <strong>An upload that will not go through.</strong> Photograph the document rather
            than scanning it at full resolution. A full-resolution scan is often too large; a
            phone photo of the same page is not, and is shrunk automatically on the way.
          </p>
          <p>
            <strong>A PDF that did not render.</strong> The document and its number are already
            safe. Open it and press <em>Render PDF</em>; if that keeps failing, try a different
            browser.
          </p>
        </Section>

        <Section title="Handing the desk over">
          <p>
            The portal has one password and no individual accounts, which is deliberate — one
            person runs it at a time. When that person changes, the handover is the password.
          </p>
          <p>
            <strong>When you take the desk back, change the password.</strong> Changing it signs
            out every session everywhere, immediately, including any the stand-in left open on
            their own phone. Until it is changed, their access continues.
          </p>
          <p>
            The padlock in the top corner locks the portal on this device. It is worth pressing on
            a shared machine; it is not a substitute for changing the password after a handover.
          </p>
        </Section>

        <p className="mt-9 text-[12.5px] leading-relaxed text-ink-soft">
          Nothing here changes anything. Every screen it describes is reachable from the{" "}
          <Link href="/" className="underline">
            company picker
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 border-t border-ink-line pt-5 first:border-t-0 first:pt-0">
      <h2 className="mb-2.5 text-[17px] font-bold tracking-tight">{title}</h2>
      <div className="space-y-2.5 text-[14px] leading-relaxed [&_p]:text-ink">{children}</div>
    </section>
  );
}

function State({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 font-semibold sm:w-40">{name}</dt>
      <dd className="text-ink-soft">{children}</dd>
    </div>
  );
}

/** A sequence where the order genuinely matters — the voucher lifecycle does. */
function Steps({ steps }: { steps: Array<[string, string]> }) {
  return (
    <ol className="mt-1 space-y-3">
      {steps.map(([title, body], i) => (
        <li key={title} className="flex gap-3.5">
          <span
            aria-hidden
            className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-semibold text-[var(--accent-text)]"
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold">{title}</div>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
