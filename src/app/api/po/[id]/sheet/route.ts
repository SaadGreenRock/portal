import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { requireCompany } from "@/lib/companies";
import { store } from "@/lib/db";
import { renderPoSvgs } from "@/lib/po/template";

/**
 * Hands the browser one page of the purchase order as a self-contained SVG,
 * which it rasterises into the PDF. Generated from the stored document, so the
 * PDF can be rebuilt at any time and always matches the record.
 *
 * One page per request, not all of them at once. Each page inlines the whole
 * font family and weighs about 1.2 MB, and a serverless response is capped
 * around 4.5 MB — returning them together meant any order past three pages
 * failed to render in production while working perfectly in development.
 *
 * The total is returned in `X-Page-Count` so the client knows how many more to
 * ask for; page numbers are 1-based.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const po = await (await store()).getPo(id);
  if (!po) return new NextResponse("Not found", { status: 404 });

  const pages = renderPoSvgs(po, requireCompany(po.company));

  const requested = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const page = Number.isInteger(requested) ? requested : 1;
  if (page < 1 || page > pages.length) {
    return new NextResponse(`No page ${page}; this order has ${pages.length}.`, { status: 404 });
  }

  return new NextResponse(pages[page - 1], {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Page-Count": String(pages.length),
      // An issued order stays editable, so a cached page could outlive its
      // document. Never serve one from cache.
      "Cache-Control": "no-store",
    },
  });
}
