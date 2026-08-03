/**
 * Writes a PDF whose pages are each one full-bleed JPEG.
 *
 * That is the entire requirement here, and it needs no library: a JPEG is
 * already DCT-compressed, so it can be dropped into the PDF as a DCTDecode
 * stream verbatim — no zlib, no image re-encoding, nothing to keep updated.
 *
 * Runs in the browser (no Node APIs), because the operator's browser is what
 * produces the page images.
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

export interface PdfImagePage {
  jpeg: Uint8Array;
  /** Pixel dimensions of the JPEG. */
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in PDF points (1/72in). The image is stretched to fill it. */
  pageWidthPt: number;
  pageHeightPt: number;
}

export interface ImagePdfOptions {
  pages: PdfImagePage[];
  title?: string;
  producer?: string;
}

/**
 * Object layout, for anyone tracing the xref by hand:
 *
 *   1            catalog
 *   2            page tree
 *   3 + 3n       page n
 *   4 + 3n       page n's image
 *   5 + 3n       page n's content stream
 *   3 + 3N       document info
 */
export function buildImagePdf({ pages, title, producer }: ImagePdfOptions): Uint8Array {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");

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

  const pageObj = (i: number) => 3 + i * 3;
  const imageObj = (i: number) => 4 + i * 3;
  const contentObj = (i: number) => 5 + i * 3;
  const infoObj = 3 + pages.length * 3;

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(
    2,
    `<< /Type /Pages /Kids [${pages
      .map((_, i) => `${pageObj(i)} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
  );

  pages.forEach((page, i) => {
    obj(
      pageObj(i),
      "<< /Type /Page /Parent 2 0 R " +
        `/MediaBox [0 0 ${round(page.pageWidthPt)} ${round(page.pageHeightPt)}] ` +
        `/Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> >> ` +
        `/Contents ${contentObj(i)} 0 R >>`,
    );

    // The image itself: raw JPEG bytes between stream/endstream.
    offsets[imageObj(i)] = w.offset;
    w.push(
      `${imageObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} ` +
        `/Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    w.push(page.jpeg);
    w.push("\nendstream\nendobj\n");

    // Content stream: scale the unit image up to the page box and draw it.
    // PDF's origin is bottom-left, which the cm matrix already accounts for.
    const content = `q\n${round(page.pageWidthPt)} 0 0 ${round(
      page.pageHeightPt,
    )} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(contentObj(i), `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
  });

  obj(
    infoObj,
    `<< /Producer (${pdfText(producer ?? "Green Rock Portal")})${
      title ? ` /Title (${pdfText(title)})` : ""
    } >>`,
  );

  // xref: one 20-byte entry per object, in object-number order.
  const startxref = w.offset;
  const count = offsets.length;
  w.push(`xref\n0 ${count}\n`);
  w.push("0000000000 65535 f \n");
  for (let n = 1; n < count; n++) {
    w.push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  w.push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
      `startxref\n${startxref}\n%%EOF\n`,
  );

  return w.toBytes();
}

/** PDF numbers must not be in exponential notation. */
const round = (n: number) => Number(n.toFixed(3));

/** Escapes the delimiters that would otherwise terminate a PDF literal string. */
const pdfText = (s: string) => s.replace(/([\\()])/g, "\\$1");
