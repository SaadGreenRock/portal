import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { requireCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { renderNotificationSvg } from "@/lib/notifications/template";

/**
 * Hands the browser the notification card as a self-contained SVG, which it
 * rasterises into the PNG and PDF. Generated from the stored field values, so
 * it can be rebuilt at any time and always matches the record.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const n = await (await store()).getNotification(id);
  if (!n) return new NextResponse("Not found", { status: 404 });

  const svg = renderNotificationSvg(n, requireCompany(n.company));

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // A notification is composed once and never edited, so this can be
      // cached far more aggressively than the voucher's own sheet route.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
