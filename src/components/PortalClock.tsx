"use client";

import { useEffect, useState } from "react";
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
 * Which is also why this is the **server's** clock rather than the browser's.
 * `periodOf()` numbers documents from the server's local time and the voucher
 * form defaults from it, so a clock reading the browser's time would be the one
 * number on this screen that disagreed with the rest of the portal — and it
 * would disagree silently, in the small hours, at exactly the month boundary
 * where the disagreement costs a wrongly-numbered voucher. Showing the clock the
 * documents are actually dated by means that if a deployment's timezone is not
 * what anyone expected, it is visible here on the way in rather than discovered
 * later in the numbering.
 *
 * It ticks in the browser all the same: the instant and the offset come from the
 * server, and the browser only advances them. A clock that stopped the moment
 * the page rendered would be worse than no clock, because it would look live.
 */
export default function PortalClock({
  iso,
  offsetMinutes,
}: {
  /** The server's instant at render. */
  iso: string;
  /**
   * The server's offset from UTC at that instant, as `getTimezoneOffset()`
   * reports it — minutes *behind* UTC, so UTC+5 is -300.
   */
  offsetMinutes: number;
}) {
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
      // Wake on the next minute rather than every second. The display has no
      // seconds on it, so a per-second re-render would be sixty renders an hour
      // of work to change nothing.
      const untilNextMinute = 60_000 - (wallMs(next, offsetMinutes) % 60_000);
      timer = window.setTimeout(tick, untilNextMinute + 50);
    };

    tick();
    return () => window.clearTimeout(timer);
  }, [serverMs, offsetMinutes]);

  const wall = new Date(wallMs(ms, offsetMinutes));
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateIso = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  // 24-hour, matching the timestamps in every record's audit trail. A portal
  // that says 16:28 in one place and 4:28 pm in another is two portals.
  const time = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;

  return (
    // text-right at every width, not just from sm up: the block is pushed to the
    // right of the header on any screen wide enough to hold it beside the title,
    // and left-aligning its two lines there hangs the shorter one out to the left
    // of the longer.
    <div className="shrink-0 text-right">
      {/* mono for the tabular figures: without them the whole line shifts
          sideways each time a 1 ticks over to a 2. */}
      <div className="mono text-[21px] font-semibold leading-none tracking-tight">{time}</div>
      <time dateTime={dateIso} className="mt-1.5 block text-[13px] text-ink-soft">
        {formatDayDate(dateIso)}
      </time>
    </div>
  );
}

/**
 * An instant, moved into the server's wall clock, so the UTC getters read out
 * the server's own numbers. Its offset is taken at render and held: it would go
 * an hour stale on a page left open across a daylight-saving change, which is
 * the cheapest thing on this screen to be briefly wrong about.
 */
function wallMs(ms: number, offsetMinutes: number): number {
  return ms - offsetMinutes * 60_000;
}
