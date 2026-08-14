"use client";

import { useEffect, useState } from "react";
import { wallClock } from "@/lib/clock";
import { formatDayDate } from "@/lib/format";

/**
 * The date, the day and the time, on the screen the portal opens on.
 *
 * Not decoration. Every document here is dated, and most of them are dated
 * *today* — the voucher form arrives with today already in the date field, and
 * the number it will be given carries today's month inside it. So the one thing
 * worth saying on the way in is which day the portal thinks it is, before
 * somebody types it onto a document that can never be renumbered.
 *
 * It reads the same clock the documents are dated by, through the same
 * `wallClock` the server numbers them with — see `clock.ts`. Not the browser's
 * own clock: on a laptop left in the wrong timezone that would be the one figure
 * on this screen quietly disagreeing with every date the portal writes. Reading
 * the real one means a deployment whose zone is wrong says so here, on the way
 * in, rather than in a number nobody can change afterwards.
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
    // time instead of an hour of missed intervals.
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
    // text-right at every width, not just from sm up: the block is pushed to the
    // right of the header on any screen wide enough to hold it beside the title,
    // and left-aligning its two lines there hangs the shorter one out to the left
    // of the longer.
    <div className="shrink-0 text-right">
      {/* mono for the tabular figures: without them the whole line shifts
          sideways each time a 1 ticks over to a 2. */}
      <div className="mono text-[21px] font-semibold leading-none tracking-tight">{time}</div>
      <time dateTime={date} className="mt-1.5 block text-[13px] text-ink-soft">
        {formatDayDate(date)}
      </time>
    </div>
  );
}
