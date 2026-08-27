"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { assignItemTag } from "@/lib/spend/tag-actions";
import type { SpendTag } from "@/lib/spend/tags";

/**
 * The tag on one purchase-order line, changed in place.
 *
 * A select rather than a form with a Save button beside it, and it submits on
 * change. This screen exists to be worked *down* — a few hundred lines, most of
 * them wanting a tag — and a second click per row to confirm the first one is a
 * few hundred clicks that say nothing. There is nothing to lose by being wrong
 * either: the fix is picking again.
 *
 * It calls the action directly instead of posting a form, which is what keeps
 * the page still. A form submission would return a fresh page and take the
 * scroll position with it, landing the operator back at the top of a list they
 * were forty rows into.
 *
 * The shown value is local state, so the row updates the moment it is picked
 * rather than when the server answers. `assignItemTag` returns `{ error }` on a
 * refusal rather than throwing — a stale tab whose order has since been
 * cancelled is the case that matters — and the value goes back to what the
 * database still says, with the reason beside it.
 */
export default function TagPicker({
  poId,
  itemId,
  tagId,
  tags,
  label,
}: {
  poId: string;
  itemId: string;
  /** What the database holds. The select follows it whenever it changes. */
  tagId: string | null;
  tags: SpendTag[];
  /** Names the row for a screen reader — the select carries no visible label. */
  label: string;
}) {
  const [value, setValue] = useState(tagId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // What the server last confirmed, so a refusal has somewhere to fall back to.
  const settled = useRef(tagId ?? "");

  // A revalidation, or another tab, moved it. Follow, unless this row is the
  // one mid-flight — reverting under the operator's own click is worse than
  // being a moment behind.
  useEffect(() => {
    settled.current = tagId ?? "";
    if (!pending) setValue(tagId ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId]);

  function choose(next: string) {
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await assignItemTag(poId, itemId, next || null);
      if (result?.error) {
        setError(result.error);
        setValue(settled.current);
        return;
      }
      settled.current = next;
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1">
      <select
        aria-label={`Tag for ${label}`}
        value={value}
        disabled={pending}
        onChange={(e) => choose(e.currentTarget.value)}
        // Narrower type and tighter padding than `.input`: this is one control
        // repeated down a dense list, not a field on a form.
        className={`w-full rounded-lg border bg-card px-2 py-1.5 text-[13px] transition-colors
                    disabled:cursor-progress disabled:opacity-60
                    ${value ? "border-ink-line text-ink" : "border-dashed border-ink-line text-ink-soft"}`}
      >
        {/* Not "None". The dash is what the untagged row in the breakdown is
            called, and one word for one state everywhere. */}
        <option value="">— Untagged</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-[11.5px] font-medium leading-snug text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
