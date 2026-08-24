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
 * padlock gives: a glyph the interface draws itself, at the interface's own
 * weight. Where the old button was a bordered control competing with "New entry"
 * next to it, this is a mark in the corner where the furniture lives.
 *
 * It sits at the **far left of the header**, before the title, and that is the
 * arrangement's one real decision. It lived in `HeaderControls` at the right-hand
 * end for a while, which put the way back at the end of the line you read — every
 * other back-and-up control anybody uses all day, in a browser or a phone, is at
 * the top left, and a house in the top right reads as a stray. On the left it is
 * also as far as a header can get from Lock: both are doors, one goes to a screen
 * and the other ends the session, and two icon buttons four pixels apart is how a
 * press meant for the first lands on the second.
 *
 * Each header places it rather than inheriting it, because where "the far left"
 * is depends on what is there — a title on most screens, and nothing at all on
 * the company workspace, whose logo is already a link home sitting in exactly
 * this spot. That header therefore does not draw one: two controls a few pixels
 * apart going to the same place is worse than the consistency it would buy.
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
