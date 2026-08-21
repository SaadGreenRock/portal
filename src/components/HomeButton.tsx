"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HomeMark from "@/components/HomeMark";
import NavPending from "@/components/NavPending";

/**
 * The way back to the top: the companies, with Food, Expenditure and Funding
 * under them.
 *
 * It replaces the "← Companies" button that four headers had each grown their
 * own copy of — Food, Funding, Expenditure and Help — which named the
 * destination by the first thing on it rather than by what it is. That screen is
 * home; every way in starts there, and three of the four sections on it are not
 * a company at all.
 *
 * A house rather than the word, and quiet rather than ghost, for the reason the
 * padlock beside it gives: a glyph the interface draws itself, at the interface's
 * own weight. Where the old button was a bordered control competing with "New
 * entry" next to it, this is a mark in the corner where the furniture lives.
 * Sitting in `HeaderControls` it arrives on every header at once, in the same
 * place, rather than on the four that remembered.
 *
 * Deliberately at the far left of that group and not beside Lock, which is the
 * arrangement's one real decision. Both are doors, and grouping them would be
 * the tidier-looking answer — but one goes to a screen and the other ends the
 * session, and two icon buttons four pixels apart is how a press meant for the
 * first lands on the second. The clock and the theme keep them apart.
 */
export default function HomeButton({
  className = "btn btn-quiet p-2.5",
}: {
  className?: string;
}) {
  const pathname = usePathname();

  // Nothing to offer on the screen it would take you to. Checked here rather
  // than passed in, so the landing page cannot forget to say so and no other
  // caller has to know the rule exists.
  if (pathname === "/") return null;

  return (
    <Link href="/" title="Home" aria-label="Home" className={`relative ${className}`}>
      <HomeMark />
      {/* Home is the slowest screen in the portal to arrive — it counts both
          companies, the food log and the whole funding ledger — so the one
          control that goes there says when it is on its way, in the same
          language every nav in the portal uses. */}
      <NavPending className="inset-x-1.5 bottom-1" />
    </Link>
  );
}
