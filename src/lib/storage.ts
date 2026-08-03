import fs from "node:fs/promises";
import path from "node:path";
import { backend } from "./db";

/**
 * File storage for everything a record can carry: a voucher's generated PDF and
 * signed scan, a purchase order's PDF and vendor invoice. Local mode writes to
 * ./.data/files; Supabase mode uses a Storage bucket. Callers only deal in
 * opaque keys like "green-rock/GR-202607-014/voucher.pdf".
 *
 * Files are always served back through /api/file/<key> rather than a public URL,
 * so they stay behind the password gate in both modes.
 */

const FILES_DIR = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "files");
const BUCKET = process.env.SUPABASE_BUCKET ?? "vouchers";

/** Rejects keys that could escape the storage root. */
function assertSafeKey(key: string) {
  if (!key || key.includes("..") || key.startsWith("/") || /\\/.test(key)) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

export async function putFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  assertSafeKey(key);
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);

  if (backend === "supabase") {
    const { supabase } = await import("./db/supabase");
    const { error } = await supabase()
      .storage.from(BUCKET)
      .upload(key, bytes, { contentType, upsert: true });
    if (error) throw error;
    return;
  }

  const target = path.join(FILES_DIR, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}

export async function getFile(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  assertSafeKey(key);

  if (backend === "supabase") {
    const { supabase } = await import("./db/supabase");
    const { data, error } = await supabase().storage.from(BUCKET).download(key);
    if (error || !data) return null;
    return {
      bytes: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || guessContentType(key),
    };
  }

  try {
    const bytes = await fs.readFile(path.join(FILES_DIR, key));
    return { bytes, contentType: guessContentType(key) };
  } catch {
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  assertSafeKey(key);

  if (backend === "supabase") {
    const { supabase } = await import("./db/supabase");
    await supabase().storage.from(BUCKET).remove([key]);
    return;
  }

  await fs.rm(path.join(FILES_DIR, key), { force: true });
}

function guessContentType(key: string): string {
  const ext = path.extname(key).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  return map[ext] ?? "application/octet-stream";
}

export const storageKeys = {
  pdf: (company: string, voucherNo: string) => `${company}/${voucherNo}/voucher.pdf`,
  scan: (company: string, voucherNo: string, ext: string) =>
    `${company}/${voucherNo}/signed${ext.startsWith(".") ? ext : `.${ext}`}`,
  /**
   * A purchase order's PDF is overwritten in place on every re-render, because
   * an issued PO stays editable — the file must always be the current document,
   * not one of a pile of past attempts.
   */
  poPdf: (company: string, poNo: string) => `${company}/${poNo}/purchase-order.pdf`,
  poInvoice: (company: string, poNo: string, ext: string) =>
    `${company}/${poNo}/invoice${ext.startsWith(".") ? ext : `.${ext}`}`,
};

/**
 * URL the browser uses to fetch a stored file.
 *
 * `v` matters for purchase orders. A voucher's PDF is written once and never
 * changes, so /api/file can serve it as immutable — but a PO stays editable and
 * its PDF is overwritten in place at the same key. Passing the render timestamp
 * changes the URL whenever the file changes, which is what makes the immutable
 * header safe for both.
 */
export function fileUrl(
  key: string,
  options: { v?: string | null; download?: boolean } = {},
): string {
  const path = `/api/file/${key.split("/").map(encodeURIComponent).join("/")}`;
  const params = new URLSearchParams();
  if (options.v) params.set("v", options.v);
  if (options.download) params.set("download", "1");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
