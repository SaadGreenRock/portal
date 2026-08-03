"use client";

import { useRef, useState, useTransition } from "react";

/**
 * Attaches a scanned document — a voucher's signed copy, a purchase order's
 * invoice.
 *
 * This step usually happens on a phone standing next to a scanner, so the
 * control is a single large tap target that offers the camera directly, and it
 * submits the moment a file is chosen — no separate "upload" press.
 */
export default function UploadFile({
  action,
  label = "Upload",
  hint = "Photo or PDF, up to 25 MB.",
  compact = false,
}: {
  action: (form: FormData) => Promise<void>;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function submit(file: File) {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      try {
        await action(form);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed. Try again.");
        if (input.current) input.current.value = "";
      }
    });
  }

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
          if (file) submit(file);
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        className={`btn btn-primary ${compact ? "px-3 py-2 text-[13px]" : "w-full py-3"}`}
      >
        {pending ? "Uploading…" : label}
      </button>
      {error ? (
        <p role="alert" className="text-[12.5px] font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {!compact && !error ? (
        <p className="text-center text-[12px] text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}
