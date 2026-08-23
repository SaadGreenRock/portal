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
        The rest of the log still works.{" "}
        <strong className="font-semibold text-ink">No entry was changed.</strong>
      </p>
    </Trouble>
  );
}
