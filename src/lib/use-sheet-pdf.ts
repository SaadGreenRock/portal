"use client";

import { useCallback, useState } from "react";
import { sheetsToPdf } from "./client-pdf";

/**
 * Renders a document's PDF in the browser and files it against the record.
 *
 * Both document types use this: the server hands over the page(s) as SVG, the
 * browser rasterises them, and the finished PDF is posted back. Keeping it in
 * one hook means Generate, the retry button and the purchase order editor can
 * never drift apart in how they handle a half-finished render.
 */

export type PdfStage = "idle" | "rendering" | "uploading" | "done";

export interface SheetPdfTarget {
  /**
   * GET endpoint returning either a single SVG (`image/svg+xml`) or, for a
   * multi-page document, JSON of the form `{ pages: string[] }`.
   */
  sheetUrl: string;
  /** POST endpoint that accepts the finished `application/pdf` body. */
  pdfUrl: string;
  /** Goes into the PDF's title metadata. */
  title?: string;
}

export function useSheetPdf() {
  const [stage, setStage] = useState<PdfStage>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Which page is being rasterised, for documents long enough to notice. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const build = useCallback(async ({ sheetUrl, pdfUrl, title }: SheetPdfTarget) => {
    setError(null);
    setProgress(null);
    setStage("rendering");

    const sheet = await fetch(sheetUrl);
    if (!sheet.ok) throw new Error("Could not load the document layout.");

    const svgs = sheet.headers.get("content-type")?.includes("application/json")
      ? ((await sheet.json()) as { pages: string[] }).pages
      : [await sheet.text()];

    const { blob } = await sheetsToPdf(svgs, title, (page, total) =>
      setProgress(total > 1 ? { done: page, total } : null),
    );

    setStage("uploading");
    const saved = await fetch(pdfUrl, {
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
    async (target: SheetPdfTarget): Promise<boolean> => {
      try {
        await build(target);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not produce the PDF.");
        setStage("idle");
        setProgress(null);
        return false;
      }
    },
    [build],
  );

  /** Ready-made button text, so every caller words the wait the same way. */
  const statusLabel = (idle: string): string => {
    if (stage === "uploading") return "Saving PDF…";
    if (stage === "rendering") {
      return progress ? `Rendering page ${progress.done} of ${progress.total}…` : "Rendering PDF…";
    }
    return idle;
  };

  return {
    stage,
    error,
    progress,
    build,
    tryBuild,
    statusLabel,
    busy: stage === "rendering" || stage === "uploading",
  };
}
