import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { putFile, storageKeys } from "@/lib/storage";

/**
 * A serverless request body is capped around 4.5 MB, so anything larger never
 * arrives. The browser lowers its raster resolution on long documents to stay
 * underneath it — see client-pdf.ts.
 */
const MAX_PDF_BYTES = 4 * 1024 * 1024;

/**
 * Receives the PDF the operator's browser just rendered and files it against the
 * request, overwriting any earlier render — a request stays editable, so the
 * stored file must always be the current document.
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
  const rfq = await db.getRfq(id);
  if (!rfq) return new NextResponse("Not found", { status: 404 });

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Unexpected PDF size." }, { status: 400 });
  }
  // Cheap sanity check that this really is a PDF and not a stray upload.
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "That is not a PDF." }, { status: 400 });
  }

  const key = storageKeys.rfqPdf(rfq.company, rfq.rfqNo);
  await putFile(key, bytes, "application/pdf");
  await db.attachRfqPdf(rfq.id, key);

  revalidatePath(`/${rfq.company}/rfq`);
  revalidatePath(`/${rfq.company}/rfq/history`);
  revalidatePath(`/${rfq.company}/rfq/${rfq.id}`);

  return NextResponse.json({ ok: true, key, bytes: bytes.length });
}
