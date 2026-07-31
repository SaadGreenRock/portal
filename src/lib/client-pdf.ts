"use client";

import { buildSingleImagePdf } from "./single-image-pdf";
import { SHEET } from "./sheet";

/**
 * Turns a voucher SVG into a PDF, in the operator's browser.
 *
 *   SVG (foreignObject) → <img> → <canvas> → JPEG → PDF
 *
 * The browser does the layout and the text shaping, which is the whole point:
 * the Urdu comes out correctly shaped without any Chromium on the server, so
 * this deploys to Vercel's free tier with no cold start.
 */

/**
 * 3× the CSS reference resolution, i.e. 288dpi. Letter at 3× is 2448×3168,
 * which prints indistinguishably from vector at normal reading distance while
 * keeping the file a few hundred KB.
 */
const SCALE = 3;

/** Above ~0.93 the file grows fast for no visible gain on text this size. */
const JPEG_QUALITY = 0.93;

export interface RenderResult {
  blob: Blob;
  bytes: number;
}

export async function voucherSvgToPdf(svg: string, title?: string): Promise<RenderResult> {
  const image = await loadSvg(svg);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(SHEET.widthPx * SCALE);
  canvas.height = Math.round(SHEET.heightPx * SCALE);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser did not provide a 2D canvas context.");

  // The SVG already paints a white page, but fill anyway so a transparent
  // rasterisation can never come out black once flattened into the PDF.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const jpeg = await canvasToJpeg(canvas);

  const pdf = buildSingleImagePdf({
    jpeg,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    pageWidthPt: SHEET.widthPt,
    pageHeightPt: SHEET.heightPt,
    title,
  });

  // Copy into a fresh buffer so the Blob owns plain ArrayBuffer-backed bytes.
  const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
  return { blob, bytes: blob.size };
}

/**
 * Decodes the SVG through an <img>.
 *
 * It must be a data: URI, not a blob: URL. Chrome treats an SVG drawn from a
 * blob: URL as tainting the canvas, so the subsequent toBlob() fails with a
 * SecurityError; a data: URI counts as same-origin and stays exportable.
 *
 * FileReader does the base64 encoding, because the SVG carries ~1.5 MB of
 * inlined font data and btoa(String.fromCharCode(...bytes)) would blow the call
 * stack at that size.
 */
async function loadSvg(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });

  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode the voucher for rendering."));
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
      reject(new Error("The browser could not rasterise the voucher."));
    img.src = dataUri;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not encode the voucher image."));
          return;
        }
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
