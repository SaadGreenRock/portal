import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { putFile, storageKeys } from "@/lib/storage";

/** A small single card at 288dpi lands well under this. */
const MAX_PDF_BYTES = 4 * 1024 * 1024;

/**
 * Receives the PDF the operator's browser just rendered and files it against
 * the notification.
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
  const n = await db.getNotification(id);
  if (!n) return new NextResponse("Not found", { status: 404 });

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "Unexpected PDF size." }, { status: 400 });
  }
  // Cheap sanity check that this really is a PDF and not a stray upload.
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "That is not a PDF." }, { status: 400 });
  }

  const key = storageKeys.notificationPdf(n.company, n.notifNo);
  await putFile(key, bytes, "application/pdf");
  await db.attachNotificationPdf(n.id, key);

  revalidatePath(`/${n.company}/notifications/history`);
  revalidatePath(`/${n.company}/notifications/${n.id}`);

  return NextResponse.json({ ok: true, key, bytes: bytes.length });
}
