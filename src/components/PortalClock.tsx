"use client";

import { useEffect, useRef, useState } from "react";
import HeaderCalendar from "@/components/HeaderCalendar";
import { wallClock } from "@/lib/clock";
import { dayName, formatDate, formatDayMonth } from "@/lib/format";

/**
 * The time and the date, in the header.
 *
 * In the header rather than on a page, because the header is the one thing on
 * screen that does not scroll away: a clock is only worth having if it is there
 * when you look up, and it is there on every screen in the portal rather than
 * only on the one you arrive at.
 *
 * Not decoration. Every document here is dated, and most of them are dated
 * *today* — a new voucher arrives with today already in the date field, and the
 * number it will be given carries today's month inside it. So the portal says
 * which day it thinks it is, in front of whoever is about to type that date onto
 * a document that can never be renumbered.
 *
 * It reads the same clock the documents are dated by, through the same
 * `wallClock` the server numbers them with — see `clock.ts`. Not the browser's
 * own clock: on a laptop left in the wrong timezone that would be the one figure
 * on screen quietly disagreeing with every date the portal writes. Reading the
 * real one means a deployment whose zone is wrong says so up here, rather than in
 * a number nobody can change afterwards.
 *
 * It ticks all the same: the instant comes from the server and the browser
 * advances it. A clock that stopped the moment the page rendered would be worse
 * than no clock, because it would look live.
 *
 * Pressing it opens the month it is sitting in — see `HeaderCalendar`. The
 * calendar hangs off the clock rather than living anywhere of its own because it
 * is the same question asked one step further: the clock says which day it is,
 * and the grid says where that day falls. Nothing else in the portal is on every
 * screen to hang it from, and a calendar worth having is one you do not have to
 * navigate to.
 */
export default function PortalClock({ iso }: { iso: string }) {
  const serverMs = Date.parse(iso);

  // Seeded from the server's instant, so the first paint is already right and
  // there is nothing for hydration to disagree with.
  const [ms, setMs] = useState(serverMs);
  const [open, setOpen] = useState(false);

  // Wraps the button and the panel both, so a press inside the calendar is not
  // mistaken for a press outside it.
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // How far this browser's clock is from the server's, measured once. Every
    // tick then reads the browser's clock and applies it, rather than counting
    // its own seconds — a tab that sleeps for an hour wakes up with the right
    // time instead of an hour of missed intervals. It also means the clock stays
    // right on a screen whose header was rendered hours ago and has not been
    // re-rendered since, which in a layout is most of them.
    const skew = serverMs - Date.now();
    let timer = 0;

    const tick = () => {
      const next = Date.now() + skew;
      setMs(next);
      // Wake on the next minute rather than every second: nothing on display has
      // seconds on it. Minute boundaries fall on the same instants in every real
      // timezone — offsets are whole minutes, even the half-hour ones — so this
      // needs no knowledge of which zone is being shown.
      timer = window.setTimeout(tick, 60_000 - (next % 60_000) + 50);
    };

    tick();
    return () => window.clearTimeout(timer);
  }, [serverMs]);

  /**
   * The two ways out of an open calendar, bound only while one is open.
   *
   * `pointerdown` rather than `click`, so the panel is gone by the time whatever
   * was pressed underneath it reacts — closing on `click` leaves the calendar
   * standing over a button for the length of the press, which reads as the press
   * having missed.
   *
   * Escape puts focus back on the clock rather than leaving it on a panel that
   * no longer exists, which would otherwise drop the keyboard back to the top of
   * the document.
   */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // How the time is written is `clock.ts`'s to decide, so this reads the same as
  // every "created at" on a record. A portal that says 7:49 PM in one place and
  // 19:49 in another is two portals.
  const { date, time } = wallClock(new Date(ms));

  return (
    // `relative` so the calendar can hang from the clock itself rather than from
    // whichever header it happens to be sitting in — five of them, all shaped
    // differently, none of which should have to know about it.
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The date in full and unabbreviated, whatever the width has forced the
        // visible line down to, and what pressing will do — so the control says
        // the same thing to a screen reader at every size.
        aria-label={`${time}, ${dayName(date)}, ${formatDate(date)}. ${
          open ? "Hide" : "Show"
        } the calendar.`}
        // The whole clock is the target, not the date line alone. That line is
        // 11.5px of grey — a thumb on a phone would be aiming at three
        // millimetres of text — and the time above it is the same fact one unit
        // finer, so splitting the two into a live half and a dead half would be
        // an invitation to press the wrong one.
        //
        // Padded like the theme and lock buttons beside it, which is what makes
        // it read as pressable at all: until now the clock was the one thing in
        // that corner with nothing to press. Two lines at the same sizes the
        // workspace header already sets its company name and subtitle in, so it
        // still reads as part of that furniture rather than as a control parked
        // next to it.
        className="block rounded-lg px-2 py-1 text-right leading-tight transition-colors
                   hover:bg-wash-strong aria-expanded:bg-wash-strong"
      >
        {/* mono for the tabular figures: without them the line shifts sideways
            every time a 1 ticks over to a 2. */}
        <div className="mono text-[14px] font-semibold">{time}</div>
        {/* aria-hidden: the button's own label already reads the date out whole,
            and reading it a second time here would say it twice. */}
        <time dateTime={date} aria-hidden className="block text-[11.5px] text-ink-soft">
          {/* On a phone this row also holds a logo, the company name and two
              buttons, and something has to give. The weekday and the year go:
              the day and month are what a document is dated with, and they stay
              at every width. */}
          <span className="hidden sm:inline">{dayName(date)}, </span>
          {formatDayMonth(date)}
          <span className="hidden sm:inline"> {date.slice(0, 4)}</span>
        </time>
      </button>

      {/* Unmounted rather than hidden, which is what gives the panel its lack of
          memory — see the note on it. */}
      {open ? <HeaderCalendar today={date} /> : null}
    </div>
  );
}
