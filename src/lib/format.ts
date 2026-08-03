/**
 * Date formatting shared by the printed documents and the screens.
 *
 * Everything here works in the server's local time, never UTC. Document numbers
 * take their month from the local date, so a UTC date would show 31 July beside
 * a number reading 202608 for anything created in the evening east of Greenwich.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07-31" → "31 July 2026", matching how the documents are dated by hand. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Today in the server's local timezone, as yyyy-mm-dd. */
export function todayIso(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** "31 July 2026, 15:42" — for the audit trail on a record's own page. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(todayIso(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "3 days" — how long something has been sitting. */
export function ageInDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
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
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((target - today) / 86_400_000);

  if (days === 0) return { days, label: "due today" };
  if (days === 1) return { days, label: "due tomorrow" };
  if (days > 1) return { days, label: `due in ${days} days` };
  if (days === -1) return { days, label: "1 day overdue" };
  return { days, label: `${-days} days overdue` };
}
