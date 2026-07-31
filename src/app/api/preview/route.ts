import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getCompany } from "@/lib/companies";
import { renderVoucherHtml } from "@/lib/template";
import type { Voucher, VoucherFields } from "@/lib/types";

/**
 * Live preview for the Generate screen.
 *
 * Returns the same HTML the PDF is rendered from, so what the operator sees
 * while typing is exactly what will print — there is no second layout to keep
 * in sync. No voucher record exists yet, so the number shown is the placeholder
 * the real sequence will fill in.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { company?: string; fields?: VoucherFields };
  const company = getCompany(body.company ?? "");
  if (!company || !body.fields) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const draft: Voucher = {
    id: "preview",
    voucherNo: `${company.prefix}-——————-———`,
    company: company.slug,
    status: "pending",
    seq: 0,
    period: "",
    internalNote: "",
    fields: body.fields,
    createdAt: new Date().toISOString(),
    generatedAt: null,
    uploadedAt: null,
    deletedAt: null,
    pdfKey: null,
    scanKey: null,
    scanName: null,
  };

  return new NextResponse(renderVoucherHtml(draft, company, { watermark: true, assets: "url" }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
