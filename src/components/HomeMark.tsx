/**
 * A small house, stroke only — the same convention as the padlock and the Food
 * and Expenditure marks: a glyph at the interface's own line weight rather than
 * a coloured icon-font character sitting at a different weight beside it.
 *
 * Drawn to the same optical box as `LockMark`, which is the point of the
 * numbers rather than an accident of them: the two sit next to each other in
 * every header in the portal, and a house even slightly the larger of the two
 * reads as the emphasised one.
 */
export default function HomeMark({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.4 10.4 12 4l7.6 6.4v9a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M9.9 20.8v-5h4.2v5" />
    </svg>
  );
}
