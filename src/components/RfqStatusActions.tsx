"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RFQ_STATUS_LABELS, type RfqStatus } from "@/lib/rfq/types";

/**
 * Moves a request through its lifecycle.
 *
 * Which buttons appear depends on where it is, so the common next step is the
 * obvious one. Cancelling asks for confirmation because vendors may already hold
 * a copy; everything else is one press away from being undone.
 */
interface Step {
  to: RfqStatus;
  label: string;
  primary?: boolean;
  confirm?: string;
}

const NEXT: Record<RfqStatus, Step[]> = {
  draft: [{ to: "sent", label: "Mark as sent", primary: true }],
  sent: [
    { to: "closed", label: "Close request", primary: true },
    { to: "cancelled", label: "Cancel", confirm: "Cancel this request?" },
    { to: "draft", label: "Back to draft" },
  ],
  closed: [{ to: "sent", label: "Reopen" }],
  cancelled: [{ to: "draft", label: "Back to draft" }],
};

export default function RfqStatusActions({
  status,
  setStatus,
}: {
  status: RfqStatus;
  setStatus: (status: RfqStatus) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState<RfqStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function go(to: RfqStatus) {
    setError(null);
    setArmed(null);
    startTransition(async () => {
      try {
        await setStatus(to);
        router.refresh();
      } catch {
        setError(`Could not move this request to ${RFQ_STATUS_LABELS[to]}.`);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {NEXT[status].map((step) =>
        armed === step.to ? (
          <span key={step.to} className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1.5">
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
            {pending ? "Working…" : step.label}
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
