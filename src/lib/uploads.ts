import path from "node:path";

/**
 * Validation shared by every file the operator uploads — a voucher's signed
 * scan, a purchase order's invoice.
 *
 * One whitelist and one size limit, because they are answering the same
 * question in both cases: "is this a photograph or a scan of a piece of paper?"
 */

/** Whatever a phone camera or a desk scanner produces. */
export const UPLOAD_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".tif", ".tiff",
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Pulls the file out of a form payload and checks it, or throws a message fit
 * to show the operator directly.
 */
export function readUpload(form: FormData, field = "file"): { file: File; ext: string } {
  const file = form.get(field);

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("That file is larger than 25 MB. Try a lower-resolution scan.");
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type "${ext || "unknown"}". Upload a PDF or an image.`);
  }

  return { file, ext };
}
