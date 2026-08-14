"use client";

import { useEffect, useState } from "react";
import { wallClock } from "@/lib/clock";
import { dayName, formatDayMonth } from "@/lib/format";

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
 */
export default function PortalClock({ iso }: { iso: string }) {
  const serverMs = Date.parse(iso);

  // Seeded from the server's instant, so the first paint is already right and
  // there is nothing for hydration to disagree with.
  const [ms, setMs] = useState(serverMs);

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

  // 24-hour, matching the timestamps in every record's audit trail. A portal that
  // says 16:28 in one place and 4:28 pm in another is two portals.
  const { date, time } = wallClock(new Date(ms));

  return (
    // Two lines at the same sizes the workspace header already sets its company
    // name and subtitle in, so the clock reads as part of that furniture rather
    // than as something parked next to it.
    <div className="shrink-0 text-right leading-tight">
      {/* mono for the tabular figures: without them the line shifts sideways
          every time a 1 ticks over to a 2. */}
      <div className="mono text-[14px] font-semibold">{time}</div>
      <time dateTime={date} className="block text-[11.5px] text-ink-soft">
        {/* On a phone this row also holds a logo, the company name and two
            buttons, and something has to give. The weekday and the year go: the
            day and month are what a document is dated with, and they stay at
            every width. Split rather than written out twice, so a screen reader
            reads one date instead of two — the full one is on `dateTime`
            regardless. */}
        <span className="hidden sm:inline">{dayName(date)}, </span>
        {formatDayMonth(date)}
        <span className="hidden sm:inline"> {date.slice(0, 4)}</span>
      </time>
    </div>
  );
}
