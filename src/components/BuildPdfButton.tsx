"use client";

import { useRouter } from "next/navigation";
import { useVoucherPdf } from "@/lib/use-voucher-pdf";

/**
 * Produces a voucher's PDF from the browser.
 *
 * Shown when a voucher has no stored PDF — either because the render was
 * interrupted, or because the browser that generated it could not rasterise.
 * The record already exists, so this is always safe to retry.
 */
export default function BuildPdfButton({
  voucherId,
  voucherNo,
  label = "Render PDF",
}: {
  voucherId: string;
  voucherNo: string;
  label?: string;
}) {
  const pdf = useVoucherPdf();
  const router = useRouter();

  async function run() {
    if (await pdf.tryBuild(voucherId, voucherNo)) router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={run} disabled={pdf.busy} className="btn btn-primary">
        {pdf.stage === "rendering"
          ? "Rendering…"
          : pdf.stage === "uploading"
            ? "Saving…"
            : label}
      </button>
      {pdf.error ? (
        <p role="alert" className="max-w-xs text-[12.5px] font-medium text-red-700">
          {pdf.error}
        </p>
      ) : null}
    </div>
  );
}
