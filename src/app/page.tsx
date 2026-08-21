import { Suspense } from "react";
import NavPending from "@/components/NavPending";
import Link from "next/link";
import { redirect } from "next/navigation";
import HeaderControls from "@/components/HeaderControls";
import { isAuthenticated } from "@/lib/auth";
import { COMPANY_LIST } from "@/lib/companies";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { formatMoney } from "@/lib/money";
import { summarise } from "@/lib/spend/types";
import { stand, summariseFunding } from "@/lib/tranches/types";

/**
 * Landing screen. Choosing a company is the top-level act — the two workspaces
 * share nothing downstream, so this is a fork in the road rather than a filter.
 *
 * Behind the password, like every other screen. It used to be in front of it,
 * showing the two cards to anyone and sending them to the lock screen on the way
 * through — which meant picking a company, being asked for a password, landing
 * back here, and picking the same company a second time. The fork is only worth
 * offering to somebody who can actually walk down either road.
 */
export default async function Landing() {
  if (!(await isAuthenticated())) redirect("/login");

  return (
    <>
      {/* This is the screen unlocking always lands on, so the header furniture
          lives here too — the clock, the theme and Lock, in the same corner and
          in the same order as on every other screen. */}
      <div className="sticky top-0 z-10 flex justify-end border-b border-ink-line bg-card px-5 py-2">
        <HeaderControls />
      </div>

      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-5 py-16">
        <header className="mb-10">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">
            Company Portal
          </h1>
          <p className="mt-2 text-[15px] text-ink-soft">
            Choose a company to open its workspace.
          </p>
        </header>

        {/* The cards wait on a dozen queries; the title, the clock and Lock wait
            on nothing. Streaming one behind the other means the screen unlocking
            lands on paints its furniture at once and fills the figures in,
            rather than holding all of it back for the slowest count.

            Deliberately a boundary here rather than a loading.tsx beside this
            file. One at this level is the fallback for everything below it that
            has no boundary of its own — so on the way in it would put a wash of
            company cards in front of the lock screen itself, and again in front
            of Help. Scoped to the part that actually waits, it cannot. */}
        <Suspense fallback={<PickerSkeleton />}>
          <Picker />
        </Suspense>

        {/* Last, and quiet. Somebody who runs this every week never needs it;
            somebody covering the desk for a fortnight needs it on the first
            screen, with nobody to ask. */}
        <Link
          href="/help"
          className="mt-5 block text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          New to this? How the portal works →
        </Link>
      </main>
    </>
  );
}

/**
 * The four ways in, and what is waiting behind each.
 *
 * Split out from the screen around it for one reason: everything in here awaits
 * the database, and nothing in the shell above does. Held together in one
 * component the whole landing screen would wait on the slowest of a dozen
 * counts — which is what it did — and the operator would watch an empty page
 * having just proved who they were.
 */
async function Picker() {
  const db = await store();

  // Outstanding work is the one thing worth surfacing before you pick: which
  // workspace has vouchers waiting on a signed scan, and which has orders still
  // out with a vendor.
  const cards = await Promise.all(
    COMPANY_LIST.map(async (company) => ({
      company,
      vouchers: await db.counts(company.slug),
      // Tolerated: an unmigrated purchase order module must not stop the landing
      // page from listing the companies.
      po: await tryTable(() => db.poCounts(company.slug)),
    })),
  );

  // Not per company: food belongs to neither. Tolerated for the same reason as
  // the orders above — a missing table must not blank the landing page.
  const food = await tryTable(() => db.foodCounts());

  /**
   * The combined figure, on the card rather than behind it.
   *
   * The same rows and the same `summarise` the report itself uses — not a
   * shortcut sum — so the number here and the number one click away can never
   * disagree. All time, matching what /spend opens on.
   *
   * Every part is tolerated separately: a module that is not set up contributes
   * nothing and the rest of the figure still shows, which is the same bargain
   * the report makes.
   */
  const spend = summarise(
    (
      await Promise.all([
        ...COMPANY_LIST.map((c) => tryTable(() => db.spendRows(c.slug))),
        tryTable(() => db.foodSpendRows()),
      ])
    ).flatMap((p) => (p.ok ? p.value : [])),
  );

  /**
   * Money received from the investor and not yet spoken for.
   *
   * Deliberately this figure and not the work queue, which would be the more
   * tempting one. The queue moves whenever a voucher is raised in either
   * company, so keeping it fresh here would mean the two workspaces revalidating
   * a page they otherwise know nothing about. What is unallocated in open
   * tranches only ever changes when the funding section itself writes, so it can
   * never go stale from activity elsewhere.
   *
   * Tolerated like the rest: an unmigrated funding table contributes nothing and
   * the card still offers the way in.
   */
  const fundingResult = await tryTable(() => db.fundingLedger());
  const funding = fundingResult.ok
    ? summariseFunding(fundingResult.value.map((l) => stand(l.tranche, l.debits)))
    : null;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ company, vouchers, po }) => {
          return (
            <Link
              key={company.slug}
              // The workspace overview, not a blank voucher form. Choosing a
              // company says which company, not which document — and whoever
              // is covering the desk this week needs to see what is waiting
              // before being handed something to type into.
              href={`/${company.slug}`}
              className="card card-link group relative flex flex-col gap-5 p-6"
            >
              {/* Neither logo is dark — Green Rock's is white, Sportech's is
                  that acid yellow — so the panel behind them is what makes
                  them legible at all. Green Rock states its own teal; Sportech
                  has none to state and takes the theme's quiet fill, pale by
                  day as it has always been and dark at night, where yellow is
                  finally the right way round. */}
              <div
                className={`flex h-20 items-center justify-center rounded-lg px-5 ${
                  company.theme.headerBar ? "" : "bg-wash"
                }`}
                style={
                  company.theme.headerBar
                    ? { background: company.theme.headerBar }
                    : undefined
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={company.logo}
                  alt={company.name}
                  className="max-h-11 w-auto max-w-full object-contain"
                />
              </div>

              <div>
                <div className="text-[17px] font-semibold">{company.name}</div>
                <div className="mono mt-1 text-[13px] text-ink-soft">
                  Vouchers · Purchase orders
                </div>
              </div>

              <div className="space-y-1 text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={
                      vouchers.pending > 0 ? "font-semibold text-amber-700" : "text-ink-soft"
                    }
                  >
                    {vouchers.pending} awaiting signature
                  </span>
                  <span className="mono text-ink-soft">{vouchers.total}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={
                      po.ok && po.value.open > 0 ? "font-semibold text-ink" : "text-ink-soft"
                    }
                  >
                    {po.ok
                      ? `${po.value.open} open ${po.value.open === 1 ? "order" : "orders"}`
                      : "purchase orders not set up"}
                  </span>
                  <span className="mono text-ink-soft">{po.ok ? po.value.total : "—"}</span>
                </div>
              </div>

              {/* The workspace shell counts vouchers, orders and quotes before it
                  can paint anything at all — its own skeleton included — so
                  without this a pressed company card sits there looking unpressed
                  for the length of three queries. */}
              <NavPending className="inset-x-6 bottom-0" />
            </Link>
          );
        })}
      </div>

      {/* Below the fork in the road, because neither belongs to one company. */}
      <Link href="/food" className="card card-link relative mt-4 flex items-center gap-4 p-5">
        <Tile
          day={{ wash: "#f7f1e8", ink: "#8a6534" }}
          night={{ wash: "#2a2015", ink: "#d9a76a" }}
        >
          <FoodMark />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Food &amp; refreshments</div>
          <div className="mt-0.5 text-[13px] text-ink-soft">
            Lunches, snacks and drinks. Both companies, one log.
          </div>
        </div>
        {food.ok && food.value.pending > 0 ? (
          <span className="mono shrink-0 text-right text-[13px] font-semibold text-amber-700">
            ₨ {formatMoney(food.value.totalOutstanding)}
            <span className="block text-[11.5px] font-normal text-ink-soft">
              {food.value.pending} owed
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-[13px] text-ink-soft">Open →</span>
        )}
        <NavPending className="inset-x-5 bottom-0" />
      </Link>

      <Link href="/spend" className="card card-link relative mt-3 flex items-center gap-4 p-5">
        <Tile
          day={{ wash: "#eef4f4", ink: "#104751" }}
          night={{ wash: "#152625", ink: "#4fb3a1" }}
        >
          <SpendMark />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Expenditure</div>
          <div className="mt-0.5 text-[13px] text-ink-soft">
            Both companies together, and each on its own.
          </div>
        </div>
        {/* Every currency, never summed across them — the one rule the report
            is built on, which a single figure here would break. */}
        {spend.byCurrency.length > 0 ? (
          <span className="shrink-0 text-right">
            {spend.byCurrency.map((t) => (
              <span key={t.currency} className="mono block text-[15px] font-bold leading-tight">
                {t.currency} {formatMoney(t.total, t.currency)}
              </span>
            ))}
            <span className="mt-0.5 block text-[11.5px] font-normal text-ink-soft">
              all time
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-[13px] text-ink-soft">Open →</span>
        )}
        <NavPending className="inset-x-5 bottom-0" />
      </Link>

      <Link href="/funding" className="card card-link relative mt-3 flex items-center gap-4 p-5">
        <Tile
          day={{ wash: "#eef1f8", ink: "#2f4470" }}
          night={{ wash: "#171d2b", ink: "#93aae0" }}
        >
          <FundingMark />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Funding &amp; tranches</div>
          <div className="mt-0.5 text-[13px] text-ink-soft">
            Dollars in, rupees out, and what each tranche paid for.
          </div>
        </div>
        {/* What is left to spend, per currency — never summed across them,
            the same rule the expenditure figure above follows. */}
        {funding && funding.available.length > 0 ? (
          <span className="shrink-0 text-right">
            {funding.available.map((t) => (
              <span key={t.currency} className="mono block text-[15px] font-bold leading-tight">
                {t.currency} {formatMoney(t.total, t.currency)}
              </span>
            ))}
            <span className="mt-0.5 block text-[11.5px] font-normal text-ink-soft">
              left to spend
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-[13px] text-ink-soft">Open →</span>
        )}
        <NavPending className="inset-x-5 bottom-0" />
      </Link>
    </>
  );
}

/**
 * The wash of what is arriving: two company cards, then the three sections
 * underneath them.
 *
 * The same three tones as the workspace skeleton and in the same order —
 * strongest for a name, middle for a line of body, faintest for a figure — so
 * the two screens read as one convention rather than two guesses — including
 * the light that crosses them, which is one sweep per screen and so arrives here
 * without this component having to ask for it.
 *
 * Sized off the cards it stands in for rather than by eye. `<main>` centres its
 * column vertically, so a skeleton of the wrong height would drop the title and
 * the cards a few pixels when the figures land — the one movement on this screen
 * nobody would read as deliberate.
 */
function PickerSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="card flex flex-col gap-5 p-6">
            {/* The logo plate, which is a filled band on the real card in both
                themes — so here it is the one part that takes the middle tone
                rather than the faintest. */}
            <div className="h-20 rounded-lg bg-wash" />
            <div>
              <div className="h-4 w-40 rounded bg-wash-strong" />
              <div className="mt-2 h-3 w-32 rounded bg-wash" />
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <div className="h-3 w-36 rounded bg-wash" />
                <div className="h-3 w-6 rounded bg-wash-soft" />
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="h-3 w-28 rounded bg-wash" />
                <div className="h-3 w-6 rounded bg-wash-soft" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Food, Expenditure and Funding: a tile, two lines, and a figure at the
          right end that is a total on one and "Open →" on another. */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`card flex items-center gap-4 p-5 ${i === 0 ? "mt-4" : "mt-3"}`}
        >
          <div className="h-11 w-11 shrink-0 rounded-lg bg-wash" />
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-44 rounded bg-wash-strong" />
            <div className="mt-2 h-3 w-64 max-w-full rounded bg-wash" />
          </div>
          <div className="h-3 w-16 shrink-0 rounded bg-wash-soft" />
        </div>
      ))}
    </div>
  );
}

/**
 * The square a mark sits in.
 *
 * Same `rounded-lg` as the logo panel on a company card, so the four cards read
 * as one set — but a square rather than that panel's full-width band, because
 * these two are single rows and a band would tower over one line of text.
 *
 * The wash is pale enough that the mark stays the darkest thing in it, and each
 * tile borrows the colour its own section already uses elsewhere: the warm brown
 * of the food dot on the expenditure report, and the portal's teal.
 *
 * Both a day pair and a night pair, because the relationship reverses: by day
 * the tile is a pale wash with the mark as the darkest thing on it, by night it
 * is a deep one with the mark as the lightest. Inverting a hue by formula gets
 * the arithmetic right and the colour wrong, so each is named.
 */
function Tile({
  day,
  night,
  children,
}: {
  day: { wash: string; ink: string };
  night: { wash: string; ink: string };
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="swatch flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
      style={
        {
          "--swatch": day.wash,
          "--swatch-ink": day.ink,
          "--swatch-dark": night.wash,
          "--swatch-ink-dark": night.ink,
        } as React.CSSProperties
      }
    >
      {children}
    </span>
  );
}

/**
 * Marks, not emoji.
 *
 * Emoji are drawn by the operating system, so the same character is a flat
 * glyph on one machine and a glossy cartoon on another — nothing here could
 * hold a consistent weight beside Poppins and the greys. These are strokes at
 * the same width as the rest of the interface, and they inherit `currentColor`
 * from the tile, so a colour change is one number.
 *
 * `aria-hidden` sits on the tile: each card already has its name in text, and a
 * mark that announced itself would make a screen reader say it twice.
 */
const strokes = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Fork and spoon — lunches and drinks both, where a cup would mean only one.
 * A knife rather than a spoon reduces to a sliver at this size and stops
 * reading as cutlery at all.
 */
function FoodMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" {...strokes}>
      <path d="M6.5 3v5a2.5 2.5 0 0 0 5 0V3" />
      <path d="M9 10.5V21" />
      <path d="M17.5 21v-6.5" />
      <path d="M17.5 14.5c1.8 0 2.8-2 2.8-5.2S19.3 3 17.5 3s-2.8 3-2.8 6.3 1 5.2 2.8 5.2Z" />
    </svg>
  );
}

/**
 * An arrow landing in an open tray — money arriving, rather than money counted.
 *
 * Deliberately not a coin or a currency glyph: a dollar sign would say which
 * currency, and the whole subject of the section is that two are involved. The
 * tray is open at the top because a tranche is a bucket that gets drawn down,
 * not a sealed total.
 */
function FundingMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" {...strokes}>
      <path d="M4 13.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-5.5" />
      <path d="M12 3.5v8" />
      <path d="M8.5 8l3.5 3.5L15.5 8" />
    </svg>
  );
}

/** Rising bars on a baseline — a report of figures, rather than a coin. */
function SpendMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" {...strokes}>
      <path d="M4 20h16" />
      <path d="M7.5 20v-4.5" />
      <path d="M12 20v-8.5" />
      <path d="M16.5 20v-12.5" />
    </svg>
  );
}
