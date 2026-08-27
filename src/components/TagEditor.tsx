"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import ConfirmDelete from "@/components/ConfirmDelete";
import { deleteSpendTag, renameSpendTag } from "@/lib/spend/tag-actions";
import type { SpendTag } from "@/lib/spend/tags";

/**
 * One tag in the list that manages them: its name, its figures, and the two
 * things that can be done to it.
 *
 * Renaming is behind a button rather than being an always-open input. A row of
 * text boxes reads as a form waiting to be filled in, and this is a list of
 * categories that are mostly correct — the edit is the exception, so it asks to
 * be opened.
 *
 * Nothing here needs a confirm except the delete, and that one needs the count:
 * removing a tag with forty items on it is not obviously the same act as
 * removing one nobody has used, and the number is the only thing that says which
 * of the two you are about to do.
 */
export default function TagEditor({
  tag,
  items,
  figures,
}: {
  tag: SpendTag;
  /** How many line items carry it — named in the delete confirmation. */
  items: number;
  /** Its money, already formatted, one string per currency. */
  figures: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // A rename that landed, or one made elsewhere, arrives as a new prop.
  useEffect(() => {
    setName(tag.name);
  }, [tag.name]);

  function save() {
    const next = name.trim();
    if (!next || next === tag.name) {
      setEditing(false);
      setName(tag.name);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameSpendTag(tag.id, next);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setName(tag.name);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
      {editing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <input
              ref={inputRef}
              value={name}
              maxLength={40}
              disabled={pending}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") cancel();
              }}
              className="input max-w-[16rem] py-1.5 text-[14px]"
            />
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="btn btn-primary px-3 py-1.5 text-[12.5px]"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-[12px] font-medium leading-snug text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="truncate text-[14px] font-medium">{tag.name}</span>
          <span className="mono text-[12.5px] text-ink-soft">
            {items === 0 ? (
              "nothing tagged yet"
            ) : (
              <>
                {figures.join("  ·  ")}
                <span className="ml-2 font-sans">
                  {items} {items === 1 ? "line" : "lines"}
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {editing ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]"
          >
            Rename
          </button>
          <ConfirmDelete
            action={() => deleteSpendTag(tag.id)}
            subject={tag.name}
            compact
            warning={
              items === 0
                ? undefined
                : `${items} ${items === 1 ? "line item goes" : "line items go"} back to untagged. The purchase orders themselves are untouched.`
            }
          />
        </div>
      )}
    </li>
  );
}
