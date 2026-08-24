import type { CompanySlug } from "../companies";

/**
 * Global search: one box over every record in the portal.
 *
 * Two decisions make this worth building rather than the thing people mean when
 * they say site search is bad.
 *
 * **Everything has to match.** A query of two words returns only records
 * carrying both. Search that quietly ORs its terms — matching "ali" here and
 * "parking" there — always returns something, which sounds generous and is
 * exactly what teaches you to stop reading past the first result. Better to
 * return nothing and be believed.
 *
 * **Where a word matched decides the rank, not just that it did.** A vendor
 * called "Kick Start" beats a purchase order that happens to say "kick start the
 * generator" in its notes, because a name is what people search by. Flat
 * substring matching — one point wherever it lands — is the other half of why
 * site search feels random: the ranking carries no information, so the answer
 * you wanted is on page three.
 *
 * The scoring below is deliberately a pure function of a hit and a parsed query,
 * with no database in sight. That is what lets it be read, argued with and
 * changed without touching either backend — and it is where every judgement
 * about "did this find what I meant" actually lives.
 */

export type SearchKind =
  | "voucher"
  | "po"
  | "rfq"
  | "misc"
  | "food"
  | "asset"
  | "employee"
  | "notification"
  | "tranche"
  | "direct"
  | "page";

export const KIND_LABELS: Record<SearchKind, string> = {
  voucher: "Voucher",
  po: "Purchase order",
  rfq: "Quotation",
  misc: "Miscellaneous",
  food: "Food",
  asset: "Asset",
  employee: "Employee",
  notification: "Notification",
  tranche: "Tranche",
  direct: "Direct entry",
  page: "Go to",
};

/** One record, reduced to what a result row shows and what it matches on. */
export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** Document number — `GR-202608-014`. "" for a destination. */
  ref: string;
  /** The line people scan: a payee, a vendor, an employee, a headline. */
  title: string;
  /** The second line: a description, a subject, what was ordered. */
  detail: string;
  company: CompanySlug | null;
  /** The record's own date, ISO. "" where it has none. */
  date: string;
  amount: number | null;
  currency: string;
  /** Short label for the status chip. "" for none. */
  status: string;
  href: string;
  /**
   * Worth matching on, not worth showing: an internal note, a serial number, a
   * phone number, the body of a notification. Kept apart from `detail` so it can
   * be scored lower — a hit buried in a long body is a weaker answer than one on
   * the name, and the ranking should say so.
   */
  extra?: string;
}

export interface Scored extends SearchHit {
  score: number;
}

/* -------------------------------------------------------------------------
 * Parsing
 * ---------------------------------------------------------------------------*/

export interface ParsedQuery {
  raw: string;
  /** Lowercased, punctuation-stripped words. All of them must match. */
  terms: string[];
  /**
   * The whole query with every non-alphanumeric character removed, uppercased.
   *
   * This is what makes document numbers findable the way people actually type
   * them. `GR-202608-014` gets typed as "gr 202608 014", "GR202608014" and
   * plain "014" — all three reduce to something this can compare against the
   * same reduction of the stored number, so none of them has to be the one
   * spelling that works.
   */
  refKey: string;
  /** A figure the query mentions, if any — so "4200" can find an amount. */
  amount: number | null;
}

/** Strips a document number down to letters and digits, uppercased. */
export function refKeyOf(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

const NUMERIC = /^[0-9][0-9,.]*$/;

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  const terms = trimmed
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);

  // Only when the whole query is one figure. "4200" is a search for an amount;
  // the 4200 inside "invoice 4200 rev b" is far more likely part of a reference.
  const amount =
    NUMERIC.test(trimmed) && Number.isFinite(Number(trimmed.replace(/,/g, "")))
      ? Number(trimmed.replace(/,/g, ""))
      : null;

  return { raw: trimmed, terms, refKey: refKeyOf(trimmed), amount };
}

/**
 * The single term worth handing the database as a coarse filter.
 *
 * Each module's own `search` already knows which of its columns are worth
 * matching, so the fan-out reuses that rather than inventing a second opinion —
 * but those take one string, and this query may be several words. The most
 * selective one goes down and the rest are applied here, over what comes back.
 *
 * Non-numeric wins over numeric of any length: "ali 5000" should be filtered on
 * "ali", because no module's search looks inside its amount column and filtering
 * on "5000" would return nothing at all. The figure is matched in `scoreHit`
 * instead, which can see it.
 */
export function probeTerm(q: ParsedQuery): string {
  // A trailing "s" comes off before the term goes down, matching the plural
  // tolerance in `present`. Without this the two halves disagree and the
  // tolerance is dead code: "laptops" would be sent to the database verbatim,
  // "Dell Latitude 5540 laptop" would not come back, and the app-side rule that
  // would have accepted it never sees the row. Widening here and narrowing
  // there is the right way round — the coarse filter should over-fetch.
  const widen = (t: string) => (t.length >= 5 && t.endsWith("s") ? t.slice(0, -1) : t);

  // A query with no spaces goes down whole, so a hyphenated document number is
  // matched against the stored number as typed.
  if (q.raw && !/\s/.test(q.raw)) return widen(q.raw);

  const words = q.terms.filter((t) => !/^[0-9]+$/.test(t));
  const pool = words.length > 0 ? words : q.terms;
  return widen(pool.reduce((best, t) => (t.length > best.length ? t : best), ""));
}

/* -------------------------------------------------------------------------
 * Scoring
 * ---------------------------------------------------------------------------*/

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `term` starts a word in `text`, rather than landing mid-word. */
function startsWord(text: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`\\b${escapeRe(term)}`).test(text);
}

/**
 * Whether a term counts as present in some text at all.
 *
 * **A term has to start a word.** Landing in the middle of one does not count,
 * at any length, and this single rule is most of what separates search that can
 * be trusted from search that cannot. Two real examples from this portal, both
 * found by trying it:
 *
 *   "ali" returned Zainab M**ali**k.
 *   "cement" returned the New notification screen, via "announ**cement**".
 *
 * Neither is a near miss to be tuned away with weights — they are noise, and
 * noise in the first few results is exactly what teaches somebody that the
 * search box does not work. Requiring a word boundary costs almost nothing in
 * return, because the case people imagine needing mid-word matching for —
 * "generator" finding "generators" — is a *prefix* and already matches.
 *
 * The reverse of that pair does need help, so plurals are tolerated one step in
 * the other direction: "laptops" finds "laptop". That is the whole of the
 * stemming here, deliberately — anything cleverer starts guessing.
 */
function present(text: string, term: string): boolean {
  if (startsWord(text, term)) return true;
  if (term.length >= 5 && term.endsWith("s") && startsWord(text, term.slice(0, -1))) return true;
  return false;
}

/**
 * How much a record's own date lifts it, in points.
 *
 * A tiebreaker and nothing more — the largest bonus here is worth less than a
 * single match on a name. Two records that match a query equally well are
 * almost always wanted newest-first, but a September record must never outrank
 * a March one that is a better answer.
 *
 * A record with no date takes the middle of the range rather than nothing. An
 * employee and an asset are not events and have no date to be recent by, and
 * scoring them zero here quietly put every person in the portal below every
 * voucher — so searching somebody's name ranked the payments made to them above
 * the record of the person themselves.
 */
function recencyBonus(date: string, today: string): number {
  if (!date) return 12;
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isFinite(days) || days < 0) return 20;
  if (days <= 30) return 20;
  if (days <= 90) return 14;
  if (days <= 365) return 7;
  return 0;
}

/**
 * What one record scores against one query. Zero means "do not show this".
 *
 * The weights are ordered by how much each kind of match tells you the record is
 * the one meant:
 *
 *   the document number, matched whole            — decisive, nothing outranks it
 *   the document number, partially                — strong
 *   a word at the start of the title              — the common good answer
 *   a word anywhere in the title                  — still a name match
 *   a word in the description                     — about the record, not its name
 *   a word in the searchable-but-unshown extra    — weakest thing worth keeping
 */
export function scoreHit(hit: SearchHit, q: ParsedQuery, today: string): number {
  const title = hit.title.toLowerCase();
  const detail = hit.detail.toLowerCase();
  const extra = (hit.extra ?? "").toLowerCase();
  const ref = hit.ref.toLowerCase();
  const hitRefKey = refKeyOf(hit.ref);
  const hay = `${ref} ${title} ${detail} ${extra}`;

  // A query that is nothing but a figure is a search for an amount, and no
  // module's own `search` looks inside its amount column — so the figure would
  // never appear in the text below and the gate would throw the row away before
  // the bonus further down could ever be reached. `run.ts` fetches without a
  // text filter for exactly this case; this is the other half of that.
  const amountMatches =
    q.amount != null && hit.amount != null && Math.abs(hit.amount - q.amount) < 0.005;

  // Every term, or nothing. See the note at the top of this file.
  for (const term of q.terms) {
    if (present(hay, term)) continue;
    if (hitRefKey.includes(refKeyOf(term))) continue;
    if (amountMatches) continue;
    return 0;
  }
  if (q.terms.length === 0 && !q.refKey) return 0;

  let score = 0;

  // ---- the document number ------------------------------------------------
  // Guarded at three characters: shorter than that and every number in the
  // portal contains it, which would drown the ranking in coincidence.
  if (q.refKey.length >= 3 && hitRefKey) {
    if (hitRefKey === q.refKey) score += 1000;
    else if (hitRefKey.startsWith(q.refKey)) score += 500;
    // The sequence on its own — "014" for GR-202608-014, which is how people
    // read a number aloud and how they half-remember one.
    else if (hitRefKey.endsWith(q.refKey)) score += 420;
    else if (hitRefKey.includes(q.refKey)) score += 260;
  }

  // ---- the words ----------------------------------------------------------
  for (const term of q.terms) {
    if (title === term) score += 200;
    else if (title.startsWith(term)) score += 120;
    else if (startsWord(title, term)) score += 90;
    // Mid-word, and deliberately a long way below starting one. "generators"
    // matching "generator" is worth something; it is not worth what a name is.
    else if (title.includes(term)) score += 25;

    if (startsWord(detail, term)) score += 30;
    else if (detail.includes(term)) score += 10;

    if (extra.includes(term)) score += 6;

    // A longer word is a more deliberate one: matching "generator" says more
    // about intent than matching "the".
    score += Math.min(term.length, 12);
  }

  // ---- the figure ---------------------------------------------------------
  if (amountMatches) score += 300;

  return score + recencyBonus(hit.date, today);
}

/**
 * Ranks and trims. Ties break on date, then on reference, so the order is
 * stable rather than dependent on which query came back first.
 */
export function rank(hits: SearchHit[], q: ParsedQuery, today: string, limit: number): Scored[] {
  return hits
    .map((hit) => ({ ...hit, score: scoreHit(hit, q, today) }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) ||
        a.ref.localeCompare(b.ref),
    )
    .slice(0, limit);
}
