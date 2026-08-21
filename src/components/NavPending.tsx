"use client";

import { useLinkStatus } from "next/link";

/**
 * The nav item you just pressed, while its route is still on its way.
 *
 * `useLinkStatus` reports on the `<Link>` this sits inside, which is why it is a
 * component rather than a prop: the hook reads an ancestor, so the indicator has
 * to be a child of the link it speaks for. Rendered in every nav in the portal,
 * so "the one I pressed" looks the same in a workspace, in Food and in Funding.
 *
 * It answers a question no skeleton can. A loading screen says something is
 * coming; it cannot say *which* of eleven tabs is bringing it — and on a slow
 * request the operator's own press is the only evidence, which fades from memory
 * about as fast as it takes to wonder whether the click registered.
 *
 * Absolutely positioned, and that is the point rather than a detail. Anything in
 * the flow — a spinner beside the label, a widening pill — would shove every
 * item after it sideways at the moment of the press, in a row that scrolls
 * horizontally on a phone. This reserves nothing and moves nothing.
 *
 * Nothing renders until the navigation is actually in flight, so an instant
 * route — anything already prefetched — never flashes a bar. The indicator only
 * appears where there is a wait to report.
 */
export default function NavPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      aria-hidden="true"
      className={`nav-pending pointer-events-none absolute h-0.5 overflow-hidden rounded-full ${className}`}
    />
  );
}
