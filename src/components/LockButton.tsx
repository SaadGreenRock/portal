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
  return (
    <form action={signOut}>
      <button type="submit" title="Lock" aria-label="Lock" className={className}>
        <LockMark />
      </button>
    </form>
  );
}

/**
 * Stroke only, no fill — the same convention as the Food and Expenditure
 * marks: a glyph at the interface's own line weight, not a coloured icon-font
 * character that would sit at a different weight and size next to it.
 */
function LockMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="11" width="15" height="9" rx="2.2" />
      <path d="M8 11V7.6a4 4 0 0 1 8 0V11" />
    </svg>
  );
}
