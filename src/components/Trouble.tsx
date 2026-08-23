"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * The one screen for "this did not work", used by every error boundary and by
 * the 404.
 *
 * Two lines on the face of it: what happened, and whether the records are safe.
 * It used to be two full paragraphs of reassurance per boundary, on the argument
 * that the first fear on meeting an error page is that the paperwork is gone.
 * That fear is real but it is answered by a clause, not a paragraph — at the
 * length it was, the operator had to read past the comfort to reach the button.
 *
 * No technical detail on the face of it either. A digest tells the person
 * reading it nothing they can act on, so it goes in the fold at the bottom where
 * it can be copied into a message to whoever maintains this.
 */
export default function Trouble({
  title,
  children,
  detail,
  retry,
  home = { href: "/", label: "Go to the company picker" },
}: {
  title: string;
  /** One line: what happened, and what it means for the records. */
  children: React.ReactNode;
  /** Error digest or message — folded away, for passing on rather than reading. */
  detail?: string | null;
  /** The boundary's own `reset`. Omitted on a 404, where there is nothing to retry. */
  retry?: () => void;
  home?: { href: string; label: string };
}) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  /**
   * Why this is not just `reset()`.
   *
   * `reset()` clears the boundary and re-renders its children — but against the
   * *cached* server payload, which is still the failure. So the same error is
   * thrown again in the same frame, the same screen paints, and the button reads
   * as doing nothing at all. Which is exactly what it did: the only way back was
   * the browser's own reload.
   *
   * `router.refresh()` is the half that was missing. It discards the cached
   * payload for this route and asks the server again; `reset()` then clears the
   * boundary so the fresh render can mount. Both, in that order.
   *
   * Wrapped in a transition so `retrying` can put the button in a pending state.
   * A retry that takes a second to come back would otherwise look just as inert
   * as the broken one did.
   */
  function tryAgain() {
    startTransition(() => {
      router.refresh();
      retry?.();
    });
  }

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col justify-center px-5 py-12">
      <div className="card px-6 py-10 text-center sm:px-8">
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>

        <div className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          {children}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {retry ? (
            <button
              type="button"
              onClick={tryAgain}
              disabled={retrying}
              className="btn btn-primary"
            >
              {retrying ? "Retrying…" : "Try again"}
            </button>
          ) : null}
          <Link href={home.href} className={retry ? "btn btn-ghost" : "btn btn-primary"}>
            {home.label}
          </Link>
        </div>

        {detail ? (
          <details className="mt-7 text-left">
            <summary className="cursor-pointer text-[12.5px] text-ink-soft hover:text-ink">
              Technical details
            </summary>
            <p className="mt-2 break-all rounded-lg bg-page px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-soft">
              {detail}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              Send this line to whoever maintains the portal. It identifies the failure in the
              server logs.
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
