"use client";

import { useCallback, useState } from "react";
import { voucherSvgToPdf } from "./client-pdf";

/**
 * Renders a voucher's PDF in the browser and files it against the record.
 *
 * Used both right after Generate and by the retry button on a voucher that has
 * no PDF yet, so the two paths can never drift apart.
 */
export function useVoucherPdf() {
  const [stage, setStage] = useState<"idle" | "rendering" | "uploading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const build = useCallback(async (voucherId: string, voucherNo?: string) => {
    setError(null);
    setStage("rendering");

    const sheet = await fetch(`/api/voucher/${voucherId}/sheet`);
    if (!sheet.ok) throw new Error("Could not load the voucher layout.");

    const { blob } = await voucherSvgToPdf(await sheet.text(), voucherNo);

    setStage("uploading");
    const saved = await fetch(`/api/voucher/${voucherId}/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: blob,
    });
    if (!saved.ok) {
      const body = await saved.json().catch(() => null);
      throw new Error(body?.error ?? "Could not save the PDF.");
    }

    setStage("done");
  }, []);

  /** Same as build(), but reports failures through state instead of throwing. */
  const tryBuild = useCallback(
    async (voucherId: string, voucherNo?: string): Promise<boolean> => {
      try {
        await build(voucherId, voucherNo);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not produce the PDF.");
        setStage("idle");
        return false;
      }
    },
    [build],
  );

  return { stage, error, build, tryBuild, busy: stage === "rendering" || stage === "uploading" };
}
