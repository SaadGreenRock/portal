"use client";

import { useRef, useState, useTransition } from "react";
import { formatBytes, shrinkImage } from "@/lib/shrink-image";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

/**
 * Attaches a scanned document — a voucher's signed copy, a purchase order's
 * invoice.
 *
 * This step usually happens on a phone standing next to a scanner, so the
 * control is a single large tap target that offers the camera directly, and it
 * submits the moment a file is chosen — no separate "upload" press.
 *
 * Photographs are re-encoded before they are sent. That is not a nicety: a
 * phone camera produces several megabytes per shot and the request body limit
 * is well under that, so without this step the common case simply fails.
 */
export default function UploadFile({
  action,
  label = "Upload",
  hint = "Photo or PDF. Photos are shrunk automatically.",
  compact = false,
}: {
  action: (form: FormData) => Promise<void>;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /** Lets the same file be chosen again after a failure. */
  const clearChosenFile = () => {
    if (input.current) input.current.value = "";
  };

  async function submit(chosen: File) {
    setError(null);
    setNote(null);
    setPreparing(true);

    let file = chosen;
    try {
      const shrunk = await shrinkImage(chosen);
      file = shrunk.file;
      if (shrunk.changed) {
        setNote(`Shrunk from ${formatBytes(shrunk.originalBytes)} to ${formatBytes(file.size)}.`);
      }
    } catch {
      // Shrinking is best-effort; carry on with the original and let the size
      // check below report the problem in plain language.
    }
    setPreparing(false);

    // Checked here as well as on the server so an oversized PDF — which cannot
    // be shrunk — is refused before it spends a minute uploading over 4G.
    if (file.size > MAX_UPLOAD_BYTES) {
      clearChosenFile();
      setNote(null);
      setError(
        file.type.startsWith("image/")
          ? `Still ${formatBytes(file.size)} after shrinking, and the limit is ${formatBytes(
              MAX_UPLOAD_BYTES,
            )}. Try photographing it rather than scanning at full resolution.`
          : `That PDF is ${formatBytes(file.size)}, and the limit is ${formatBytes(
              MAX_UPLOAD_BYTES,
            )}. Rescan it at a lower resolution, or photograph it instead.`,
      );
      return;
    }

    const form = new FormData();
    form.set("file", file);

    startTransition(async () => {
      try {
        await action(form);
      } catch (e) {
        clearChosenFile();
        setNote(null);
        setError(friendlyMessage(e));
      }
    });
  }

  const busy = pending || preparing;

  return (
    <div className={compact ? "" : "space-y-2"}>
      <input
        ref={input}
        type="file"
        // Phones offer "Take Photo" for image/*; a desktop scanner usually makes a PDF.
        accept="image/*,application/pdf,.heic,.heif,.tif,.tiff"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void submit(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`btn btn-primary ${compact ? "px-3 py-2 text-[13px]" : "w-full py-3"}`}
      >
        {preparing ? "Preparing…" : pending ? "Uploading…" : label}
      </button>

      {error ? (
        <p role="alert" className="text-[12.5px] font-medium leading-snug text-red-700">
          {error}
        </p>
      ) : null}
      {!error && note ? <p className="text-center text-[12px] text-ink-soft">{note}</p> : null}
      {!compact && !error && !note ? (
        <p className="text-center text-[12px] text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Turns a framework or platform failure into something an operator can act on.
 *
 * A body-size rejection surfaces as a raw Next.js string and a Vercel refusal
 * as a bare network error; neither means anything to someone holding a phone.
 */
function friendlyMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");

  if (/body exceeded|request entity too large|payload too large|\b413\b/i.test(raw)) {
    return "That file was too large for the server to accept. Photograph the document rather than scanning it at full resolution.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "The upload did not reach the server. Check your connection and try again.";
  }
  // Our own server-side validation messages are already written for a person.
  return raw || "Upload failed. Try again.";
}
