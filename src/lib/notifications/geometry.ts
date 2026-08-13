/**
 * Notification card geometry, in its own module for the same reason sheet.ts
 * is separate from template.ts: the client rasterizer needs this without
 * pulling in node:fs.
 *
 * A 4:5 portrait card — WhatsApp/Instagram-friendly — not the voucher's Letter
 * page. The PDF export uses the same box: it is this card as one page, not a
 * Letter-sized memo, since nothing here is meant to be filed or printed on a
 * standard sheet.
 */
export const CARD = {
  /** CSS pixels at the 96dpi reference resolution, same convention as SHEET. */
  widthPx: 360,
  heightPx: 450,
  /** PDF user-space units (1/72in). */
  widthPt: 360 * (72 / 96),
  heightPt: 450 * (72 / 96),
} as const;
