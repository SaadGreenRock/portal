"use client";

import { useState } from "react";
import { addMonths, monthGrid, monthOf, WEEKDAYS } from "@/lib/calendar";
import { dayName, formatDate, formatMonth } from "@/lib/format";

/**
 * The month that drops out of the header clock.
 *
 * The clock above it already says which day the portal thinks it is, which is
 * the question that matters when a date is about to be typed onto a document
 * that can never be renumbered. This answers the one that follows it: *where in
 * the month* that day sits. "Dated the 24th" and "due end of next week" are the
 * same sentence at the desk and different cells on a grid, and working out which
 * Tuesday the 24th is by counting on your fingers is exactly the sort of thing
 * that puts the wrong date in a date field.
 *
 * Deliberately empty of figures, which is what separates it from
 * `PendingCalendar`. That one is a record — every cell it fills is money
 * somebody still owes, and it is read to be trusted. This is a wall calendar:
 * it knows nothing about what is in the database and shows nothing about it,
 * because a second grid with *some* of the numbers on it would quietly invite
 * the reader to treat it as the record and be wrong about what it left out.
 *
 * It steps as far in either direction as anyone cares to press, unlike the
 * calendar on the food log, which is clamped to the months that actually have
 * debts in them. Nothing bounds a calendar — next March is a real month whether
 * or not this portal holds anything from it, and a greyed-out arrow would be
 * claiming otherwise.
 *
 * It has no memory. The panel is unmounted when it closes, so wherever you
 * wandered off to, it opens on this month again — the header clock is glanced
 * at, not navigated, and coming back to find it parked in November because that
 * is where you left it three days ago is a small betrayal of a thing whose whole
 * job is saying what day it is now.
 */
export default function HeaderCalendar({ today }: { today: string }) {
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);

  const grid = monthGrid(month);
  const back = addMonths(month, -1);
  const forward = addMonths(month, 1);

  /**
   * Centred under the clock on a phone, right-aligned to it from `sm` up.
   *
   * Not a flourish — it is the only pair of placements that fits at both ends
   * without measuring anything. Right-aligned, the panel hangs off the left edge
   * of a narrow screen: on a phone the clock is already most of the way over and
   * there is not 17rem of room to its left. Centred on a wide screen it runs off
   * the right instead, the clock sitting only about 140px from the edge with the
   * theme and lock controls beyond it. Each placement is wrong exactly where the
   * other is right, so the breakpoint picks between them.
   */
  const placement =
    "absolute left-1/2 top-full z-20 mt-2 w-[17rem] -translate-x-1/2 " +
    "sm:left-auto sm:right-0 sm:translate-x-0";

  return (
    <div
      role="dialog"
      aria-label={`Calendar, showing ${grid.label}`}
      className={`pop-in card p-2.5 ${placement}`}
      style={{ boxShadow: "var(--lift)" }}
    >
      <div className="flex items-center gap-1">
        <Step
          label={`Go to ${formatMonth(back)}`}
          onClick={() => setMonth(back)}
        />
        {/* flex-1 between two fixed squares, so the name is centred in whatever
            is left and the arrows sit at the same two places all year. A title
            that sized itself to "May 2026" and then to "September 2026" would
            move the buttons under the cursor between one press and the next. */}
        <h2 className="flex-1 text-center text-[13.5px] font-semibold">{grid.label}</h2>
        <Step
          forward
          label={`Go to ${formatMonth(forward)}`}
          onClick={() => setMonth(forward)}
        />
      </div>

      {/* Headers and days in one grid rather than two stacked ones, so a column
          cannot drift out of line with its own heading. */}
      <div className="mt-1.5 grid grid-cols-7">
        {WEEKDAYS.map((day) => (
          <abbr
            key={day.full}
            title={day.full}
            className="label pb-1 text-center text-[10px] no-underline"
          >
            {day.short}
          </abbr>
        ))}

        {grid.weeks.flat().map((date, i) => (
          <Day key={date ?? `blank-${i}`} date={date} isToday={date === today} />
        ))}
      </div>

      {/* One line doing two jobs, because it is the same fact either way: while
          you are on this month it names today, and once you have stepped away it
          becomes the way back to it. A permanent "Today" button sitting inert
          beside the month it is already showing would be furniture. */}
      <footer className="mt-2 border-t border-ink-line pt-2 text-center">
        {month === thisMonth ? (
          <p className="text-[11.5px] text-ink-soft">
            Today is {dayName(today)}, {formatDate(today)}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setMonth(thisMonth)}
            className="rounded-md px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft
                       transition-colors hover:bg-wash-strong hover:text-ink"
          >
            Back to {formatMonth(thisMonth)}
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * One step, back or forward.
 *
 * The chevron is drawn here rather than shared with the one on `PendingCalendar`
 * for the reason the marks elsewhere in the portal are drawn where they are
 * used: that one is a `Link` — the month it shows is in the URL and belongs in
 * the history — and this one only moves a piece of state that nobody should be
 * able to navigate back through. Same shape, different control; a shared
 * component would have to be told which, which is more than the eight lines of
 * path it would be saving.
 */
function Step({
  label,
  onClick,
  forward,
}: {
  label: string;
  onClick: () => void;
  forward?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-soft
                 transition-colors hover:bg-wash-strong hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={forward ? "M9.5 5.5l7 6.5-7 6.5" : "M14.5 5.5l-7 6.5 7 6.5"} />
      </svg>
    </button>
  );
}

/**
 * One square. Nothing to click: every date here is a date and none of them is a
 * destination, so a hover state would be promising something that does not
 * happen.
 *
 * Cells outside the month are left empty rather than filled with the
 * neighbouring month's numbers, the same choice `calendar.ts` bakes into the
 * grid — a faint 31 sitting above the 1st is a date the eye reads and the
 * calendar did not mean.
 */
function Day({ date, isToday }: { date: string | null; isToday: boolean }) {
  if (!date) return <div />;

  return (
    <div className="flex justify-center py-[1px]">
      <time
        dateTime={date}
        // Today marked the same way it is marked on the food calendar — the
        // accent pill — so the portal has one way of saying "here".
        aria-current={isToday ? "date" : undefined}
        className={`mono grid h-7 w-7 place-items-center rounded-full text-[12.5px] ${
          isToday
            ? "bg-[var(--accent)] font-semibold text-[var(--accent-text)]"
            : "text-ink"
        }`}
      >
        {Number(date.slice(8))}
      </time>
    </div>
  );
}
