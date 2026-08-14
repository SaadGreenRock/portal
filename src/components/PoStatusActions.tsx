"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/po/types";

/**
 * Moves a purchase order through its lifecycle.
 *
 * Which buttons appear depends on where the order is, so the common next step
 * is always the obvious one and the unusual ones stay quiet. Cancelling asks
 * for confirmation because the vendor may already hold a copy; everything else
 * is reversible in one press and so does not.
 */

interface Step {
  to: PoStatus;
  label: string;
  primary?: boolean;
  confirm?: string;
}

const NEXT: Record<PoStatus, Step[]> = {
  draft: [{ to: "issued", label: "Mark as issued", primary: true }],
  issued: [
    { to: "closed", label: "Close order", primary: true },
    { to: "cancelled", label: "Cancel", confirm: "Cancel this order?" },
    { to: "draft", label: "Back to draft" },
  ],
  closed: [{ to: "issued", label: "Reopen" }],
  cancelled: [{ to: "draft", label: "Back to draft" }],
};

export default function PoStatusActions({
  status,
  setStatus,
}: {
  status: PoStatus;
  setStatus: (status: PoStatus) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState<PoStatus | null>(null);
  /** Which step is running, so the progress text lands on the button that was pressed. */
  const [running, setRunning] = useState<PoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function go(to: PoStatus) {
    setError(null);
    setArmed(null);
    setRunning(to);
    startTransition(async () => {
      try {
        await setStatus(to);
        router.refresh();
      } catch {
        setError(`Could not move this order to ${PO_STATUS_LABELS[to]}.`);
      } finally {
        setRunning(null);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {NEXT[status].map((step) =>
        armed === step.to ? (
          <span
            key={step.to}
            className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1.5"
          >
            <span className="whitespace-nowrap text-[12.5px] font-medium text-red-900">
              {step.confirm}
            </span>
            <button
              type="button"
              autoFocus
              disabled={pending}
              onClick={() => go(step.to)}
              className="btn bg-red-700 px-3 py-1.5 text-[12.5px] text-white hover:bg-red-800"
            >
              Yes, cancel
            </button>
            <button
              type="button"
              onClick={() => setArmed(null)}
              className="btn btn-quiet px-2.5 py-1.5 text-[12.5px] text-red-900"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            key={step.to}
            type="button"
            disabled={pending}
            onClick={() => (step.confirm ? setArmed(step.to) : go(step.to))}
            className={`btn ${step.primary ? "btn-primary" : "btn-ghost"}`}
          >
            {/* Only the pressed button reports progress. Relabelling all of
                them suggested three things were happening and hid which one
                had actually been chosen. */}
            {running === step.to ? "Working…" : step.label}
          </button>
        ),
      )}

      {error ? (
        <p role="alert" className="text-[12.5px] font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
