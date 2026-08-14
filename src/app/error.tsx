"use client";

import Trouble from "@/components/Trouble";

/**
 * The catch-all for an unhandled failure anywhere the workspace and food
 * boundaries do not cover.
 *
 * Without this, Next.js shows its own screen — "Application error: a
 * server-side exception has occurred" — which is unbranded, unactionable, and
 * looks identical to the portal having lost its data.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Trouble
      title="Something went wrong on that screen"
      detail={error.digest ?? error.message}
      retry={reset}
    >
      <p>
        The portal could not finish loading this page. It is almost always temporary — the
        database being briefly unreachable is the usual cause.
      </p>
      <p>
        <strong className="font-semibold text-ink">Nothing has been lost.</strong> Every voucher,
        order and scan is exactly as it was; this is a problem displaying them, not storing them.
      </p>
    </Trouble>
  );
}
