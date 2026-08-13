import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { store } from "@/lib/db";
import { putFile, storageKeys } from "@/lib/storage";

/** A small single card at 288dpi lands well under this. */
const MAX_PNG_BYTES = 4 * 1024 * 1024;

/** The full 8-byte PNG signature, not just the 4-byte \x89PNG prefix. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Receives the PNG the operator's browser just rendered and files it against
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

  if (bytes.length === 0 || bytes.length > MAX_PNG_BYTES) {
    return NextResponse.json({ error: "Unexpected image size." }, { status: 400 });
  }
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    return NextResponse.json({ error: "That is not a PNG." }, { status: 400 });
  }

  const key = storageKeys.notificationPng(n.company, n.notifNo);
  await putFile(key, bytes, "image/png");
  await db.attachNotificationImage(n.id, key);

  revalidatePath(`/${n.company}/notifications/history`);
  revalidatePath(`/${n.company}/notifications/${n.id}`);

  return NextResponse.json({ ok: true, key, bytes: bytes.length });
}
