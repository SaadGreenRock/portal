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
        Something went wrong fetching this page. The rest of the portal is unaffected — the tabs
        above still work.
      </p>
      <p>
        <strong className="font-semibold text-ink">Nothing has been lost.</strong> No tranche was
        changed and no expense was allocated or unallocated by this.
      </p>
    </Trouble>
  );
}
