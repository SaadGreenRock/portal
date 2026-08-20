"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Deletes a record, behind an inline two-step confirm.
 *
 * Deliberately not window.confirm: this sits inside list rows where a stray tap
 * on a phone is easy, and an inline confirm makes it obvious which record is
 * about to go. The second press is a different button in a different place, so
 * a double-tap can't sail straight through it.
 *
 * An action may *return* `{ error }` to explain a refusal, and should, in
 * preference to throwing one. A thrown message is redacted in production — Next
 * replaces it with a digest — so a server-side refusal reaches the operator as
 * the generic fallback below, which tells them nothing and offers no way
 * forward. A returned message survives.
 */
export default function ConfirmDelete({
  action,
  subject,
  compact = false,
  warning,
}: {
  /** Return `{ error }` rather than throwing, so the reason survives production. */
  action: () => Promise<void | { error?: string } | null | undefined>;
  /** What is being deleted, named in the confirm prompt — a document number. */
  subject: string;
  compact?: boolean;
  /**
   * What deleting will also do, stated in the confirm rather than discovered
   * afterwards. For a record whose deletion has a consequence elsewhere.
   */
  warning?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus onto the confirm button, and let Escape back out.
  useEffect(() => {
    if (!armed) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        // A refusal the action chose to explain. On success it redirects or
        // returns nothing, and this never runs.
        if (result && typeof result === "object" && result.error) {
          setError(result.error);
          setArmed(false);
        }
      } catch (e) {
        // A redirect inside a server action surfaces here as a thrown value;
        // it isn't a failure, so only report something that looks like one.
        const message = e instanceof Error ? e.message : "";
        if (message && !/NEXT_REDIRECT/.test(message)) {
          setError("Could not delete. Try again.");
          setArmed(false);
        }
      }
    });
  }

  const size = compact ? "px-2.5 py-1.5 text-[12.5px]" : "px-3 py-2 text-[13px]";

  // Shared by both states so a long explanation wraps instead of stretching the
  // row it sits in.
  const message = error ? (
    <p
      role="alert"
      className="max-w-[24rem] text-right text-[12px] font-medium leading-snug text-red-700"
    >
      {error}
    </p>
  ) : null;

  if (!armed) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setArmed(true)}
          aria-label={`Delete ${subject}`}
          className={`btn btn-quiet ${size} hover:!bg-red-50 hover:!text-red-700`}
        >
          Delete
        </button>
        {message}
      </div>
    );
  }

  return (
    <div className="pop-in flex flex-col items-end gap-1.5 rounded-lg bg-red-50 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="whitespace-nowrap text-[12.5px] font-medium text-red-900">
          Delete {subject}?
        </span>
        <button
          ref={confirmRef}
          type="button"
          onClick={confirm}
          disabled={pending}
          className={`btn btn-danger ${size}`}
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={pending}
          className={`btn btn-quiet ${size} text-red-900`}
        >
          Cancel
        </button>
      </div>
      {warning ? (
        <p className="max-w-[24rem] text-right text-[11.5px] leading-snug text-red-900/80">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
