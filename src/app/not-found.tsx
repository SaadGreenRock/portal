import Trouble from "@/components/Trouble";

/**
 * Reached by a mistyped URL, a stale bookmark, or a record that has been deleted
 * outright rather than binned.
 *
 * Shares its shell with the error boundaries, because arriving at a dead end is
 * the same experience whether the cause was a bad address or a failure — and
 * the previous version of this screen, the only one in the portal written in
 * inline styles and a default framework blue, read as a different and broken
 * application.
 */
export default function NotFound() {
  return (
    <Trouble title="That page doesn't exist">
      <p>
        The address may have been mistyped, or it may point at a record that has since been
        removed. Numbered documents are normally kept even when deleted, so it is worth
        searching the History tab for the number before assuming it has gone.
      </p>
    </Trouble>
  );
}
