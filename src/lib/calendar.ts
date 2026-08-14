/**
 * Month grids, for screens that lay dates out as a calendar rather than a list.
 *
 * Everything here speaks the same yyyy-mm-dd strings the rest of the portal
 * stores dates as, and hands back nothing else. A `Date` crossing a boundary
 * carries a timezone with it, and an order dated the 31st has to stay on the
 * 31st whichever side of midnight UTC the server happens to be on — the same
 * reason `format.ts` works in local time throughout.
 *
 * No food knowledge lives here. It builds the empty page; the caller writes the
 * numbers into it.
 */

import { formatMonth } from "@/lib/format";

/**
 * Which day a week starts on: 0 Sunday … 6 Saturday.
 *
 * Monday, so the grid reads the way the working week is spoken about — and so
 * the two days off land together at the end rather than split across the ends.
 * Change this one number and the headers and every grid follow.
 */
export const WEEK_STARTS_ON = 1;

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** The seven column headers, already rotated into `WEEK_STARTS_ON` order. */
export const WEEKDAYS: Array<{ full: string; short: string }> = Array.from(
  { length: 7 },
  (_, i) => {
    const name = DAY_NAMES[(WEEK_STARTS_ON + i) % 7];
    return { full: name, short: name.slice(0, 3) };
  },
);

export interface CalendarMonth {
  /** yyyy-mm. Sorts chronologically as a plain string, so no comparator is needed. */
  key: string;
  /** "August 2026". */
  label: string;
  /**
   * Rows of seven. Cells before the 1st and after the last day are null rather
   * than the neighbouring month's dates: this grid is read for the figures
   * written into it, and a greyed-out 29 July under an August total is a
   * number begging to be misread.
   */
  weeks: Array<Array<string | null>>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The yyyy-mm a yyyy-mm-dd date falls in. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The calendar page for one yyyy-mm. */
export function monthGrid(ym: string): CalendarMonth {
  const [year, month] = ym.split("-").map(Number);

  // Local midnight both times, so neither call can slip a day.
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  // Day 0 of the next month is the last day of this one.
  const length = new Date(year, month, 0).getDate();

  const blanks = (firstWeekday - WEEK_STARTS_ON + 7) % 7;
  const cells: Array<string | null> = Array(blanks).fill(null);
  for (let d = 1; d <= length; d += 1) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return { key: ym, label: formatMonth(ym), weeks };
}

/**
 * One page per month that any of these dates falls in, oldest first.
 *
 * Months nothing falls in are skipped rather than drawn empty. A run of blank
 * pages between two debts is scrolling, not information — the month title on
 * each page already says where the gap is.
 */
export function monthGridsFor(dates: string[]): CalendarMonth[] {
  return [...new Set(dates.map(monthOf))].sort().map(monthGrid);
}
