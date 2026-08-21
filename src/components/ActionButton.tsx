"use client";

import { useState, useTransition } from "react";

/**
 * A button that runs a server action and shows what comes back.
 *
 * The plain `<form action={…}>` this replaces cannot report anything: a thrown
 * message is redacted in production, so a refusal arrives as a full-page error
 * boundary — which throws away the screen the operator was on to tell them
 * something a line of text could have. Actions that can be refused for an
 * ordinary reason return `{ error }` instead, and this renders it in place.
 *
 * `ConfirmDelete` does the same thing behind a two-step confirm; this is for the
 * single-press cases, where there is nothing to confirm.
 */
export default function ActionButton({
  action,
  label,
  pendingLabel,
  className = "btn btn-ghost",
}: {
  action: () => Promise<void | { error?: string } | null | undefined>;
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result && typeof result === "object" && result.error) setError(result.error);
      } catch (e) {
        // A redirect inside a server action surfaces here as a thrown value; it
        // isn't a failure, so only report something that looks like one.
        const message = e instanceof Error ? e.message : "";
        if (message && !/NEXT_REDIRECT/.test(message)) setError("That did not work. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={run} disabled={pending} className={className}>
        {pending ? (pendingLabel ?? `${label}…`) : label}
      </button>
      {error ? (
        <p
          role="alert"
          className="max-w-[24rem] text-right text-[12px] font-medium leading-snug text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
