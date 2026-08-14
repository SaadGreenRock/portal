import Link from "next/link";
import { monthGridsFor, WEEKDAYS, type CalendarMonth } from "@/lib/calendar";
import type { PendingDay } from "@/lib/food/types";
import { formatDate } from "@/lib/format";
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
 * One page per month with something owed in it, oldest first. Days with nothing
 * outstanding are left blank on purpose: a figure in every cell is a wall of
 * numbers, and blank is unambiguous — nothing is owed from that day.
 *
 * The currency sits in each month's header rather than in thirty-one cells. A
 * cell is narrow enough that a repeated "₨ " would be the first thing to push
 * the figure it prefixes out of view.
 */
export default function PendingCalendar({
  days,
  today,
  currency,
}: {
  days: PendingDay[];
  /** Passed in so the server decides which cell is today, not the browser. */
  today: string;
  currency: string;
}) {
  const months = monthGridsFor(days.map((day) => day.date));

  return (
    <div className="space-y-4">
      {months.map((month) => {
        const inMonth = days.filter((day) => day.date.startsWith(month.key));
        return (
          <Month
            key={month.key}
            month={month}
            owed={new Map(inMonth.map((day) => [day.date, day]))}
            amount={Math.round(inMonth.reduce((sum, day) => sum + day.amount, 0) * 100) / 100}
            orders={inMonth.reduce((sum, day) => sum + day.count, 0)}
            today={today}
            currency={currency}
          />
        );
      })}
    </div>
  );
}

function Month({
  month,
  owed,
  amount,
  orders,
  today,
  currency,
}: {
  month: CalendarMonth;
  owed: Map<string, PendingDay>;
  amount: number;
  orders: number;
  today: string;
  currency: string;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink-line px-5 py-3.5">
        <h4 className="text-[15px] font-semibold">{month.label}</h4>
        <p className="shrink-0 text-[12.5px] text-ink-soft">
          <span className="mono text-[15px] font-bold text-amber-700">
            {currency} {formatMoney(amount)}
          </span>{" "}
          still owed · {orders} {orders === 1 ? "order" : "orders"}
        </p>
      </header>

      {/* Seven columns are seven columns — a calendar that reflows is not one.
          Below about a phone's width the grid scrolls sideways instead of
          squeezing, because the one thing a cell must never do is clip the
          figure it exists to show. */}
      <div className="overflow-x-auto">
        {/* The hairlines are the grid's own gaps showing the backing colour
            through, so every cell — filled or blank — is boxed identically
            without a border on each one fighting its neighbour's. */}
        <div className="grid min-w-[32rem] grid-cols-7 gap-px bg-ink-line">
          {WEEKDAYS.map((day) => (
            <div key={day.full} className="bg-[#fafaf8] py-2 text-center">
              <abbr className="label no-underline" title={day.full}>
                {day.short}
              </abbr>
            </div>
          ))}

          {month.weeks.flat().map((date, i) => (
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
    </section>
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

  if (!date) return <div className="bg-white" />;

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
      <div className={`${box} bg-white`}>
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
