import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { requireCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { renderVoucherSvg } from "@/lib/template";

/**
 * Hands the browser the voucher as a self-contained SVG, which it rasterises
 * into the PDF. Generated from the stored field values, so the PDF can be
 * rebuilt at any time and always matches the record.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const voucher = await (await store()).getVoucher(id);
  if (!voucher) return new NextResponse("Not found", { status: 404 });

  const svg = renderVoucherSvg(voucher, requireCompany(voucher.company));

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Deterministic for a given voucher, but private.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
