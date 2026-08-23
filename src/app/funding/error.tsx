"use client";

import Trouble from "@/components/Trouble";

/** A failure inside the funding section, with its shell and tabs left standing. */
export default function FundingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Trouble
      title="This screen could not be loaded"
      detail={error.digest ?? error.message}
      retry={reset}
      home={{ href: "/funding", label: "Back to the tranches" }}
    >
      <p>
        The rest of the portal still works.{" "}
        <strong className="font-semibold text-ink">
          No tranche or allocation was changed.
        </strong>
      </p>
    </Trouble>
  );
}
