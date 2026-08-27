import type { CompanySlug } from "../companies";
import type { PoStatus } from "../po/types";
import { rangeBounds, type SpendRange } from "./types";

/**
 * What the money was spent *on*.
 *
 * The expenditure page answers how much, and per document type. It could never
 * answer the question anybody actually asks first — how much have we spent on
 * laptops — because that is not a fact about a purchase order. One order buys a
 * laptop, a bag and three cables, and the order's total is the only figure
 * stored against it.
 *
 * So the unit here is the *line item*, not the order: every priced row of every
 * committed purchase order, each one assignable to a tag. Laptop, phone,
 * stationery — a vocabulary the operator adds to, not a fixed list, because
 * nobody can name in advance the categories a company will turn out to buy in.
 *
 * Four decisions worth stating, because each is a figure that could otherwise
 * be read two ways:
 *
 *   One tag per item. Two tags on one row would count the same money twice and
 *   the breakdown would add up to more than was spent, which is the one way this
 *   feature could be worse than not existing.
 *
 *   Issued and closed orders only, which is exactly what the Purchase orders
 *   line on /spend counts. Drafts are promised to nobody and cancelled orders
 *   were never spent, so including either would make the tag breakdown disagree
 *   with the figure printed directly above it.
 *
 *   Every item carries its share of the order's tax, shipping and discount — see
 *   `attributedLines` in po/totals.ts. The tags therefore add up to the Purchase
 *   orders figure to the paisa, rather than to the subtotal with the tax left
 *   homeless.
 *
 *   Untagged is a row, not an omission. It is what makes the breakdown checkable
 *   against the total above it, and it doubles as the list of work left to do.
 *
 * Nothing here touches a purchase order. A tag lives in its own table keyed on
 * the order and the row's own id, so the document, the editor, the printed page
 * and the stored totals are all exactly as they were.
 */

/** A name the operator added. Global, not per company — see `listSpendTags`. */
export interface SpendTag {
  id: string;
  name: string;
  createdAt: string;
}

/** As long a name as a tag needs. Longer ones are a description, not a tag. */
export const TAG_NAME_MAX = 40;

/**
 * A typed tag name, cleaned up.
 *
 * One place, called by the actions and by both backends, so a name cannot be
 * stored in one shape and looked up in another. Inner whitespace is collapsed
 * because "Office  chairs" and "Office chairs" are one category, and telling
 * them apart on the screen is impossible.
 */
export function normaliseTagName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TAG_NAME_MAX);
}

/**
 * One line item of one committed order, with what it is tagged as.
 *
 * Flattened out of the order's stored document rather than being a table of its
 * own. The document is the authority on what was ordered; a second copy of every
 * line would be a second thing to keep in step with an edit, and it would lose
 * the argument the first time somebody corrected a quantity.
 */
export interface TaggedItem {
  poId: string;
  poNo: string;
  company: CompanySlug;
  /** issued or closed. Nothing else reaches this list. */
  status: PoStatus;
  /** The order's own date, else the day it was raised. ISO. */
  date: string;
  vendor: string;
  /** `PoItem.id` — stable across edits, which is what a tag hangs on. */
  itemId: string;
  code: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  currency: string;
  /** qty x unit price, as the order prints it. */
  line: number;
  /** `line` plus this row's share of the order's tax, shipping and discount. */
  amount: number;
  /** null when nobody has tagged it yet. */
  tagId: string | null;
}

export interface TagLine {
  /** null is the untagged remainder. */
  tagId: string | null;
  name: string;
  amount: number;
  items: number;
}

export interface TagCurrency {
  currency: string;
  /** Tags with money against them, largest first. */
  tags: TagLine[];
  /** The remainder. Present even at zero, so the arithmetic is always visible. */
  untagged: TagLine;
  /** tags + untagged. The Purchase orders figure for this currency. */
  total: number;
}

export interface TagSummary {
  /** Largest currency first, so the one that matters leads. */
  byCurrency: TagCurrency[];
  items: number;
  untaggedItems: number;
}

const money = (n: number) => Math.round(n * 100) / 100;

const UNTAGGED = "Untagged";

/**
 * Rolls line items up by tag, per currency, never across.
 *
 * A pure function over rows rather than SQL, the same choice every other total
 * in the portal makes and for the same two reasons: PostgREST cannot aggregate
 * without a stored function — another migration somebody has to remember to run
 * — and both backends hand over the same rows, so this one implementation is
 * what stops the panel on /spend from disagreeing with the list on /spend/tags.
 *
 * `tags` supplies the names, and a tag with nothing against it in the period is
 * left out rather than printed as a zero: an empty category is not a finding.
 */
export function summariseTags(items: TaggedItem[], tags: SpendTag[]): TagSummary {
  const names = new Map(tags.map((t) => [t.id, t.name]));
  const buckets = new Map<string, Map<string | null, TagLine>>();
  let untaggedItems = 0;

  for (const item of items) {
    const currency = item.currency || "PKR";
    let byTag = buckets.get(currency);
    if (!byTag) {
      byTag = new Map();
      buckets.set(currency, byTag);
    }

    // A tag deleted while a page was open leaves an id nothing names. It counts
    // as untagged, which is what it now is, rather than dropping out of the
    // total and making the breakdown stop adding up.
    const tagId = item.tagId && names.has(item.tagId) ? item.tagId : null;
    if (tagId == null) untaggedItems += 1;

    let line = byTag.get(tagId);
    if (!line) {
      line = { tagId, name: tagId == null ? UNTAGGED : names.get(tagId)!, amount: 0, items: 0 };
      byTag.set(tagId, line);
    }
    line.amount += item.amount;
    line.items += 1;
  }

  const byCurrency: TagCurrency[] = [...buckets.entries()]
    .map(([currency, byTag]) => {
      const untagged = byTag.get(null) ?? { tagId: null, name: UNTAGGED, amount: 0, items: 0 };
      const tagged = [...byTag.values()]
        .filter((l) => l.tagId != null)
        .map((l) => ({ ...l, amount: money(l.amount) }))
        .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

      return {
        currency,
        tags: tagged,
        untagged: { ...untagged, amount: money(untagged.amount) },
        total: money(tagged.reduce((sum, l) => sum + l.amount, 0) + untagged.amount),
      };
    })
    .sort((a, b) => b.total - a.total);

  return { byCurrency, items: items.length, untaggedItems };
}

/**
 * One tag's figures across every currency, for the row that manages it.
 *
 * Reads the summary rather than the items again, so the number beside a tag's
 * name is the same number the panel above it printed.
 */
export function tagFigures(
  summary: TagSummary,
  tagId: string | null,
): Array<{ currency: string; amount: number; items: number }> {
  const out: Array<{ currency: string; amount: number; items: number }> = [];
  for (const c of summary.byCurrency) {
    const line = tagId == null ? c.untagged : c.tags.find((t) => t.tagId === tagId);
    if (line && line.items > 0) {
      out.push({ currency: c.currency, amount: line.amount, items: line.items });
    }
  }
  return out;
}

/**
 * The same period rule the expenditure figures use, on the same document date.
 *
 * Taken from `rangeBounds` rather than restated: if the tag panel and the
 * Purchase orders line above it disagreed about which month an order fell in,
 * one of them would be wrong and there would be no way to tell which.
 */
export function itemWithinRange(item: TaggedItem, range: SpendRange, now = new Date()): boolean {
  const { from } = rangeBounds(range, now);
  return !from || item.date >= from;
}
