import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { requireCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { renderRfqSvgs } from "@/lib/rfq/template";

/**
 * Hands the browser one page of the request as a self-contained SVG.
 *
 * One page per request, not all at once: each inlines the whole font family at
 * roughly 1.2 MB, and a serverless response is capped around 4.5 MB. The total
 * comes back in `X-Page-Count`; page numbers are 1-based.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const rfq = await (await store()).getRfq(id);
  if (!rfq) return new NextResponse("Not found", { status: 404 });

  const pages = renderRfqSvgs(rfq, requireCompany(rfq.company));

  const requested = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const page = Number.isInteger(requested) ? requested : 1;
  if (page < 1 || page > pages.length) {
    return new NextResponse(`No page ${page}; this request has ${pages.length}.`, { status: 404 });
  }

  return new NextResponse(pages[page - 1], {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Page-Count": String(pages.length),
      // A request stays editable, so a cached page could outlive its document.
      "Cache-Control": "no-store",
    },
  });
}
