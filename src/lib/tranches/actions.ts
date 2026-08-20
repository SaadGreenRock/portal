"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { store } from "../db";
import { CURRENCIES } from "../money";
import { text } from "../po/parse";
import {
  isSourceKind,
  paisa,
  planSplit,
  stand,
  unallocated,
  type AllocatableItem,
  type DirectFields,
  type NewAllocation,
  type SourceKind,
  type TrancheFields,
} from "./types";

/**
 * Server actions for the funding section.
 *
 * Plain FormData throughout, like the food log and the asset register: every
 * form here is flat named fields, so nothing depends on JavaScript to submit —
 * including the picker, whose checkboxes come back through `getAll`. The picker
 * is a client component only so the running total can be seen before the post,
 * not so the post can happen at all.
 *
 * Nothing in this file writes to a voucher, an order or a food entry. The
 * dependency runs one way, and this is where it would be easiest to break.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/**
 * Every path a tranche figure appears on.
 *
 * `/` is in the list because the landing card carries the money still
 * unallocated across open buckets. Leaving it out is how a bucket that was
 * emptied this morning goes on advertising itself as available on the front
 * page.
 */
function revalidateFunding(id?: string) {
  revalidatePath("/");
  revalidatePath("/funding");
  revalidatePath("/funding/allocate");
  revalidatePath("/funding/expenses");
  if (id) revalidatePath(`/funding/${id}`);
}

/** yyyy-mm-dd, or "" — anything else is not a date a date column can hold. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/**
 * A positive money figure.
 *
 * Clamped rather than refused, the same as the food log's: a nonsense number
 * pasted into a box is a hostile payload rather than lost work. Zero is rejected
 * by the callers, where the message can say what the zero was supposed to be.
 */
function amountOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100) / 100, 1e12);
}

/** A rate needs more precision than money: 279.4567 rupees to the dollar. */
function rateOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 1e6) / 1e6, 1e9);
}

const currencyOf = (v: unknown): string => {
  const code = String(v ?? "").trim().toUpperCase();
  return CURRENCIES[code] ? code : "PKR";
};

/* -------------------------------------------------------------------------
 * The bucket
 * ---------------------------------------------------------------------------*/

function readTranche(form: FormData): TrancheFields {
  const recvDate = isoDate(form.get("recvDate"));
  if (!recvDate) throw new Error("Enter the date the money landed in the account.");

  const sentAmount = amountOf(form.get("sentAmount"));
  if (sentAmount <= 0) throw new Error("Enter how much was sent.");

  const recvAmount = amountOf(form.get("recvAmount"));
  if (recvAmount <= 0) throw new Error("Enter how much was received.");

  return {
    label: text(form.get("label"), 160, "Label"),
    funder: text(form.get("funder"), 160, "Sent by"),
    sentAmount,
    sentCurrency: currencyOf(form.get("sentCurrency")),
    // Optional, unlike the received date: the tranche is often logged the day it
    // lands, before anyone has looked up when it was actually wired.
    sentDate: isoDate(form.get("sentDate")),
    recvAmount,
    recvCurrency: currencyOf(form.get("recvCurrency")),
    recvDate,
    account: text(form.get("account"), 200, "Account") || null,
    reference: text(form.get("reference"), 200, "Reference") || null,
    notes: text(form.get("notes"), 2000, "Notes") || null,
  };
}

export async function createTranche(form: FormData): Promise<void> {
  await requireAuth();
  const db = await store();
  const tranche = await db.createTranche(readTranche(form));
  revalidateFunding(tranche.id);
  redirect(`/funding/${tranche.id}`);
}

export async function updateTranche(id: string, form: FormData): Promise<void> {
  await requireAuth();
  const db = await store();
  const fields = readTranche(form);

  // Refused rather than allowed-with-a-warning. Correcting the received figure
  // downwards past what has already been drawn would put the bucket into the
  // overdrawn state by an edit, and a bucket that shows red because of a typo
  // teaches you to stop reading the colour.
  const current = await db.getTranche(id);
  if (!current) throw new Error("That tranche no longer exists.");
  const allocations = await db.listAllocations(id);
  const drawn = allocations.reduce((sum, a) => sum + paisa(a.amount), 0);
  if (paisa(fields.recvAmount) < drawn) {
    throw new Error(
      `${current.trancheNo} already has ${current.recvCurrency} ${(drawn / 100).toLocaleString()} ` +
        `allocated out of it, so the received figure cannot be lowered below that. ` +
        `Remove some allocations first.`,
    );
  }

  await db.updateTranche(id, fields);
  revalidateFunding(id);
  redirect(`/funding/${id}`);
}

/**
 * Closes a bucket with money still in it.
 *
 * The remainder is stated on the card and still counts in total received. It is
 * never moved into another bucket, because it never moved in the bank.
 *
 * Reversible, and that matters: the remainder you decided was too small to spend
 * in August is exactly the remainder something turns out to fit in November.
 */
export async function closeTranche(id: string): Promise<void> {
  await requireAuth();
  const db = await store();
  await db.setTrancheClosed(id, true);
  revalidateFunding(id);
  redirect(`/funding/${id}`);
}

export async function reopenTranche(id: string): Promise<void> {
  await requireAuth();
  const db = await store();
  await db.setTrancheClosed(id, false);
  revalidateFunding(id);
  redirect(`/funding/${id}`);
}

/**
 * Bins a tranche, allocations and all.
 *
 * This used to refuse while the bucket still held allocations, on the theory
 * that deleting it would leave its debits pointing at nothing. That was wrong
 * twice over. It was wrong about the data: a deleted tranche is already absent
 * from `fundingLedger`, and its debits are already absent from `allocatable`,
 * so its expenses go straight back into the work queue and no balance anywhere
 * is affected. And it was wrong about the operator: a bucket you had allocated
 * anything to could never be deleted, and the reason never reached the screen —
 * server action messages are redacted in production, so the refusal arrived as
 * "Could not delete. Try again." with nothing to act on.
 *
 * The allocations are deliberately kept rather than released. Because the row is
 * only soft-deleted, keeping them is what makes Restore put the bucket back
 * exactly as it was, down to the last debit.
 */
export async function deleteTranche(id: string): Promise<{ error: string } | void> {
  await requireAuth();
  const db = await store();

  const tranche = await db.getTranche(id);
  if (!tranche) return { error: "That tranche no longer exists." };

  await db.softDeleteTranche(id);
  revalidateFunding(id);
  redirect("/funding");
}

export async function restoreTranche(id: string): Promise<void> {
  await requireAuth();
  const db = await store();
  await db.restoreTranche(id);
  revalidateFunding(id);
  redirect(`/funding/${id}`);
}

/* -------------------------------------------------------------------------
 * Allocating
 * ---------------------------------------------------------------------------*/

/** `voucher:9f1e…` — how the picker names a row in a checkbox. */
function parsePick(value: string): { kind: SourceKind; id: string } | null {
  const at = value.indexOf(":");
  if (at < 1) return null;
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!isSourceKind(kind) || !id) return null;
  return { kind, id };
}

/**
 * Puts the picked expenses into the chosen bucket, splitting when it overflows.
 *
 * This is the case the module had to be designed around, so it is worth stating
 * how it resolves. Everything picked is walked in date order — oldest first,
 * because that is the order the money went out — and each expense fills the
 * chosen bucket until the bucket is empty. When an expense does not fit:
 *
 *   with `split` off, the whole post is refused and the shortfall is named, so
 *   nothing is written on a half-understanding; and
 *
 *   with `split` on, the bucket is filled to exactly zero and the remainder
 *   spills into the next open buckets, oldest received first. One expense
 *   straddling two tranches becomes two rows against one document, which is
 *   what a split *is*.
 *
 * If the spill runs out of buckets, what could be placed is placed and the rest
 * is left unallocated. That is a real state — the next tranche may still be in
 * the air — and an expense is allowed to sit half attributed rather than being
 * forced into a bucket that cannot hold it.
 */
export async function allocate(form: FormData): Promise<void> {
  await requireAuth();

  const trancheId = String(form.get("tranche") ?? "");
  if (!trancheId) throw new Error("Choose which tranche to allocate to.");

  const picks = form
    .getAll("pick")
    .map((v) => parsePick(String(v)))
    .filter((p): p is { kind: SourceKind; id: string } => p !== null);
  if (picks.length === 0) throw new Error("Pick at least one expense to allocate.");

  const allowSplit = form.get("split") === "1";

  const db = await store();
  const ledger = await db.fundingLedger();
  const chosen = ledger.find((l) => l.tranche.id === trancheId);
  if (!chosen) throw new Error("That tranche no longer exists.");

  const pool = chosen.tranche.recvCurrency;

  // The chosen bucket first, then every other open bucket in the same currency,
  // oldest received first. Same currency only: a bucket that received dollars
  // cannot absorb the spill from one that received rupees at a rate nobody
  // stated.
  const buckets = [
    stand(chosen.tranche, chosen.debits),
    ...ledger
      .filter((l) => l.tranche.id !== trancheId && l.tranche.recvCurrency === pool)
      .map((l) => stand(l.tranche, l.debits))
      .filter((s) => s.open)
      .sort((a, b) => (a.tranche.recvDate < b.tranche.recvDate ? -1 : 1)),
  ];

  const items = await db.allocatable();
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));

  // Oldest first: the order the money actually went out, and the order a backlog
  // should be cleared in.
  const chosenItems = picks
    .map((p) => byKey.get(`${p.kind}:${p.id}`))
    .filter((i): i is AllocatableItem => i !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (chosenItems.length === 0) throw new Error("None of those expenses still exist.");

  const rows: NewAllocation[] = [];
  // Tracked locally as rows are planned, because several expenses in one post
  // draw on the same bucket and each has to see what the ones before it took.
  const room = new Map(buckets.map((b) => [b.tranche.id, paisa(b.remaining)]));
  let leftUnplaced = 0;

  for (const item of chosenItems) {
    const key = `${item.kind}:${item.id}`;

    // How much of this expense to attribute. Defaults to everything still
    // unattributed, which is what the picker shows; an override lets a part of
    // one expense be put in deliberately.
    const override = amountOf(form.get(`amount:${key}`));
    const remainder = unallocated(item);

    let sourcePortion: number;
    if (item.amount == null) {
      // A voucher with the amount left blank to be written in at signing. There
      // is no remainder to compute, so the figure has to be typed — and the
      // ledger records that it was taken on the operator's word.
      if (override <= 0) {
        throw new Error(
          `${item.ref} has no amount recorded, so type what was actually paid before allocating it.`,
        );
      }
      sourcePortion = override;
    } else {
      if (remainder == null || remainder <= 0) continue; // already fully attributed
      sourcePortion = override > 0 ? Math.min(override, remainder) : remainder;
    }

    // The rate converting this document's currency into the pool's. Exactly 1
    // when they match, which is every voucher and every food entry.
    let rate = 1;
    if (item.currency !== pool) {
      rate = rateOf(form.get(`rate:${key}`));
      if (rate <= 0) {
        throw new Error(
          `${item.ref} is in ${item.currency} and ${chosen.tranche.trancheNo} received ${pool}. ` +
            `Enter the rate that was used, so the ledger records what it actually cost.`,
        );
      }
    }

    const needFromPool = Math.round(sourcePortion * rate * 100) / 100;

    const plan = planSplit(
      needFromPool,
      (allowSplit ? buckets : buckets.slice(0, 1)).map((b) => ({
        trancheId: b.tranche.id,
        trancheNo: b.tranche.trancheNo,
        remaining: (room.get(b.tranche.id) ?? 0) / 100,
      })),
    );

    if (plan.shortfall > 0 && !allowSplit) {
      const only = buckets[0];
      throw new Error(
        `${item.ref} needs ${pool} ${(needFromPool).toLocaleString()} and ` +
          `${only.tranche.trancheNo} has ${pool} ${((room.get(only.tranche.id) ?? 0) / 100).toLocaleString()} left. ` +
          `Tick "split across tranches" to fill this one and put the rest in the next.`,
      );
    }

    for (const part of plan.rows) {
      room.set(part.trancheId, (room.get(part.trancheId) ?? 0) - paisa(part.amount));
      rows.push({
        trancheId: part.trancheId,
        sourceKind: item.kind,
        sourceId: item.id,
        amount: part.amount,
        // Back through the rate, so the portions of the document add up to the
        // document rather than to the rupees it happened to cost.
        sourceAmount: Math.round((part.amount / rate) * 100) / 100,
        sourceTotal: item.amount,
        sourceCurrency: item.currency,
        rate,
        sourceRef: item.ref,
        sourceLabel: item.description || item.party,
        sourceCompany: item.company,
        sourceDate: item.date,
        note: null,
      });
    }

    leftUnplaced += paisa(plan.shortfall);
  }

  if (rows.length === 0) {
    throw new Error(
      leftUnplaced > 0
        ? "There is no room left in any open tranche for these."
        : "Everything picked is already fully allocated.",
    );
  }

  await db.allocate(rows);
  revalidateFunding(trancheId);
  for (const id of new Set(rows.map((r) => r.trancheId))) revalidatePath(`/funding/${id}`);
  redirect(`/funding/${trancheId}`);
}

export async function updateAllocation(id: string, form: FormData): Promise<void> {
  await requireAuth();
  const trancheId = String(form.get("tranche") ?? "");

  const amount = amountOf(form.get("amount"));
  if (amount <= 0) throw new Error("Enter what this drew from the tranche.");

  // Defaults to the same figure, which is right for every same-currency row —
  // the overwhelming majority — and is overridden only where the document is in
  // another currency.
  const sourceAmount = amountOf(form.get("sourceAmount")) || amount;

  const db = await store();
  await db.updateAllocation(id, amount, sourceAmount, text(form.get("note"), 500, "Note") || null);
  revalidateFunding(trancheId);
  redirect(`/funding/${trancheId}`);
}

export async function removeAllocation(id: string, trancheId: string): Promise<void> {
  await requireAuth();
  const db = await store();
  await db.removeAllocation(id);
  revalidateFunding(trancheId);
  redirect(`/funding/${trancheId}`);
}

/* -------------------------------------------------------------------------
 * Direct entries
 * ---------------------------------------------------------------------------*/

function readDirect(form: FormData): DirectFields {
  const date = isoDate(form.get("date"));
  if (!date) throw new Error("Enter the date the money went out.");

  const payee = text(form.get("payee"), 200, "Paid to");
  if (!payee) throw new Error("Enter who was paid.");

  const details = text(form.get("details"), 500, "Details");
  if (!details) throw new Error("Enter what it was for.");

  const amount = amountOf(form.get("amount"));
  if (amount <= 0) throw new Error("Enter how much it was.");

  const companyRaw = String(form.get("company") ?? "").trim();
  const company =
    companyRaw === "green-rock" || companyRaw === "sportech" ? companyRaw : null;

  return {
    date,
    payee,
    details,
    amount,
    currency: currencyOf(form.get("currency")),
    company,
    notes: text(form.get("notes"), 2000, "Notes") || null,
  };
}

export async function createDirect(form: FormData): Promise<void> {
  await requireAuth();
  const allocateTo = String(form.get("tranche") ?? "") || null;
  const db = await store();
  const entry = await db.createDirect(readDirect(form), allocateTo);
  revalidateFunding(allocateTo ?? undefined);
  redirect(allocateTo ? `/funding/${allocateTo}` : `/funding/expenses/${entry.id}`);
}

export async function updateDirect(id: string, form: FormData): Promise<void> {
  await requireAuth();
  const db = await store();
  await db.updateDirect(id, readDirect(form));
  revalidateFunding();
  revalidatePath(`/funding/expenses/${id}`);
  redirect(`/funding/expenses/${id}`);
}

/**
 * Bins a direct entry, releasing whatever it had drawn from its tranches.
 *
 * The opposite of a tranche's delete, and for a reason worth stating. There, the
 * bucket is what goes away and its debits are kept so Restore can put it back
 * intact. Here the *expense* is what goes away, and a debit is a statement about
 * where an expense's money came from — with the expense gone the statement has
 * nothing left to be about, and leaving it would draw a bucket down for
 * something that appears nowhere.
 *
 * So the money goes back to the tranche, and restoring the entry brings it back
 * unallocated, into the work queue, to be attributed again.
 *
 * This used to refuse outright while the entry was allocated, which made an
 * entry logged from inside a tranche impossible to delete at all — it is
 * allocated by the act of creating it there. The refusal was also invisible, for
 * the reason `deleteTranche` above sets out.
 */
export async function deleteDirect(id: string): Promise<{ error: string } | void> {
  await requireAuth();
  const db = await store();

  const entry = await db.getDirect(id);
  if (!entry) return { error: "That entry no longer exists." };

  const freed = await db.releaseSource("direct", id);
  await db.softDeleteDirect(id);

  revalidateFunding();
  revalidatePath(`/funding/expenses/${id}`);
  // The buckets that just got their money back.
  for (const trancheId of freed) revalidatePath(`/funding/${trancheId}`);
  redirect("/funding/expenses");
}

export async function restoreDirect(id: string): Promise<void> {
  await requireAuth();
  const db = await store();
  await db.restoreDirect(id);
  revalidateFunding();
  revalidatePath(`/funding/expenses/${id}`);
  redirect(`/funding/expenses/${id}`);
}
