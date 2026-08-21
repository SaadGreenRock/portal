"use client";

import { useRef, useState } from "react";
import { formatBytes, shrinkImage } from "@/lib/shrink-image";
import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS } from "@/lib/upload-limits";

/**
 * A file picker inside a larger form.
 *
 * Named for the settle form it was written for, and now also the picker for an
 * asset's photographs and an employee's CNIC and passport scans — the three do
 * the same job and share the one thing that is easy to get wrong, so `name` and
 * `accept` are parameters rather than three copies of this file.
 *
 * Not `UploadFile`, which is a whole upload on its own — it builds its own
 * FormData and posts the moment a file is chosen. Here the file is one field of
 * a larger form that also carries the payment date, the reference and the ticked
 * entries, and all of it has to arrive in one submission: the proof and the
 * payment it proves are the same act.
 *
 * So this stays a plain `<input type="file">` that the surrounding form posts
 * normally, and the JavaScript only improves it. What it improves is the thing
 * that otherwise breaks the common case: a phone photograph is several megabytes
 * and the request body limit is well under that, so the file is re-encoded in
 * place before the form is submitted. With JavaScript off the field still works
 * and still uploads — a large photo is simply refused, with a message, rather
 * than silently failing.
 *
 * Swapping the shrunk file back into the input is what keeps the form plain: the
 * browser posts whatever `input.files` holds at submit time, so nothing here has
 * to intercept the submission.
 */
export default function ReceiptField({
  id,
  name = "receipt",
  label = "Receipt or invoice",
  hint = "Optional. Photo or PDF — photos are shrunk automatically.",
  accept = "image/*,application/pdf,.heic,.heif,.tif,.tiff",
  required = false,
  optionalLabel = true,
}: {
  id: string;
  /** The form field. Defaults to the food log's, which was here first. */
  name?: string;
  label?: string;
  hint?: string;
  accept?: string;
  required?: boolean;
  /** Off where the file is the point of the form rather than an extra. */
  optionalLabel?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clear = () => {
    if (input.current) input.current.value = "";
  };

  async function chosen(file: File) {
    setError(null);
    setNote(null);

    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!UPLOAD_EXTENSIONS.has(ext)) {
      clear();
      setError(`Unsupported file type "${ext || "unknown"}". Choose a PDF or an image.`);
      return;
    }

    setBusy(true);
    let final = file;
    try {
      const shrunk = await shrinkImage(file);
      final = shrunk.file;
      if (shrunk.changed) {
        setNote(`${file.name} — shrunk from ${formatBytes(shrunk.originalBytes)} to ${formatBytes(final.size)}.`);
      } else {
        setNote(`${file.name} — ${formatBytes(final.size)}.`);
      }
    } catch {
      // Shrinking is best-effort; carry on with the original and let the size
      // check below report the problem in plain language.
      setNote(`${file.name} — ${formatBytes(final.size)}.`);
    }
    setBusy(false);

    // Checked here as well as on the server so an oversized PDF — which cannot
    // be shrunk — is refused before it spends a minute uploading over 4G.
    if (final.size > MAX_UPLOAD_BYTES) {
      clear();
      setNote(null);
      setError(
        final.type.startsWith("image/")
          ? `Still ${formatBytes(final.size)} after shrinking, and the limit is ${formatBytes(
              MAX_UPLOAD_BYTES,
            )}. Try photographing it rather than scanning at full resolution.`
          : `That PDF is ${formatBytes(final.size)}, and the limit is ${formatBytes(
              MAX_UPLOAD_BYTES,
            )}. Rescan it at a lower resolution, or photograph it instead.`,
      );
      return;
    }

    // Put the re-encoded file back where the form will find it. Untouched files
    // are left alone rather than round-tripped through a DataTransfer.
    if (final !== file && input.current) {
      const bag = new DataTransfer();
      bag.items.add(final);
      input.current.files = bag.files;
    }
  }

  return (
    <div className="min-w-[12rem] flex-1">
      <label className="label mb-1.5" htmlFor={id}>
        {label}
        {optionalLabel ? <span className="font-normal normal-case"> — optional</span> : null}
      </label>
      <input
        ref={input}
        id={id}
        name={name}
        type="file"
        required={required}
        // Phones offer "Take Photo" for image/*; a desktop scanner makes a PDF.
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void chosen(file);
        }}
        className="block w-full text-[13px] text-ink-soft file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-ink-line file:bg-card file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-ink hover:file:bg-wash"
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-[12.5px] font-medium leading-snug text-red-700">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink-soft">
          {busy ? "Preparing…" : (note ?? hint)}
        </p>
      )}
    </div>
  );
}
