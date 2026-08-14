import LockMark from "@/components/LockMark";
import { signOut } from "@/lib/session-actions";

/**
 * The one "Lock" control, used on every authenticated screen — root, each
 * workspace, Food, and Expenditure — so it is always in the same place in the
 * same corner and always does the same thing, rather than four screens each
 * having grown their own copy.
 *
 * A small padlock rather than the word "Lock": the action is unambiguous as
 * an icon, and it reads as part of the same design as the Food and
 * Expenditure marks on the landing page rather than a stray text button.
 */
export default function LockButton({
  className = "btn btn-quiet p-2.5",
}: {
  className?: string;
}) {
  // Named for what pressing it does, not for the glyph. "Lock" alone left the
  // one way out of the portal described by a padlock — which, sitting beside a
  // document, reads at least as plausibly as "lock this record".
  return (
    <form action={signOut}>
      <button
        type="submit"
        title="Lock the portal on this device"
        aria-label="Lock the portal on this device"
        className={className}
      >
        <LockMark />
      </button>
    </form>
  );
}
