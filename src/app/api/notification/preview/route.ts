import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { readNotificationFields } from "@/lib/notifications/parse";
import { renderNotificationHtml } from "@/lib/notifications/template";
import type { Notification } from "@/lib/notifications/types";

/**
 * Live preview for the Compose screen.
 *
 * Returns the same HTML the PNG/PDF are rendered from, so what the operator
 * sees while typing is exactly what will be produced. No record exists yet,
 * so the number shown is the placeholder the real sequence will fill in. A
 * field past its length limit is reported as a 422 rather than rendered, so
 * the composer sees the same rejection the save action would give.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { company?: string; fields?: unknown };
  const company = getCompany(body.company ?? "");
  if (!company) {
    return new NextResponse("Bad request", { status: 400 });
  }

  let fields;
  try {
    fields = readNotificationFields(body.fields);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That cannot be previewed." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const draft: Notification = {
    id: "preview",
    notifNo: `${company.prefix}-NOTE-••••••-•••`,
    company: company.slug,
    seq: 0,
    period: "",
    ...fields,
    createdAt: new Date().toISOString(),
    pngKey: null,
    pngAt: null,
    pdfKey: null,
    pdfAt: null,
    deletedAt: null,
  };

  return new NextResponse(renderNotificationHtml(draft, company, { watermark: true, assets: "url" }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
