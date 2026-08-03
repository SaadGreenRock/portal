import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { requireCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { renderPoSvgs } from "@/lib/po/template";

/**
 * Hands the browser the purchase order as one self-contained SVG per page,
 * which it rasterises into the PDF. Generated from the stored document, so the
 * PDF can be rebuilt at any time and always matches the record.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const po = await (await store()).getPo(id);
  if (!po) return new NextResponse("Not found", { status: 404 });

  const pages = renderPoSvgs(po, requireCompany(po.company));

  return NextResponse.json(
    { pages },
    {
      headers: {
        // Deterministic for a given document, but private — and an issued PO
        // stays editable, so it must not be cached across an edit.
        "Cache-Control": "no-store",
      },
    },
  );
}
