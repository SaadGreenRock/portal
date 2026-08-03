import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { putFile, storageKeys } from "@/lib/storage";

/** A Letter page at 288dpi as JPEG lands well under this. */
const MAX_PDF_BYTES = 12 * 1024 * 1024;

/**
 * Receives the PDF the operator's browser just rendered and files it against
 * the voucher. This is the step that moves a voucher to "PDF generated".
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
  const voucher = await db.getVoucher(id);
  if (!voucher) return new NextResponse("Not found", { status: 404 });

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Unexpected PDF size." }, { status: 400 });
  }
  // Cheap sanity check that this really is a PDF and not a stray upload.
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "That is not a PDF." }, { status: 400 });
  }

  const key = storageKeys.pdf(voucher.company, voucher.voucherNo);
  await putFile(key, bytes, "application/pdf");
  await db.attachPdf(voucher.id, key);

  revalidatePath(`/${voucher.company}/vouchers/pending`);
  revalidatePath(`/${voucher.company}/vouchers/history`);
  revalidatePath(`/${voucher.company}/vouchers/${voucher.id}`);

  return NextResponse.json({ ok: true, key, bytes: bytes.length });
}
