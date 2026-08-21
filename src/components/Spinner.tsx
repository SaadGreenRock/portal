/**
 * The portal's one indeterminate indicator: a faint ring with a brighter
 * quarter of it turning.
 *
 * Stroke-only at `currentColor`, the same convention as every other mark here,
 * which is what lets it sit inside `.btn-primary` and come out in
 * `--accent-text` without stating a colour of its own — and flip with the theme
 * for free, in a button whose accent flips.
 *
 * The faint full ring earns its place as much as the arc does. On its own the
 * arc reads as a stray dash that happens to move; the track behind it is what
 * gives the eye the circle the arc is travelling round.
 *
 * Deliberately not offered for the waits that have a shape to them. A list, a
 * form, a page of figures all get a still wash of what is arriving instead, for
 * the reason set out at the top of the loading screens — a shape cannot be
 * mistaken for progress that has stalled. This is for the waits with no shape
 * to show: a button that has been pressed and is holding.
 */
export default function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`spinner ${className}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
