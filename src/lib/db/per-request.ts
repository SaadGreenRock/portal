import { cache } from "react";
import type { CompanySlug } from "../companies";
import { store } from "./index";

/**
 * The reads a shell and the page inside it both need, resolved once per request.
 *
 * Every section here draws its own chrome from the database: the workspace nav
 * badges the vouchers awaiting a scan, Food badges what is unsettled, Funding
 * badges the work queue. Those live in the section's layout, because the badge
 * has to be on every screen in the section. But the section's *index* is a page
 * that reports the same figures in full — so a layout and the page it wraps ask
 * the database for the same thing, in the same request, and both are served.
 *
 * Nothing about that is visible: the two answers agree, because they are two
 * reads of one database a millisecond apart. It is simply paid for twice.
 *
 * `cache` from React is the fix the framework already provides. It memoises on
 * the arguments for the life of a single server render, so the second caller
 * joins the first one's promise instead of opening its own query. Across a
 * request boundary it holds nothing at all — this is not a data cache and
 * cannot serve a stale figure, which is the whole reason it is safe on a portal
 * where the operator writes a row and expects to see it on the next screen.
 *
 * The bill it settles is not evenly spread. `allocatableItems` is the heaviest
 * read in the portal — six queries, and up to fifty thousand rows across the
 * vouchers, orders, food, direct expenses, allocations and tranche tables —
 * and it was running twice on four of the five Funding screens.
 *
 * Deliberately wrapping the store call and nothing else. `tryTable` stays at
 * the call sites, exactly where it is now: a read that tolerates a missing
 * table and one that must not are a decision belonging to the screen, not to
 * this file. A rejected promise is memoised along with a resolved one, so both
 * callers see the same failure they would have seen separately.
 *
 * If you give a layout a new read, give it an entry here at the same time.
 */

/** Vouchers pending, completed and total. Workspace shell, overview, settings. */
export const voucherCounts = cache(async (company: CompanySlug) =>
  (await store()).counts(company),
);

/** Purchase orders by status. Workspace shell, overview, settings. */
export const poCounts = cache(async (company: CompanySlug) => (await store()).poCounts(company));

/** Requests for quotation by status. Workspace shell, overview, settings. */
export const rfqCounts = cache(async (company: CompanySlug) => (await store()).rfqCounts(company));

/** Food entries by status. Food shell and the log. */
export const foodCounts = cache(async () => (await store()).foodCounts());

/**
 * Everything a tranche could be spent on, with what is already attributed.
 *
 * The expensive one, and the reason this file exists: the Funding shell counts
 * the work queue from it and four of the section's screens read it again.
 */
export const allocatableItems = cache(async () => (await store()).allocatable());

/** Every tranche with its debits. The Funding index, Allocate, and the landing page. */
export const fundingLedger = cache(async () => (await store()).fundingLedger());
