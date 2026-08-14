import Link from "next/link";
import {
  addMonths,
  monthGrid,
  monthOf,
  monthsBetween,
  WEEKDAYS,
} from "@/lib/calendar";
import type { PendingDay } from "@/lib/food/types";
import { formatDate, formatMonth } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * What is still owed, written onto the month it was ordered in.
 *
 * The same debts the payee panels above show, counted a second way — but as a
 * calendar rather than a list, because the question this answers is a shape
 * question. A list of dates says *that* the 4th, the 11th and the 18th are
 * unpaid; a calendar says they are every Tuesday, and shows at a glance where
 * the run starts and where it breaks. Weekday and gap are both readable without
 * reading a single date, which is what the extra vertical space buys.
 *
 * One month at a time, with a step either side of its name — the way a calendar
 * is read anywhere else. It used to print every month that had a debt in it, one
 * under another: fine for the two months that is most of the time, and it made
 * the section unreadable in a year where somebody had been slow to settle, with
 * no way to look at a single month or to ask whether an *empty* one really was
 * empty. Asking that is most of the point.
 *
 * Which month is in the URL, so a month can be linked to and the back button
 * steps through the ones already looked at.
 *
 * Days with nothing outstanding are left blank on purpose: a figure in every cell
 * is a wall of numbers, and blank is unambiguous — nothing is owed from that day.
 *
 * The currency sits in the month header rather than in thirty-one cells. A cell
 * is narrow enough that a repeated "₨ " would be the first thing to push the
 * figure it prefixes out of view.
 */
export default function PendingCalendar({
  days,
  month,
  earliest,
  latest,
  today,
  currency,
  basePath,
}: {
  /** Every day with something owed, in every month — not just the one shown. */
  days: PendingDay[];
  /** The yyyy-mm on screen. Already clamped into `earliest`…`latest`. */
  month: string;
  /** Oldest and newest month worth stepping to. */
  earliest: string;
  latest: string;
  /** Passed in so the server decides which cell is today, not the browser. */
  today: string;
  currency: string;
  /** Where the month links point; the month itself rides in `?month=`. */
  basePath: string;
}) {
  const grid = monthGrid(month);
  const inMonth = days.filter((day) => monthOf(day.date) === month);
  const amount = Math.round(inMonth.reduce((sum, day) => sum + day.amount, 0) * 100) / 100;
  const orders = inMonth.reduce((sum, day) => sum + day.count, 0);
  const owed = new Map(inMonth.map((day) => [day.date, day]));

  const href = (ym: string) => `${basePath}?month=${ym}`;
  const back = addMonths(month, -1);
  const forward = addMonths(month, 1);

  /**
   * The month with a debt in it closest to this one, for when this one has none.
   * Offered rather than jumped to: stepping back through quiet months is how you
   * satisfy yourself they are quiet, and a calendar that moved on its own would
   * take that away.
   */
  const nearestOwing = inMonth.length
    ? null
    : [...new Set(days.map((day) => monthOf(day.date)))].sort(
        (a, b) => Math.abs(monthsBetween(month, a)) - Math.abs(monthsBetween(month, b)),
      )[0];

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-line px-3 py-3 sm:px-5">
        <div className="flex items-center gap-0.5">
          <Step to={month > earliest ? href(back) : null} label={`Go to ${formatMonth(back)}`} />
          {/* A fixed width so the steps do not shuffle sideways between "May
              2026" and "September 2026". A calendar whose arrows move as you use
              them is a calendar you have to aim at. */}
          <h4 className="w-[8.75rem] text-center text-[15px] font-semibold">{grid.label}</h4>
          <Step
            forward
            to={month < latest ? href(forward) : null}
            label={`Go to ${formatMonth(forward)}`}
          />
        </div>

        <p className="shrink-0 pl-1 text-[12.5px] text-ink-soft">
          {orders > 0 ? (
            <>
              <span className="mono text-[15px] font-bold text-amber-700">
                {currency} {formatMoney(amount)}
              </span>{" "}
              still owed · {orders} {orders === 1 ? "order" : "orders"}
            </>
          ) : (
            "nothing owed from this month"
          )}
        </p>
      </header>

      {inMonth.length === 0 ? (
        /* No grid for a month with nothing on it. Six blank rows is a lot of
           screen to say "no", and the useful thing to say instead is where the
           debt actually is. */
        <div className="px-5 py-10 text-center">
          <p className="text-[13.5px] text-ink-soft">
            Nothing is owed from {grid.label}.
          </p>
          {nearestOwing ? (
            <Link href={href(nearestOwing)} className="btn btn-ghost mt-4">
              Go to {formatMonth(nearestOwing)}
            </Link>
          ) : null}
        </div>
      ) : (
        /* Seven columns are seven columns — a calendar that reflows is not one.
           Below about a phone's width the grid scrolls sideways instead of
           squeezing, because the one thing a cell must never do is clip the
           figure it exists to show. */
        <div className="overflow-x-auto">
          {/* The hairlines are the grid's own gaps showing the backing colour
              through, so every cell — filled or blank — is boxed identically
              without a border on each one fighting its neighbour's. */}
          <div className="grid min-w-[32rem] grid-cols-7 gap-px bg-ink-line">
            {WEEKDAYS.map((day) => (
              <div key={day.full} className="bg-wash-soft py-2 text-center">
                <abbr className="label no-underline" title={day.full}>
                  {day.short}
                </abbr>
              </div>
            ))}

            {grid.weeks.flat().map((date, i) => (
              <Day
                key={date ?? `blank-${i}`}
                date={date}
                day={date ? owed.get(date) : undefined}
                isToday={date === today}
                currency={currency}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One step, back or forward. A link when there is a month to go to and an inert
 * glyph when there is not, rather than a link that goes nowhere: past the oldest
 * debt and past this month there is nothing to find, and saying so by greying out
 * is how every other calendar says it.
 *
 * The chevrons are drawn here at the same weight as the padlock and the theme
 * marks, for the reason given on those: an icon-font arrow would sit at a
 * different weight beside them.
 */
function Step({
  to,
  label,
  forward,
}: {
  to: string | null;
  label: string;
  forward?: boolean;
}) {
  const chevron = (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={forward ? "M9.5 5.5l7 6.5-7 6.5" : "M14.5 5.5l-7 6.5 7 6.5"} />
    </svg>
  );

  if (!to) {
    return (
      <span aria-hidden className="grid h-9 w-9 place-items-center text-ink-soft/30">
        {chevron}
      </span>
    );
  }

  return (
    <Link
      href={to}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-md text-ink-soft transition-colors hover:bg-wash-strong hover:text-ink"
    >
      {chevron}
    </Link>
  );
}

/**
 * One square. Three states: outside the month, inside and settled, inside and
 * owed — and only the third is a link, to the log filtered to that single day.
 */
function Day({
  date,
  day,
  isToday,
  currency,
}: {
  date: string | null;
  day: PendingDay | undefined;
  isToday: boolean;
  currency: string;
}) {
  // Narrow padding: at the grid's minimum width a cell is about seventy pixels,
  // and every one of them is needed by a five-figure total with paisa on it.
  const box = "flex min-h-[3.5rem] flex-col gap-0.5 px-1 py-1.5 sm:min-h-[4.25rem] sm:px-1.5";

  if (!date) return <div className="bg-card" />;

  // self-start rather than a margin: the pill has to shrink to the digits it
  // holds, and a stretched flex item would draw today's marker as a bar across
  // the whole cell.
  const number = (
    <time
      dateTime={date}
      className={`mono flex h-[1.35rem] min-w-[1.35rem] shrink-0 items-center justify-center self-start rounded-full px-1 text-[11.5px] ${
        isToday
          ? "bg-[var(--accent)] font-semibold text-[var(--accent-text)]"
          : day
            ? "font-semibold text-ink"
            : "text-ink-soft/70"
      }`}
    >
      {Number(date.slice(8))}
    </time>
  );

  if (!day) {
    return (
      <div className={`${box} bg-card`}>
        {number}
      </div>
    );
  }

  return (
    <Link
      href={`/food?view=pending&from=${date}&to=${date}`}
      title={`${currency} ${formatMoney(day.amount)} still owed from ${formatDate(date)} — ${
        day.count
      } ${day.count === 1 ? "order" : "orders"}`}
      className={`${box} bg-amber-50 transition-colors hover:bg-amber-100`}
    >
      {number}
      {/* truncate is a backstop, not a plan: the grid is sized so a realistic
          day total fits whole. An exceptional one clips, and the full figure is
          in the link's title and on the log the link opens. */}
      <span className="mono mt-auto truncate text-[11px] font-semibold leading-tight text-amber-800 sm:text-[12.5px]">
        {formatMoney(day.amount)}
      </span>
      <span className="mono truncate text-[10.5px] leading-tight text-ink-soft">
        {day.count} {day.count === 1 ? "order" : "orders"}
      </span>
    </Link>
  );
}
