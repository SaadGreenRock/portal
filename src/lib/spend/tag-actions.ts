"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { store } from "../db";
import { normaliseTagName } from "./tags";

/**
 * Server actions for expenditure tags.
 *
 * Two screens use these and no other module does, which is the point: tagging
 * happens in Expenditure, and a purchase order is read here but never written.
 * There is no action in this file that touches `purchase_orders`.
 *
 * Every one of them returns `{ error }` rather than throwing, except the two
 * posted by an ordinary form. A thrown message is redacted in production — Next
 * replaces it with a digest — so a refusal reaches the operator as the generic
 * error page, which tells them nothing and loses the filters they had set. See
 * the note at the top of `ConfirmDelete`.
 */

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/**
 * Both screens that carry these figures.
 *
 * `/spend` is in the list because the tag panel sits on it. Leaving it out is
 * how a tag assigned this morning goes on being absent from the breakdown until
 * something else happens to revalidate the page.
 */
function revalidateTags() {
  revalidatePath("/spend");
  revalidatePath("/spend/tags");
}

/**
 * Adds a tag, or does nothing when the name is already in the list.
 *
 * Posted by a plain form, so it throws rather than returning — and it has almost
 * nothing to throw about: the store treats an existing name as a no-op rather
 * than a clash, precisely so that typing "Laptops" twice is not an error to
 * read.
 */
export async function addSpendTag(form: FormData): Promise<void> {
  await requireAuth();

  const name = normaliseTagName(form.get("name"));
  if (!name) throw new Error("Give the tag a name.");

  const db = await store();
  await db.createSpendTag(name);
  revalidateTags();
}

/** Corrects a name. Everything tagged with it follows, since nothing copied it. */
export async function renameSpendTag(id: string, name: string): Promise<{ error?: string }> {
  await requireAuth();

  const clean = normaliseTagName(name);
  if (!clean) return { error: "Give the tag a name." };

  const db = await store();
  try {
    await db.renameSpendTag(id, clean);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "That name could not be saved." };
  }

  revalidateTags();
  return {};
}

/**
 * Removes a tag. Everything carrying it becomes untagged.
 *
 * Nothing is lost that cannot be redone in a click, which is why this is a hard
 * delete where the rest of the portal soft-deletes: a tag has no number to keep
 * spent and was never printed on anything. How many items it will untag is
 * stated in the confirmation, because that is the only part that is not obvious.
 */
export async function deleteSpendTag(id: string): Promise<{ error?: string }> {
  await requireAuth();

  const db = await store();
  try {
    await db.deleteSpendTag(id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "That tag could not be removed." };
  }

  revalidateTags();
  return {};
}

/**
 * Tags one line item, or clears it when `tagId` is null.
 *
 * The order is read back and checked rather than trusted, for the same reason
 * the misc actions re-load a payment before changing it: the picker only ever
 * offers real rows, so anything else arriving here is a stale tab or a hand-made
 * post. Three things are checked, and each of them would otherwise write a row
 * the breakdown could never account for —
 *
 *   the order is live and committed, so a draft or a deleted order cannot be
 *   tagged into a total that excludes it by design;
 *
 *   the line still exists in the document, so a row removed by an edit cannot
 *   acquire a tag nothing will ever show; and
 *
 *   the tag exists, so a category deleted in another tab cannot be assigned.
 */
export async function assignItemTag(
  poId: string,
  itemId: string,
  tagId: string | null,
): Promise<{ error?: string }> {
  await requireAuth();

  const db = await store();
  const po = await db.getPo(poId);
  if (!po || po.deletedAt) return { error: "That order is no longer here." };
  if (po.status !== "issued" && po.status !== "closed") {
    return { error: `${po.poNo} is ${po.status} and is not counted, so it cannot be tagged.` };
  }
  if (!po.doc.items.some((i) => i.id === itemId)) {
    return { error: `That line is no longer on ${po.poNo}. Reload the page.` };
  }

  if (tagId) {
    const tags = await db.listSpendTags();
    if (!tags.some((t) => t.id === tagId)) {
      return { error: "That tag has been removed. Reload the page." };
    }
  }

  try {
    await db.setItemTag(poId, itemId, tagId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "That tag could not be saved." };
  }

  revalidateTags();
  return {};
}
