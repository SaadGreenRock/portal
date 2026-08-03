"use client";

/**
 * Shrinks a photographed document before it is uploaded.
 *
 * This is not an optimisation — it is what makes uploading work at all. A
 * serverless request body is capped at 4.5 MB on Vercel, and a modern phone
 * camera produces 3–12 MB per shot, so a straight upload of an invoice photo
 * fails. Re-encoding in the browser at a resolution that is still comfortably
 * legible brings a 9 MB photo down to a few hundred KB.
 *
 * 2400px on the long edge is about 200 dpi across an A4 page: fine enough to
 * read a serial number off an invoice, and far more than is needed to see that
 * a signature is present.
 */

/** What we aim to come in under. Comfortably inside every platform limit. */
export const UPLOAD_TARGET_BYTES = 3 * 1024 * 1024;

const MAX_EDGE = 2400;
/** Never degrade past this, even chasing the target — it stops being readable. */
const MIN_EDGE = 1200;
const QUALITIES = [0.82, 0.7, 0.6];

export interface ShrinkResult {
  file: File;
  /** True when the returned file is a re-encode rather than the original. */
  changed: boolean;
  originalBytes: number;
}

/**
 * Returns a smaller version of an image file, or the original unchanged.
 *
 * Never throws: a format the browser cannot decode (HEIC outside Safari, say)
 * or a missing canvas falls back to the original file, and the size check on
 * either side then reports the problem in plain language. Losing the upload to
 * an exception in the optimisation step would be the worse outcome.
 */
export async function shrinkImage(
  file: File,
  targetBytes = UPLOAD_TARGET_BYTES,
): Promise<ShrinkResult> {
  const unchanged: ShrinkResult = { file, changed: false, originalBytes: file.size };

  // PDFs are already a compressed document format and can't be re-encoded here.
  if (!file.type.startsWith("image/")) return unchanged;
  // Small enough already — re-encoding would only lose quality for nothing.
  if (file.size <= targetBytes && !oversizedForSure(file)) return unchanged;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable in this browser. Hand back the original and let the caller
    // report the size honestly rather than failing here.
    return unchanged;
  }

  try {
    for (const maxEdge of [MAX_EDGE, 1800, MIN_EDGE]) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return unchanged;

      // White underneath, so a transparent PNG scan doesn't flatten to black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, quality);
        if (!blob) return unchanged;
        if (blob.size <= targetBytes) {
          // Only accept it if it actually helped.
          if (blob.size >= file.size) return unchanged;
          return { file: asJpeg(blob, file.name), changed: true, originalBytes: file.size };
        }
      }
    }

    // Everything tried and still over target — hand back the smallest attempt
    // anyway, since it is strictly better than the original.
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, MIN_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return unchanged;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await toBlob(canvas, 0.5);
    if (!blob || blob.size >= file.size) return unchanged;
    return { file: asJpeg(blob, file.name), changed: true, originalBytes: file.size };
  } finally {
    bitmap.close?.();
  }
}

/**
 * HEIC and TIFF are always worth re-encoding even when small: the server's
 * whitelist accepts them, but a browser asked to display one later may not.
 */
function oversizedForSure(file: File): boolean {
  return /heic|heif|tiff?/i.test(file.type);
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** The re-encode is a JPEG, so the filename has to say so — the server checks it. */
function asJpeg(blob: Blob, originalName: string): File {
  const base = originalName.replace(/\.[^.]+$/, "") || "upload";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

/** "9.4 MB" — for telling the operator what happened. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
