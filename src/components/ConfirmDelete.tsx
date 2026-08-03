"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Deletes a record, behind an inline two-step confirm.
 *
 * Deliberately not window.confirm: this sits inside list rows where a stray tap
 * on a phone is easy, and an inline confirm makes it obvious which record is
 * about to go. The second press is a different button in a different place, so
 * a double-tap can't sail straight through it.
 */
export default function ConfirmDelete({
  action,
  subject,
  compact = false,
}: {
  action: () => Promise<void>;
  /** What is being deleted, named in the confirm prompt — a document number. */
  subject: string;
  compact?: boolean;
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
        await action();
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
        {error ? (
          <p role="alert" className="text-[12px] font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1.5">
      <span className="whitespace-nowrap text-[12.5px] font-medium text-red-900">
        Delete {subject}?
      </span>
      <button
        ref={confirmRef}
        type="button"
        onClick={confirm}
        disabled={pending}
        className={`btn bg-red-700 text-white hover:bg-red-800 ${size}`}
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
  );
}
