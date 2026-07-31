/**
 * Voucher page geometry, in its own module because both server and browser code
 * need it and the template module pulls in node:fs.
 *
 * US Letter, matching the approved DOCX page setup.
 */
export const SHEET = {
  /** CSS pixels at the 96dpi reference resolution. */
  widthPx: 8.5 * 96,
  heightPx: 11 * 96,
  /** PDF user-space units (1/72in). */
  widthPt: 8.5 * 72,
  heightPt: 11 * 72,
} as const;
