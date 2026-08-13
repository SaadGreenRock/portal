import type { Company, CompanyTheme } from "../companies";
import { esc, fontFaceCss, logoUri, wrapPageSvg, type AssetMode } from "../doc-assets";
import { formatDate } from "../format";
import { CARD } from "./geometry";
import { TAG_LABELS, type Notification, type NotificationTag } from "./types";

/**
 * Renders a notification as a single self-contained HTML card, the same
 * "one template backs the preview and the render" approach as the voucher.
 *
 * Full-bleed, unlike the voucher: the header bar reaches every edge of the
 * card, so there is no page margin to wrap it in — see renderNotificationSvg.
 */

/** A fixed, muted red — the one tag that deliberately breaks from the
 *  company's own colours, so urgency reads the same in every company. */
const URGENT_PILL = {
  background: "#8c2a2a",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,.35)",
};

/** The pill sits on the header bar (or on white, for a company with none), so
 *  it has to stay legible against whatever that background is. */
function pillStyle(t: CompanyTheme, tag: NotificationTag) {
  if (tag === "urgent") return URGENT_PILL;
  return t.headerBar
    ? { background: "rgba(255,255,255,.16)", color: t.headerText, border: "1px solid rgba(255,255,255,.35)" }
    : { background: t.ui, color: t.uiText, border: "none" };
}

/** Keeps a longer notice from overflowing the fixed-height card. A CSS
 *  decision against text length — distinct from client-pdf.ts's scaleFor,
 *  which trades raster resolution against page *count*. */
function bodyFontSizePt(len: number): number {
  if (len <= 180) return 13.5;
  if (len <= 350) return 12;
  return 10.5;
}

export interface RenderOptions {
  /** Draws a diagonal PREVIEW wash — used by the live preview, never when saving. */
  watermark?: boolean;
  /** Defaults to "inline" so the PDF/PNG path is correct without having to ask. */
  assets?: AssetMode;
}

export function renderNotificationHtml(
  n: Notification,
  company: Company,
  options: RenderOptions = {},
): string {
  const assets: AssetMode = options.assets ?? "inline";
  const t = company.theme;
  const logo = logoUri(company, assets);
  const pill = pillStyle(t, n.tag);
  const bodySize = bodyFontSizePt(n.body.length);
  const headerBg = t.headerBar ?? "#ffffff";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${fontFaceCss(assets, "latin+urdu")}

  *, *::before, *::after { box-sizing: border-box; }

  html, body, .pv-root { margin: 0; padding: 0; }

  body, .pv-root {
    width: ${CARD.widthPx}px;
    height: ${CARD.heightPx}px;
    font-family: 'PortalSans', 'Avenir Next', sans-serif;
    color: #1a1a1a;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px;
    background: ${headerBg};
  }
  .head-logo { height: auto; max-height: 26px; max-width: 55%; display: block; }
  .pill {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .4px;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    white-space: nowrap;
    background: ${pill.background};
    color: ${pill.color};
    border: ${pill.border};
  }

  .card-body {
    flex: 1 1 auto;
    min-height: 0;
    background: #fff;
    padding: 22px 20px 14px;
    display: flex;
    flex-direction: column;
  }
  .headline {
    font-weight: 700;
    font-size: 19pt;
    line-height: 1.25;
    color: ${t.ui};
  }
  .message {
    margin-top: 12px;
    font-size: ${bodySize}pt;
    line-height: 1.5;
    flex: 1 1 auto;
    white-space: pre-wrap;
    word-break: break-word;
    overflow: hidden;
  }

  .foot {
    flex: 0 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 10px 20px 16px;
    border-top: .75pt solid #e2e2df;
    font-size: 9pt;
    color: #6b6b6b;
  }
  .foot .sender { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot .date { flex: 0 0 auto; }

  ${
    options.watermark
      ? `.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
           pointer-events:none;z-index:99}
         .wm span{font-size:26pt;font-weight:700;letter-spacing:4pt;
           color:rgba(26,26,26,0.07);transform:rotate(-28deg)}`
      : ""
  }
</style>
</head>
<body>
${options.watermark ? `<div class="wm"><span>PREVIEW</span></div>` : ""}

<div class="head">
  <img class="head-logo" src="${logo}" alt="" />
  <span class="pill">${esc(TAG_LABELS[n.tag])}</span>
</div>

<div class="card-body">
  <div class="headline" dir="auto">${esc(n.headline)}</div>
  <div class="message" dir="auto">${esc(n.body)}</div>
</div>

<div class="foot">
  <span class="sender">${esc(n.sender || "Management")}</span>
  <span class="date">${esc(formatDate(n.notifyDate))}</span>
</div>
</body>
</html>`;
}

/**
 * The card wrapped in an SVG, ready to be rasterised by the operator's
 * browser — see renderNotificationCard in client-render.ts.
 *
 * Zero margins: unlike the voucher's page, this card has no border to inset
 * the header bar from — it has to touch every edge.
 */
export function renderNotificationSvg(n: Notification, company: Company): string {
  return wrapPageSvg(renderNotificationHtml(n, company, { assets: "inline" }), {
    widthPx: CARD.widthPx,
    heightPx: CARD.heightPx,
    marginTop: 0,
    marginSide: 0,
    marginBottom: 0,
  });
}
