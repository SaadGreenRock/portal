/**
 * Dates shared by the printed documents and the screens: turning them into words,
 * and the few sums that get asked about them.
 *
 * Wherever something here needs to know what *today* is, it asks `clock.ts` and
 * does not work it out from a `Date`. Read with the ordinary getters, a `Date`
 * answers in the timezone of whichever machine is running — the desk's own here,
 * UTC on a serverless host — and the whole point is that a document is dated the
 * same wherever the portal happens to be deployed. See `clock.ts` for why that
 * matters enough to be centralised.
 *
 * Everything below takes and returns yyyy-mm-dd strings rather than `Date`
 * objects, so a date that has been settled cannot pick a timezone back up on its
 * way through.
 */

import { portalToday, wallClock } from "@/lib/clock";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Day names, indexed the way `Date.getDay()` counts them — 0 Sunday.
 *
 * Here rather than in calendar.ts, beside the months, because they are the same
 * kind of thing: the words this portal uses for dates. The calendar rotates them
 * into whichever day its week starts on.
 */
export const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * "2026-07-31" → "31 July" — the date without its year.
 *
 * For a header narrow enough that something has to go, where the year is the
 * least worth keeping: it is the one part of today's date nobody has to be told.
 */
export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

/** "2026-07-31" → "31 July 2026", matching how the documents are dated by hand. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${formatDayMonth(iso)} ${y}`;
}

/**
 * "2026-08-14" → "Friday". Kept apart from `formatDate` rather than folded into
 * one string, because in a header the weekday is the first thing to give up when
 * the screen gets narrow and the date is not.
 *
 * Built from the date's own numbers at local midnight, the same way `parseIso`
 * below does, so the weekday belongs to the date as written rather than to
 * whichever side of midnight the reader happens to be on.
 */
export function dayName(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

/**
 * "2026-08" → "August 2026" — the title over a calendar page.
 *
 * Takes a full yyyy-mm-dd just as happily, so a caller with a date in hand does
 * not have to slice it first.
 */
export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Today at the desk, as yyyy-mm-dd — what a new document is dated, and what
 * "today" means on every screen that says it.
 *
 * Kept as the name the rest of the portal calls; the zone it answers in is
 * `clock.ts`'s to decide. Pass an instant to ask which date the desk would have
 * called *that* moment.
 */
export function todayIso(at: Date = new Date()): string {
  return portalToday(at);
}

/**
 * "31 July 2026, 3:42 PM" — for the audit trail on a record's own page.
 *
 * Stored timestamps are instants, in UTC. Read back at the desk's wall clock, so
 * a record created at half past three in the afternoon says half past three
 * however far from the desk the server is — and says it the same way the clock in
 * the header does, both being `wallClock`'s to word.
 */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const { date, time } = wallClock(d);
  return `${formatDate(date)}, ${time}`;
}

/**
 * A yyyy-mm-dd date, moved by a number of days. "Today plus a week" is a
 * quotation's reply deadline, and the only way to get one is to count days.
 *
 * Counted in UTC on purpose: this is arithmetic on a date *label*, not on a
 * moment, and doing it in a zone with daylight saving is how "plus seven days"
 * occasionally lands on the same date or skips one.
 */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** "3 days" — how long something has been sitting. */
export function ageInDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/** A yyyy-mm-dd date as local midnight, or null if it isn't one. */
function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

/**
 * How long a period lasted — "12 days", "3 months". Returns "" when either end
 * is missing, since a span with one end is not a span.
 *
 * An empty `to` means the period is still running, so it is measured to today.
 * Months rather than days past a couple of months: "487 days" is a number the
 * reader has to divide, and nobody holding a laptop cares about the remainder.
 */
export function spanInDays(from: string | null | undefined, to: string | null | undefined): string {
  const start = parseIso(from);
  if (start == null) return "";

  // An open span runs to today at the desk, not to today wherever the server is.
  const end = parseIso(to || todayIso());
  if (end == null || end < start) return "";

  const days = Math.round((end - start) / 86_400_000);
  if (days === 0) return "same day";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;

  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

/**
 * How overdue a date is, or how long until it. Returns null for no date.
 * Negative days are in the past, which is what "overdue" means for a delivery.
 */
export function dueIn(iso: string | null | undefined): { days: number; label: string } | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d).getTime();
  // Overdue against the desk's calendar. A server five hours behind would call an
  // order due today "due tomorrow" for the first five hours of every day.
  const today = parseIso(todayIso())!;
  const days = Math.round((target - today) / 86_400_000);

  if (days === 0) return { days, label: "due today" };
  if (days === 1) return { days, label: "due tomorrow" };
  if (days > 1) return { days, label: `due in ${days} days` };
  if (days === -1) return { days, label: "1 day overdue" };
  return { days, label: `${-days} days overdue` };
}
