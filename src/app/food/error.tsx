"use client";

import Trouble from "@/components/Trouble";

/** A failure inside the food log, with its own shell and tabs left standing. */
export default function FoodError({
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
      home={{ href: "/food", label: "Back to the log" }}
    >
      <p>
        Something went wrong fetching this page. The rest of the food log is unaffected — the
        tabs above still work.
      </p>
      <p>
        <strong className="font-semibold text-ink">Nothing has been lost.</strong> No entry was
        changed, and nothing has been marked paid or unpaid by this.
      </p>
    </Trouble>
  );
}
