/**
 * Upload limits, in their own module because the browser needs them too and
 * uploads.ts pulls in node:path.
 *
 * The ceiling is not a preference — it is the platform. A Vercel function will
 * not accept a request body over 4.5 MB, and the framework's own server-action
 * limit sits under that. Anything larger has to be made smaller before it is
 * sent, which is what shrink-image.ts does; this is the backstop for the cases
 * that can't be (a large PDF, mainly).
 */

/** Refused with an explanation rather than a platform error page. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Whatever a phone camera or a desk scanner produces. */
export const UPLOAD_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".tif", ".tiff",
]);
