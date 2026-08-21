import type { CompanySlug } from "../companies";

/**
 * The asset register: what the company owns, who has it, and who had it before.
 *
 * Two records, not one. An asset is a *thing* — a laptop keeps its number and
 * its identity when it changes hands — and a holding is one period in someone's
 * possession. Putting the employee on the asset itself, as the first cut of this
 * module did, makes "who has it" and "who had it" the same field, so recording a
 * return has to overwrite the only copy of who it was with.
 *
 * Not a document. Nothing here is printed, so there is no typed document, no
 * lifecycle status and no rendered PDF.
 *
 * An asset is returned before it is given to anyone else: there is no direct
 * hand-over from one employee to the next, so at any moment an asset is either
 * with exactly one person or in stock, and its holdings never overlap.
 *
 * An asset may also be logged with nobody holding it. It could not always be:
 * the first version of this module made an allotment part of creating an asset,
 * so a laptop bought last week that nobody has yet could not be recorded at all.
 * The employee register made the fix natural — the holder is chosen from a list
 * that opens on nobody.
 */

/** What state the thing came back in. Recorded per return, and on the asset. */
export type AssetCondition = "good" | "damaged" | "lost";

export const CONDITION_LABELS: Record<AssetCondition, string> = {
  good: "Good",
  damaged: "Damaged",
  lost: "Lost",
};

/** Anything but `good` is worth flagging on the register. */
export const CONDITIONS: AssetCondition[] = ["good", "damaged", "lost"];

export function isCondition(v: unknown): v is AssetCondition {
  return typeof v === "string" && (CONDITIONS as string[]).includes(v);
}

/** The asset itself. What the operator types when it is first bought or logged. */
export interface AssetFields {
  /** What the asset is, e.g. "Dell Latitude 5540 laptop". */
  assetName: string;
}

/**
 * Who is taking it, and from when. One of these opens a holding.
 *
 * Three fields where there used to be two, and the third is the whole of what
 * pass two changed. `employeeId` is the link into the register; the name and
 * number beside it are the snapshot of who that was at the time, which is what
 * keeps a closed holding readable after somebody's name is corrected years
 * later — the same habit the tranche ledger uses for its source documents.
 *
 * The caller resolves the id into the snapshot, not the store: it is the action
 * that knows which company it is acting for, and so the only place that can
 * check the employee belongs to it.
 */
export interface AllotFields {
  /**
   * The register entry taking the asset.
   *
   * Empty in exactly one case: correcting a holding that predates the employee
   * register, where the operator left the dropdown on "keep as typed". The
   * action then carries the existing name and number through unchanged rather
   * than blanking them.
   */
  employeeId: string;
  /** Snapshot of their name when the asset was handed over. */
  employeeName: string;
  /** Snapshot of their employee number. */
  employeeNo: string;
  /** ISO date (yyyy-mm-dd), or "" if not recorded. */
  allottedOn: string;
}

/** What closes a holding. */
export interface ReturnFields {
  /** ISO date (yyyy-mm-dd), or "" if not recorded. */
  returnedOn: string;
  condition: AssetCondition;
  /** Free text — "screen cracked", "handed to Ali in stores". */
  note: string;
}

/**
 * One period in one person's possession.
 *
 * `returnedOn` empty means the holding is open: they still have it. Exactly one
 * holding per asset can be open at a time.
 */
export interface AssetHolding extends AllotFields {
  id: string;
  assetId: string;
  company: CompanySlug;
  /**
   * Null on every holding recorded before the employee register existed. That
   * is not a gap to be repaired — the name and number on the row are what was
   * true at the time, and they still read correctly. It only means the holding
   * does not roll up under anybody's record.
   */
  employeeId: string;
  /** "" while the holding is open. */
  returnedOn: string;
  /** Only meaningful once returned. */
  condition: AssetCondition;
  /** Only meaningful once returned. */
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** True while they still have it. */
export const isOpen = (h: AssetHolding): boolean => !h.returnedOn;

/**
 * A holding with its asset's identity attached, for the company-wide history.
 *
 * The history screen lists holdings, not assets, and every line has to say which
 * thing it is about — so the asset's number and name ride along rather than
 * being looked up per row.
 */
export interface HoldingWithAsset extends AssetHolding {
  assetNo: string;
  assetName: string;
}

export interface Asset extends AssetFields {
  id: string;
  /** `GR-A-001` — permanent once assigned, and what goes on the physical tag. */
  assetNo: string;
  company: CompanySlug;
  /** Running sequence within the company. Never resets. */
  seq: number;
  /**
   * The open holding, copied onto the asset so the register can list and search
   * current holders without a second table.
   *
   * `asset_holdings` is the authority — this is a cache of the row there whose
   * `returnedOn` is empty, rewritten by allotting and by returning. Empty
   * `holderName` means the asset is in stock.
   */
  holderName: string;
  holderNo: string;
  /**
   * The register entry currently holding it, cached alongside the name.
   *
   * "" means one of two ordinary things: the asset is in stock, or it is out
   * with somebody recorded before the register existed. `holderName` is what
   * tells those two apart.
   */
  holderId: string;
  /** ISO date the current holding began. "" when in stock. */
  heldSince: string;
  /**
   * The condition it is currently known to be in, from its last return.
   *
   * Not a cache: this is a fact about the thing rather than about a holding, and
   * it is what makes "which of our returned laptops are broken" answerable from
   * the register alone.
   */
  condition: AssetCondition;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** True when nobody has it. */
export const inStock = (a: Asset): boolean => !a.holderName;

/**
 * One photograph of an asset, dated and described.
 *
 * A log rather than a single picture, because the value is in the sequence: one
 * photo says what a laptop looks like, four say it left in one piece in July and
 * came back with a cracked lid in September — which is the argument that
 * actually has to be had.
 *
 * There is deliberately no "primary photo" flag. The newest by `takenOn` is the
 * thumbnail on the register, so there is no second piece of state to keep
 * correct, and no way for the flag and the dates to disagree.
 */
export interface PhotoFields {
  /**
   * The date the picture shows, which is not when it was uploaded — the log is
   * often caught up on days later. Same reasoning as a food entry's order date.
   */
  takenOn: string;
  /** What the picture is of. The reason a log beats a photo. */
  info: string;
}

export interface AssetPhoto extends PhotoFields {
  id: string;
  assetId: string;
  company: CompanySlug;
  /** Storage key, resolved through /api/file so it stays behind the password. */
  key: string;
  /** The original filename, for the download link. */
  name: string;
  createdAt: string;
}

/** The newest photograph of an asset, for the register's thumbnail. */
export interface AssetThumb {
  assetId: string;
  key: string;
  takenOn: string;
}

/** A blank photo, dated today. */
export function emptyPhoto(today: string): PhotoFields {
  return { takenOn: today, info: "" };
}

export interface AssetQuery {
  company: CompanySlug;
  /** Free text across asset no., asset name and the current holder. */
  q?: string;
  /**
   * "out" is with somebody, "stock" is nobody, "deleted" is the recycle bin.
   * Defaults to every live asset.
   */
  view?: "all" | "out" | "stock" | "deleted";
  limit?: number;
  offset?: number;
}

export interface HoldingQuery {
  company: CompanySlug;
  /**
   * One employee's holdings, for their record. Matches on the link rather than
   * the name, so it returns what was genuinely allotted to that register entry
   * and never somebody else who happens to share a spelling.
   */
  employeeId?: string;
  /** Free text across employee name and number, asset no. and asset name. */
  q?: string;
  /** "open" is still out, "closed" is returned. */
  view?: "all" | "open" | "closed";
  /**
   * ISO dates. Matches any holding that overlaps the window, which is what
   * "who had something in August" means — not only those that began in it.
   */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AssetCounts {
  /** Live assets on the register. */
  total: number;
  /** Out with somebody. */
  out: number;
  /** On the shelf. */
  stock: number;
  /** How many distinct people are holding something. */
  employees: number;
  /** Live assets whose last return recorded damage or a loss. */
  flagged: number;
}

/** A blank asset. */
export function emptyAsset(): AssetFields {
  return { assetName: "" };
}

/** A blank allotment, dated today and belonging to nobody yet. */
export function emptyAllot(today: string): AllotFields {
  return { employeeId: "", employeeName: "", employeeNo: "", allottedOn: today };
}

/** A blank return, dated today. */
export function emptyReturn(today: string): ReturnFields {
  return { returnedOn: today, condition: "good", note: "" };
}
