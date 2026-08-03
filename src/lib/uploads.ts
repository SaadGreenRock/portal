import path from "node:path";
import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS } from "./upload-limits";

/**
 * Server-side validation shared by every file the operator uploads — a
 * voucher's signed scan, a purchase order's invoice.
 *
 * One whitelist and one size limit, because they are answering the same
 * question in both cases: "is this a photograph or a scan of a piece of paper?"
 * The browser checks the same limits first (see UploadFile), so reaching a
 * failure here means someone bypassed the form.
 */

export { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS };

const asMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

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
    throw new Error(
      `That file is ${asMb(file.size)} and the limit is ${asMb(MAX_UPLOAD_BYTES)}. ` +
        "Photograph the document instead of scanning it at full resolution.",
    );
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type "${ext || "unknown"}". Upload a PDF or an image.`);
  }

  return { file, ext };
}
