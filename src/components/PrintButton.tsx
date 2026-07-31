"use client";

import { useRef, useState } from "react";

/**
 * Prints the generated PDF.
 *
 * The file is same-origin, so it can be loaded into a hidden iframe and printed
 * without ever leaving the page — one click from "generated" to a sheet in the
 * printer. If the browser refuses (some mobile browsers won't print an iframed
 * PDF), it falls back to opening the file in a new tab.
 */
export default function PrintButton({
  href,
  className = "btn btn-primary",
  children = "Print",
}: {
  href: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(false);

  function print() {
    setLoading(true);

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = href;

    // Give the PDF plugin a moment to lay out before asking it to print.
    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(href, "_blank", "noopener");
        } finally {
          setLoading(false);
        }
      }, 400);
    };

    iframe.onerror = () => {
      setLoading(false);
      window.open(href, "_blank", "noopener");
    };

    // Replace any frame from a previous press so they don't accumulate.
    frame.current?.remove();
    frame.current = iframe;
    document.body.appendChild(iframe);
  }

  return (
    <button type="button" onClick={print} disabled={loading} className={className}>
      {loading ? "Preparing…" : children}
    </button>
  );
}
