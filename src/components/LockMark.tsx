/**
 * A small closed padlock, stroke only — no fill, the same convention as the
 * Food and Expenditure marks: a glyph at the interface's own line weight,
 * not a coloured icon-font character sitting at a different weight beside it.
 *
 * Shared by the Lock button and the login screen, so both draw the same
 * glyph rather than two hand-drawn lookalikes drifting apart over time.
 */
export default function LockMark({ className = "h-[18px] w-[18px]" }: { className?: string }) {
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
      <rect x="4.5" y="11" width="15" height="9" rx="2.2" />
      <path d="M8 11V7.6a4 4 0 0 1 8 0V11" />
    </svg>
  );
}
