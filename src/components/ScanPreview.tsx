import { fileUrl } from "@/lib/storage";

/**
 * Shows an uploaded scan on the record it belongs to — a voucher's signed copy,
 * a purchase order's invoice.
 *
 * The point is to see the document without leaving the page. Opening it in a new
 * tab is still offered, because that is what you want when you need to zoom into
 * a serial number or hand the file to someone; but needing a new tab just to
 * check that the right invoice is attached made the record page useless for the
 * one thing it is for.
 *
 * Three kinds of file arrive here, and only two can be shown:
 *
 *   image  — an <img>, which is every phone photo and every ordinary scan.
 *   pdf    — an <object>, which every desktop browser renders inline. iOS Safari
 *            is the known exception: it draws an empty box rather than falling
 *            back, which is why Open sits outside the frame and always visible
 *            rather than inside it as a fallback.
 *   other  — .heic and .tiff are accepted on upload because that is what some
 *            cameras and scanners produce, and no browser will display either.
 *            Saying so plainly beats an <img> tag showing a broken-image icon,
 *            which is what used to happen.
 */

/** Extensions a browser will render in an <img>. */
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];

type Kind = "image" | "pdf" | "other";

function kindOf(key: string): Kind {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? "image" : "other";
}

export default function ScanPreview({
  fileKey,
  version,
  alt,
  openLabel,
  maxHeight = "700px",
}: {
  fileKey: string;
  /** Cache-buster, so replacing a file doesn't show the old one. */
  version?: string | null;
  /** Describes the document, for screen readers and broken-image text. */
  alt: string;
  /** "Open scan", "Open invoice" — named so the button says what it opens. */
  openLabel: string;
  /** Caps the preview so a long document doesn't push the page furniture away. */
  maxHeight?: string;
}) {
  const src = fileUrl(fileKey, { v: version });
  const downloadSrc = fileUrl(fileKey, { v: version, download: true });
  const kind = kindOf(fileKey);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <a href={src} target="_blank" rel="noreferrer" className="btn btn-ghost px-3 py-2 text-[13px]">
        {openLabel}
      </a>
      <a href={downloadSrc} download className="btn btn-ghost px-3 py-2 text-[13px]">
        Download
      </a>
    </div>
  );

  if (kind === "other") {
    const ext = fileKey.slice(fileKey.lastIndexOf(".")).toLowerCase();
    return (
      <div className="space-y-2.5">
        <div className="card grid place-items-center px-6 py-14 text-center">
          <div>
            <p className="text-[15px] font-medium">On file, but not previewable</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">
              No browser can display a <span className="mono">{ext}</span> file. Open or download it
              to view it.
            </p>
            <div className="mt-5 flex justify-center">{actions}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {kind === "pdf" ? (
        <object
          data={src}
          type="application/pdf"
          aria-label={alt}
          // White in both themes, because what fills it is a scanned page. The
          // border stays the portal's, which is what frames a white document
          // against a dark screen.
          className="w-full rounded-lg border border-ink-line bg-white"
          style={{ height: maxHeight }}
        >
          {/* Shown by browsers that decline to render a PDF inline.

              on-paper because it is standing on that white: without it the type
              here keeps the interface's pale greys, which on a white sheet is
              nothing at all. */}
          <div className="on-paper grid h-full place-items-center px-6 py-14 text-center text-ink">
            <div>
              <p className="text-[15px] font-medium">Preview unavailable here</p>
              <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">
                This browser will not display a PDF in the page. Open it in a new tab instead.
              </p>
              <div className="mt-5 flex justify-center">{actions}</div>
            </div>
          </div>
        </object>
      ) : (
        // bg-white in both themes: a scan photographed against a white wall and
        // a scan with a transparent margin both want paper behind them, not the
        // interface.
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          className="w-full rounded-lg border border-ink-line bg-white object-contain"
          style={{ maxHeight }}
        />
      )}
      {actions}
    </div>
  );
}
