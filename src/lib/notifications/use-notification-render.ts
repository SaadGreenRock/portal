"use client";

import { useCallback, useState } from "react";
import { renderNotificationCard } from "./client-render";

/**
 * Renders a notification's PNG and PDF in the browser and files both against
 * the record.
 *
 * Same shape as use-sheet-pdf.ts's useSheetPdf, but not built on it: this is
 * one raster feeding two upload targets, which doesn't fit that hook's
 * one-sheet-one-PDF contract.
 */

export type RenderStage = "idle" | "rendering" | "uploading" | "done";

export function useNotificationRender() {
  const [stage, setStage] = useState<RenderStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const build = useCallback(async (id: string): Promise<void> => {
    setError(null);
    setStage("rendering");

    const res = await fetch(`/api/notification/${id}/sheet`);
    if (!res.ok) throw new Error("Could not load the card layout.");
    const svg = await res.text();

    const { png, pdf } = await renderNotificationCard(svg);

    setStage("uploading");
    const [imgRes, pdfRes] = await Promise.all([
      fetch(`/api/notification/${id}/image`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: png,
      }),
      fetch(`/api/notification/${id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdf,
      }),
    ]);
    if (!imgRes.ok || !pdfRes.ok) throw new Error("Could not save the generated files.");

    setStage("done");
  }, []);

  /** Same as build(), but reports failures through state instead of throwing. */
  const tryBuild = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await build(id);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not produce the notification files.");
        setStage("idle");
        return false;
      }
    },
    [build],
  );

  return {
    stage,
    error,
    build,
    tryBuild,
    busy: stage === "rendering" || stage === "uploading",
  };
}
