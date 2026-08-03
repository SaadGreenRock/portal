import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { periodOf } from "@/lib/db/shared";
import { readPoDoc } from "@/lib/po/parse";
import { renderPoPages, watermarkFor } from "@/lib/po/template";
import type { PoStatus } from "@/lib/po/types";

/**
 * Live preview for the purchase order editor.
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
    poNo?: string;
    status?: PoStatus;
  };

  const company = getCompany(body.company ?? "");
  if (!company || !body.doc) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const status: PoStatus = body.status ?? "draft";
  // An unsaved order has no number yet; show the shape the sequence will fill in.
  const poNo = body.poNo || `${company.prefix}-PO-${periodOf()}-•••`;

  // The editor calls this on every keystroke, so a value the parser refuses —
  // a description past its length limit — has to come back as a message the
  // operator can read *now*, not as a dead preview and a surprise on save.
  let doc;
  try {
    doc = readPoDoc(body.doc);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That order cannot be previewed." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const pages = renderPoPages({ poNo, status, doc }, company, {
    assets: "url",
    watermark: body.poNo ? watermarkFor(status) : "PREVIEW",
  });

  return NextResponse.json({ pages }, { headers: { "Cache-Control": "no-store" } });
}
