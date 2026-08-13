"use client";

import { buildImagePdf, type PdfImagePage } from "./image-pdf";
import { SHEET } from "./sheet";

/**
 * Turns document SVGs into a PDF, in the operator's browser.
 *
 *   SVG (foreignObject) → <img> → <canvas> → JPEG → PDF
 *
 * The browser does the layout and the text shaping, which is the whole point:
 * the voucher's Urdu comes out correctly shaped without any Chromium on the
 * server, so this deploys to Vercel's free tier with no cold start. Purchase
 * orders ride the same path — one SVG per page.
 */

/**
 * 3× the CSS reference resolution, i.e. 288dpi. Letter at 3× is 2448×3168,
 * which prints indistinguishably from vector at normal reading distance while
 * keeping the page a few hundred KB.
 */
const SCALE = 3;

/**
 * Resolution has to give way on a long document.
 *
 * The finished PDF is posted back in one request, and a serverless request body
 * is capped around 4.5 MB. At 288dpi a page costs roughly 570 KB, so an order
 * past about seven pages could not be saved at all. Dropping to 240 and then
 * 192dpi keeps a long order well inside the limit; both are still comfortably
 * above what a text document needs to print cleanly, and every ordinary
 * one-to-three page order keeps the full 288.
 */
function scaleFor(pageCount: number): number {
  if (pageCount <= 3) return SCALE;
  if (pageCount <= 8) return 2.5;
  return 2;
}

/** Above ~0.93 the file grows fast for no visible gain on text this size. */
const JPEG_QUALITY = 0.93;

export interface RenderResult {
  blob: Blob;
  bytes: number;
}

/** Rasterises one page. */
async function svgToPage(svg: string, scale: number): Promise<PdfImagePage> {
  const image = await loadSvg(svg);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(SHEET.widthPx * scale);
  canvas.height = Math.round(SHEET.heightPx * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser did not provide a 2D canvas context.");

  // The SVG already paints a white page, but fill anyway so a transparent
  // rasterisation can never come out black once flattened into the PDF.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return {
    jpeg: await canvasToJpeg(canvas),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    pageWidthPt: SHEET.widthPt,
    pageHeightPt: SHEET.heightPt,
  };
}

/**
 * Renders every page and assembles the PDF.
 *
 * Pages are rasterised one at a time rather than in parallel: each one holds a
 * 2448×3168 canvas plus its decoded source image, and a phone rendering four of
 * those at once is how you get a silently failed toBlob().
 */
export async function sheetsToPdf(
  svgs: string[],
  title?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderResult> {
  if (svgs.length === 0) throw new Error("There are no pages to render.");

  const scale = scaleFor(svgs.length);
  const pages: PdfImagePage[] = [];
  for (let i = 0; i < svgs.length; i++) {
    // Reported before the work, so the label names the page being rendered.
    onProgress?.(i + 1, svgs.length);
    pages.push(await svgToPage(svgs[i], scale));
  }

  const pdf = buildImagePdf({ pages, title });

  // Copy into a fresh buffer so the Blob owns plain ArrayBuffer-backed bytes.
  const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
  return { blob, bytes: blob.size };
}

/** The single-page case, which is every voucher. */
export function voucherSvgToPdf(svg: string, title?: string): Promise<RenderResult> {
  return sheetsToPdf([svg], title);
}

/**
 * Decodes an SVG through an <img>.
 *
 * It must be a data: URI, not a blob: URL. Chrome treats an SVG drawn from a
 * blob: URL as tainting the canvas, so the subsequent toBlob() fails with a
 * SecurityError; a data: URI counts as same-origin and stays exportable.
 *
 * FileReader does the base64 encoding, because the SVG carries ~0.6–1.5 MB of
 * inlined font data and btoa(String.fromCharCode(...bytes)) would blow the call
 * stack at that size.
 */
export async function loadSvg(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });

  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode the page for rendering."));
    reader.readAsDataURL(blob);
  });

  return new Promise((resolve, reject) => {
    const img = new Image();
    // Decoding must finish before the canvas is painted.
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () =>
      // The usual cause is markup the SVG parser rejects: foreignObject content
      // must be well-formed XHTML, so an unclosed tag or a bare &nbsp; is fatal.
      reject(new Error("The browser could not rasterise the page."));
    img.src = dataUri;
  });
}

export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not encode the page image."));
          return;
        }
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
