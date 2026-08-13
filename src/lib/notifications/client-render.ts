"use client";

import { canvasToJpeg, loadSvg } from "../client-pdf";
import { buildImagePdf } from "../image-pdf";
import { CARD } from "./geometry";

/**
 * Turns a notification card's SVG into both of its outputs, in the operator's
 * browser — one rasterisation, branched two ways.
 *
 * Deliberately not built on client-pdf.ts's sheetsToPdf: that path is wired to
 * the voucher/PO page size (SHEET) and to multi-page documents, neither of
 * which applies to one ~360×450 card. This draws its own canvas at the card's
 * own geometry instead, then:
 *   - canvas.toBlob("image/png") for the WhatsApp-ready image
 *   - the existing canvasToJpeg() + buildImagePdf() for the one-page PDF
 */

/** 288dpi-equivalent — a small single card needs no page-count backoff. */
const SCALE = 3;

export interface RenderedCard {
  png: Blob;
  pdf: Blob;
}

export async function renderNotificationCard(svg: string): Promise<RenderedCard> {
  const image = await loadSvg(svg);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CARD.widthPx * SCALE);
  canvas.height = Math.round(CARD.heightPx * SCALE);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser did not provide a 2D canvas context.");

  // The SVG already paints a white card, but fill anyway so a transparent
  // rasterisation can never come out black once flattened into the PDF.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      "image/png",
    );
  });

  const jpeg = await canvasToJpeg(canvas);
  const pdfBytes = buildImagePdf({
    pages: [
      {
        jpeg,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        pageWidthPt: CARD.widthPt,
        pageHeightPt: CARD.heightPt,
      },
    ],
  });
  const pdf = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

  return { png, pdf };
}
