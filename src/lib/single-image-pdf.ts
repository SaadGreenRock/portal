/**
 * Writes a one-page PDF containing a single full-bleed JPEG.
 *
 * That is the entire requirement here, and it needs no library: a JPEG is
 * already DCT-compressed, so it can be dropped into the PDF as a DCTDecode
 * stream verbatim — no zlib, no image re-encoding, nothing to keep updated.
 *
 * Runs in the browser (no Node APIs), because the operator's browser is what
 * produces the page image.
 */

const enc = new TextEncoder();

/** Assembles byte chunks while tracking each object's offset for the xref. */
class PdfWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(part: string | Uint8Array): void {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** Current byte offset — this is what the xref table records. */
  get offset(): number {
    return this.length;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

export interface SingleImagePdfOptions {
  jpeg: Uint8Array;
  /** Pixel dimensions of the JPEG. */
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in PDF points (1/72in). The image is stretched to fill it. */
  pageWidthPt: number;
  pageHeightPt: number;
  title?: string;
}

export function buildSingleImagePdf({
  jpeg,
  pixelWidth,
  pixelHeight,
  pageWidthPt,
  pageHeightPt,
  title,
}: SingleImagePdfOptions): Uint8Array {
  const w = new PdfWriter();
  // Offsets are 1-indexed by object number; index 0 is the free-list head.
  const offsets: number[] = [0];
  const obj = (n: number, body: string) => {
    offsets[n] = w.offset;
    w.push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  // The %âãÏÓ comment marks the file as containing binary data, so tools don't
  // mangle it as text.
  w.push("%PDF-1.4\n");
  w.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    "<< /Type /Page /Parent 2 0 R " +
      `/MediaBox [0 0 ${round(pageWidthPt)} ${round(pageHeightPt)}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );

  // The image itself: raw JPEG bytes between stream/endstream.
  offsets[4] = w.offset;
  w.push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} ` +
      `/Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  w.push(jpeg);
  w.push("\nendstream\nendobj\n");

  // Content stream: scale the unit image up to the page box and draw it.
  // PDF's origin is bottom-left, which the cm matrix already accounts for.
  const content = `q\n${round(pageWidthPt)} 0 0 ${round(pageHeightPt)} 0 0 cm\n/Im0 Do\nQ\n`;
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);

  obj(
    6,
    `<< /Producer (Payment Voucher Portal)${
      title ? ` /Title (${pdfText(title)})` : ""
    } >>`,
  );

  // xref: one 20-byte entry per object, in object-number order.
  const startxref = w.offset;
  const count = offsets.length; // objects 1..6 plus the free entry
  w.push(`xref\n0 ${count}\n`);
  w.push("0000000000 65535 f \n");
  for (let n = 1; n < count; n++) {
    w.push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  w.push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\n` +
      `startxref\n${startxref}\n%%EOF\n`,
  );

  return w.toBytes();
}

/** PDF numbers must not be in exponential notation. */
const round = (n: number) => Number(n.toFixed(3));

/** Escapes the delimiters that would otherwise terminate a PDF literal string. */
const pdfText = (s: string) => s.replace(/([\\()])/g, "\\$1");
