import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { putFile, storageKeys } from "@/lib/storage";

/**
 * A serverless request body is capped around 4.5 MB, so anything above this
 * never arrives here in the first place — the number exists to reject a stray
 * upload, and to be honest about the real ceiling rather than inventing a
 * generous one the platform would never honour. The browser lowers its raster
 * resolution on long orders to stay underneath it (see client-pdf.ts).
 */
const MAX_PDF_BYTES = 4 * 1024 * 1024;

/**
 * Receives the PDF the operator's browser just rendered and files it against
 * the purchase order, overwriting any earlier render — an issued PO stays
 * editable, so the stored file must always be the current document.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const db = await store();
  const po = await db.getPo(id);
  if (!po) return new NextResponse("Not found", { status: 404 });

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Unexpected PDF size." }, { status: 400 });
  }
  // Cheap sanity check that this really is a PDF and not a stray upload.
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "That is not a PDF." }, { status: 400 });
  }

  const key = storageKeys.poPdf(po.company, po.poNo);
  await putFile(key, bytes, "application/pdf");
  await db.attachPoPdf(po.id, key);

  revalidatePath(`/${po.company}/po`);
  revalidatePath(`/${po.company}/po/history`);
  revalidatePath(`/${po.company}/po/${po.id}`);

  return NextResponse.json({ ok: true, key, bytes: bytes.length });
}
