"use client";

import { useFormStatus } from "react-dom";
import Spinner from "@/components/Spinner";

/**
 * A submit button that says so while its form is in flight.
 *
 * `useFormStatus` reads the state of the form this sits inside, which is the
 * whole reason it is a component rather than a prop on the form: the hook
 * reports on an ancestor, so the button has to be the client boundary and the
 * page above it can stay a server component with its action written inline.
 *
 * Two things change on press and they are meant to be read in that order — the
 * label, which says what is happening, and the ring, which says it is still
 * happening. Either alone is thinner: a spinner beside an unchanged label reads
 * as a button that failed to notice the press, and a label alone gives nothing
 * to look at while a cold serverless request wakes up.
 *
 * Disabled while pending, which is the point as much as the feedback is. The
 * screen that most needs this is the lock screen, where a second press is a
 * second session start.
 */
export default function SubmitButton({
  label,
  pendingLabel,
  className = "btn btn-primary w-full",
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? `${label}…`}
        </>
      ) : (
        label
      )}
    </button>
  );
}
