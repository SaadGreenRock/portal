import { signOut } from "@/lib/session-actions";

/**
 * The one "Lock" button, used on every authenticated screen — root, each
 * workspace, Food, and Expenditure — so it is always in the same place in the
 * same corner and always does the same thing, rather than four screens each
 * having grown their own copy.
 */
export default function LockButton({
  className = "btn btn-quiet px-3 py-1.5 text-[13px]",
}: {
  className?: string;
}) {
  return (
    <form action={signOut}>
      <button type="submit" className={className}>
        Lock
      </button>
    </form>
  );
}
