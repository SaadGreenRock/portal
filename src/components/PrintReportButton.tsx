"use client";

/**
 * Hands the report to the browser's print dialogue, where "Save as PDF" is the
 * destination the bosses actually want.
 *
 * Deliberately not `PrintButton`, which loads an already-rendered PDF into a
 * hidden iframe and prints that. There is no file here to load: the report is
 * the page, so what gets printed is the document itself and the PDF the operator
 * saves comes out as real, searchable text rather than a picture of a table.
 *
 * A plain `window.print()` and nothing else — no busy state, because the dialogue
 * opens synchronously and owns the screen from that moment, so there is no
 * interval during which a spinner would be telling anybody anything.
 */
export default function PrintReportButton({
  className = "btn btn-primary",
  children = "Save as PDF",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {children}
    </button>
  );
}
