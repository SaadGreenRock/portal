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

    /**
     * Pages are fetched one at a time. Each carries its own copy of the inlined
     * fonts, so asking for all of them in one response overruns the platform's
     * response limit on anything longer than a few pages.
     */
    const fetchPage = async (page: number) => {
      const url = new URL(sheetUrl, window.location.origin);
      if (page > 1) url.searchParams.set("page", String(page));
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not load the document layout.");
      return { svg: await res.text(), count: Number(res.headers.get("X-Page-Count") ?? "1") || 1 };
    };

    const first = await fetchPage(1);
    const svgs = [first.svg];
    setProgress(first.count > 1 ? { done: 1, total: first.count } : null);

    for (let page = 2; page <= first.count; page++) {
      svgs.push((await fetchPage(page)).svg);
    }

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
