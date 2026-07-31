import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getFile } from "@/lib/storage";

/**
 * Serves generated PDFs and uploaded scans.
 *
 * Files always come through here rather than from a public bucket URL, so that
 * in both local and Supabase mode they stay behind the same password gate.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");

  let file: Awaited<ReturnType<typeof getFile>>;
  try {
    file = await getFile(key);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!file) return new NextResponse("Not found", { status: 404 });

  const download = new URL(request.url).searchParams.has("download");
  const filename = key.split("/").pop() ?? "file";

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      // Voucher files never change once written, but they are private.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
