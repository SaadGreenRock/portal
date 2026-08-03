"use client";

import { useSheetPdf } from "./use-sheet-pdf";

/**
 * Renders a voucher's PDF in the browser and files it against the record.
 *
 * Used both right after Generate and by the retry button on a voucher that has
 * no PDF yet, so the two paths can never drift apart. The work is done by
 * useSheetPdf; this just names the voucher's endpoints.
 */
export function useVoucherPdf() {
  const pdf = useSheetPdf();

  const target = (voucherId: string, voucherNo?: string) => ({
    sheetUrl: `/api/voucher/${voucherId}/sheet`,
    pdfUrl: `/api/voucher/${voucherId}/pdf`,
    title: voucherNo,
  });

  // Not memoised: the only dependency is `pdf`, which is a fresh object every
  // render, so a useCallback here would rebuild the function every time anyway
  // while implying to the reader that it doesn't.
  return {
    stage: pdf.stage,
    error: pdf.error,
    busy: pdf.busy,
    build: (voucherId: string, voucherNo?: string) => pdf.build(target(voucherId, voucherNo)),
    tryBuild: (voucherId: string, voucherNo?: string) => pdf.tryBuild(target(voucherId, voucherNo)),
  };
}
