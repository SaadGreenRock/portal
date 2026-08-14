/**
 * The portal's clock.
 *
 * One question is asked all over this codebase — "what day is it?" — and the
 * answer has to be the same everywhere, on every machine. This is the only place
 * that decides it.
 *
 * It matters more than it sounds. A document number carries the month it was
 * created in (`GR-202608-014`) and is never reissued, so "what month is it" is
 * written permanently into the record. Asked with `Date`'s ordinary getters, that
 * question is answered in the timezone of whatever machine happens to be running
 * the code: the desk's own zone in local use, and UTC on a serverless host, which
 * is five hours behind the desk. A voucher created at 2am on the 1st of a month
 * would be handed the *previous* month's number, permanently, and nothing on
 * screen would say so.
 *
 * So the zone is named here rather than inherited from the host. `TZ` in the
 * environment is no longer what any of this depends on — it is worth setting so
 * the host's own logs read in the same zone, and nothing more.
 *
 * Everything below goes through `Intl`, which owns the real rules for a zone,
 * including the daylight-saving ones. Deliberately not arithmetic on a UTC offset
 * held somewhere: an offset is only correct until the day the zone changes it,
 * and being quietly wrong twice a year is the failure this file exists to stop.
 */

/**
 * Where the desk is.
 *
 * A constant rather than an environment variable, because a document number can
 * outlive a deployment and there must be no way for a host to be missing this or
 * to disagree about it. If the desk moves, this line moves with it — one change,
 * reviewed, rather than a variable somebody has to remember to set again.
 */
export const PORTAL_TIMEZONE = "Asia/Karachi";

/**
 * Built once. A DateTimeFormat is expensive to construct and this is on the path
 * of every list row that shows a date.
 *
 * Asked for a 0–23 hour even though the portal displays a 12-hour clock, and the
 * conversion is done by hand below. Letting `Intl` produce the 12-hour form
 * instead would mean taking "am"/"AM" and its spacing from whichever ICU build
 * the host happens to ship, and the portal would write the time differently on
 * two machines. `h23` rather than `hour12: false`, which in some ICU builds
 * prints midnight as 24:00.
 */
const WALL = new Intl.DateTimeFormat("en-GB", {
  timeZone: PORTAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface WallClock {
  /** yyyy-mm-dd, the same shape every date in this portal is stored as. */
  date: string;
  /** "7:49 PM" — the one way this portal writes a time. */
  time: string;
}

/**
 * An instant, read off the portal's wall clock.
 *
 * The one primitive here: hand it a moment and it says which date and time the
 * desk would call it. Safe on the server and in the browser — it is `Intl` and
 * nothing else — which is how the clock in the header and the timestamps on a
 * record are guaranteed to agree.
 *
 * A 12-hour clock with AM or PM after it, because that is how the desk reads a
 * time. Written here rather than at each of the places that shows one: the header
 * clock and every "created at" on a record come through this function, so there
 * is no way for the portal to say 7:49 PM on one screen and 19:49 on the next.
 */
export function wallClock(at: Date = new Date()): WallClock {
  const parts: Record<string, string> = {};
  for (const part of WALL.formatToParts(at)) parts[part.type] = part.value;

  // Midnight is 12 AM and noon is 12 PM; the hour is otherwise its remainder.
  const hour24 = Number(parts.hour);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const meridiem = hour24 < 12 ? "AM" : "PM";

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour12}:${parts.minute} ${meridiem}`,
  };
}

/** Today at the desk, as yyyy-mm-dd. */
export function portalToday(at: Date = new Date()): string {
  return wallClock(at).date;
}

/**
 * `202608` — the year and month a document created now belongs to.
 *
 * The figure that ends up inside every document number, which is why it is taken
 * from the desk's calendar and not the host's.
 */
export function portalPeriod(at: Date = new Date()): string {
  const date = portalToday(at);
  return `${date.slice(0, 4)}${date.slice(5, 7)}`;
}
