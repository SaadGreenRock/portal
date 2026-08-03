import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { periodOf } from "@/lib/db/shared";
import { readRfqDoc } from "@/lib/rfq/parse";
import { renderRfqPages, rfqWatermarkFor } from "@/lib/rfq/template";
import type { RfqStatus } from "@/lib/rfq/types";

/**
 * Live preview for the request editor.
 *
 * Returns the same HTML the PDF is rendered from — one entry per page — so what
 * the operator sees while typing is exactly what the vendor will receive,
 * including where the page breaks fall.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    company?: string;
    doc?: unknown;
    rfqNo?: string;
    status?: RfqStatus;
  };

  const company = getCompany(body.company ?? "");
  if (!company || !body.doc) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const status: RfqStatus = body.status ?? "draft";
  // An unsaved request has no number yet; show the shape the sequence will fill.
  const rfqNo = body.rfqNo || `${company.prefix}-RFQ-${periodOf()}-•••`;

  // Called on every keystroke, so a value the parser refuses has to come back as
  // a message the operator can read now, not as a dead preview and a surprise
  // on save.
  let doc;
  try {
    doc = readRfqDoc(body.doc);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That request cannot be previewed." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const pages = renderRfqPages({ rfqNo, status, doc }, company, {
    assets: "url",
    watermark: body.rfqNo ? rfqWatermarkFor(status) : "PREVIEW",
  });

  return NextResponse.json({ pages }, { headers: { "Cache-Control": "no-store" } });
}
