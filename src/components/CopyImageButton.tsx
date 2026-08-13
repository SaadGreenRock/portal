"use client";

import { useState } from "react";

/**
 * Copies the notification's PNG to the clipboard, so it can be pasted
 * straight into WhatsApp Web or an email draft without a manual download.
 *
 * "Download image" stays alongside this as the fallback: mobile clipboard
 * support for images is less consistent than desktop's.
 */
export default function CopyImageButton({ pngUrl }: { pngUrl: string }) {
  const [state, setState] = useState<"idle" | "copying" | "done" | "error">("idle");

  async function copy() {
    setState("copying");
    try {
      // The promise form — not fetch-then-write with an already-resolved blob —
      // matters for Safari: it requires the clipboard write to start within the
      // click's own call stack, and accepts a pending promise for the payload
      // precisely so an async fetch can happen in between.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": fetch(pngUrl).then((r) => r.blob()) }),
      ]);
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  }

  return (
    <button type="button" onClick={copy} disabled={state === "copying"} className="btn btn-ghost">
      {state === "done" ? "Copied!" : state === "error" ? "Copy failed" : "Copy image"}
    </button>
  );
}
