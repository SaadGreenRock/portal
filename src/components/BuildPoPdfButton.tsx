"use client";

import { useRouter } from "next/navigation";
import { useSheetPdf } from "@/lib/use-sheet-pdf";

/**
 * Renders a purchase order's PDF from the browser.
 *
 * Shown when the order has no PDF, or when the one on file predates the last
 * edit. The record already exists, so this is always safe to press again.
 */
export default function BuildPoPdfButton({
  poId,
  poNo,
  label = "Render PDF",
  className = "btn btn-primary",
}: {
  poId: string;
  poNo: string;
  label?: string;
  className?: string;
}) {
  const pdf = useSheetPdf();
  const router = useRouter();

  async function run() {
    const ok = await pdf.tryBuild({
      sheetUrl: `/api/po/${poId}/sheet`,
      pdfUrl: `/api/po/${poId}/pdf`,
      title: poNo,
    });
    if (ok) router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={run} disabled={pdf.busy} className={className}>
        {pdf.statusLabel(label)}
      </button>
      {pdf.error ? (
        <p role="alert" className="max-w-xs text-[12.5px] font-medium text-red-700">
          {pdf.error}
        </p>
      ) : null}
    </div>
  );
}
