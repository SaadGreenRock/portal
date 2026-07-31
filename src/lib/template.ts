import fs from "node:fs";
import path from "node:path";
import { amountInWords, formatAmount } from "./amount-words";
import type { Company } from "./companies";
import { SHEET } from "./sheet";
import type { Voucher } from "./types";

/**
 * Renders a voucher as a single self-contained HTML page, sized for US Letter.
 *
 * Every colour, font size and measurement here was read out of the approved
 * DOCX templates: `w:sz` half-points became pt, twips became inches (÷1440),
 * and cell shading hexes were copied verbatim. The Word original nests six
 * tables to get its layout; this uses flexbox to the same visual result.
 *
 * The same HTML backs both the PDF and the on-screen preview, so the two can
 * never drift apart. The only difference is how assets are attached — see
 * AssetMode below.
 */

const PUBLIC = path.join(process.cwd(), "public");

/** Reads a file from /public once and memoises it as a data URI. */
const assetCache = new Map<string, string>();
function dataUri(relPath: string, mime: string): string {
  const cached = assetCache.get(relPath);
  if (cached) return cached;
  const bytes = fs.readFileSync(path.join(PUBLIC, relPath));
  const uri = `data:${mime};base64,${bytes.toString("base64")}`;
  assetCache.set(relPath, uri);
  return uri;
}

const fontCss: Partial<Record<AssetMode, string>> = {};
function fonts(mode: AssetMode): string {
  const cached = fontCss[mode];
  if (cached) return cached;

  // Inlined for the PDF renderer, which must not depend on an HTTP server being
  // reachable. Referenced by URL for on-screen previews, where inlining would
  // add ~1 MB of base64 to every page render for no benefit — the browser
  // fetches and caches the same files once instead.
  const src = (file: string) =>
    mode === "inline" ? dataUri(`fonts/${file}`, "font/ttf") : `/fonts/${file}`;

  const face = (family: string, file: string, weight: string, style = "normal") =>
    `@font-face{font-family:'${family}';src:url('${src(
      file,
    )}') format('truetype');font-weight:${weight};font-style:${style};font-display:block}`;

  const css = [
    // Poppins stands in for Century Gothic: both are geometric sans faces with a
    // single-storey 'a'. A machine that has the real Century Gothic installed
    // will use it, since it is first in the stack.
    face("PortalSans", "Poppins-Regular.ttf", "400"),
    face("PortalSans", "Poppins-Medium.ttf", "500"),
    face("PortalSans", "Poppins-SemiBold.ttf", "600"),
    face("PortalSans", "Poppins-Bold.ttf", "700"),
    face("PortalSans", "Poppins-Italic.ttf", "400", "italic"),
    // Variable Nastaliq — Chrome shapes this correctly, which is the whole
    // reason the PDF is rendered by a browser rather than drawn by a JS library.
    face("PortalUrdu", "NotoNastaliqUrdu.ttf", "400 700"),
  ].join("");

  fontCss[mode] = css;
  return css;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "2026-07-31" → "31 July 2026", matching how the vouchers are dated by hand. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

/**
 * One labelled field. `value` empty → the rule is drawn but left clear, which
 * is exactly what a toggled-OFF field should look like.
 */
function field(opts: {
  label: string;
  value: string;
  ruleColor: string;
  labelColor: string;
  valueSize: string;
  urduLabel?: string;
}): string {
  const { label, value, ruleColor, labelColor, valueSize, urduLabel } = opts;
  return `
    <div class="f">
      <div class="f-label" style="color:${labelColor}">${esc(label)}${
        urduLabel ? `<span class="f-label-ur">${esc(urduLabel)}</span>` : ""
      }</div>
      <div class="f-value" style="border-bottom-color:${ruleColor};font-size:${valueSize}">${
        value ? esc(value) : "&#160;"
      }</div>
    </div>`;
}

/**
 * How fonts and logos are embedded.
 * "inline" — base64 data URIs; nothing is fetched. Required for PDF rendering.
 * "url"    — plain /fonts and /logos paths; far smaller payload, browser-cached.
 */
export type AssetMode = "inline" | "url";

export interface RenderOptions {
  /** Draws a diagonal PREVIEW wash — used by the live preview, never when saving. */
  watermark?: boolean;
  /** Defaults to "inline" so the PDF path is correct without having to ask. */
  assets?: AssetMode;
}

export function renderVoucherHtml(
  voucher: Voucher,
  company: Company,
  options: RenderOptions = {},
): string {
  const assets: AssetMode = options.assets ?? "inline";
  const t = company.theme;
  const f = voucher.fields;

  // A toggle that is OFF contributes an empty string, so the field prints blank.
  const amountFigure = f.on.amount ? formatAmount(f.amount) : "";
  const amountWords = f.on.amount ? amountInWords(f.amount) : "";
  const recipient = f.on.recipientName ? f.recipientName.trim() : "";
  const phone = f.on.phone ? f.phone.trim() : "";
  const voucherDate = f.on.voucherDate ? formatDate(f.voucherDate) : "";
  const authorizedName = f.on.authorizedName ? f.authorizedName.trim() : "";
  const authorizedDate = f.on.authorizedDate ? formatDate(f.authorizedDate) : "";
  const description = f.on.description ? f.description.trim() : "";

  const logo =
    assets === "inline" ? dataUri(company.logo.replace(/^\//, ""), "image/png") : company.logo;

  // Green Rock: logo and title share a full-bleed teal bar.
  // Sportech: centred logo over a black-ruled title, no bar.
  const header = t.headerBar
    ? `<div class="head head-bar" style="background:${t.headerBar}">
         <img class="head-logo" src="${logo}" alt="" style="width:${company.logoWidthIn}in" />
         <div class="head-title" style="color:${t.headerText}">PAYMENT ACKNOWLEDGMENT VOUCHER</div>
       </div>`
    : `<div class="head head-plain">
         <img class="head-logo" src="${logo}" alt="" style="width:${company.logoWidthIn}in" />
         <div class="head-title" style="color:${t.headerText}">PAYMENT ACKNOWLEDGMENT VOUCHER</div>
         ${company.subtitle ? `<div class="head-sub">${esc(company.subtitle)}</div>` : ""}
       </div>`;

  const metaFill = t.metaFill ?? "transparent";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${fonts(assets)}

  *, *::before, *::after { box-sizing: border-box; }

  @page {
    size: Letter;
    /* Page margins straight from the DOCX sectPr (twips ÷ 1440). */
    margin: 0.139in 0.181in 0.208in 0.181in;
  }

  html, body, .pv-root { margin: 0; padding: 0; }

  /* .pv-root is the same box as the page body, for when this CSS is used inside
     an SVG foreignObject (the client-side PDF path), which has no body element. */
  body, .pv-root {
    font-family: 'Century Gothic', 'PortalSans', 'Avenir Next', sans-serif;
    color: #1a1a1a;
    font-size: 11pt;
    line-height: 1.35;
    -webkit-font-smoothing: antialiased;
    /* Fill exactly one Letter page less its margins, so the footer lands at the
       bottom edge and the description box absorbs whatever slack is left. */
    display: flex;
    flex-direction: column;
    min-height: 10.653in;
  }

  /* ---- header ---------------------------------------------------------- */
  .head-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.139in 0.278in;
    gap: 0.2in;
  }
  .head-bar .head-title {
    font-weight: 700;
    font-size: 12.5pt;
    letter-spacing: 0.2pt;
    text-align: right;
  }
  .head-plain { text-align: center; padding: 0.08in 0 0.06in; }
  .head-plain .head-logo { display: block; margin: 0 auto 0.11in; }
  .head-plain .head-title {
    font-weight: 700;
    font-size: 15pt;
    letter-spacing: 0.3pt;
  }
  .head-sub {
    font-style: italic;
    font-size: 9.5pt;
    color: #6b6b6b;
    margin-top: 0.04in;
    padding-bottom: 0.09in;
    border-bottom: 1.25pt solid #000;
  }
  .head-logo { height: auto; }

  /* ---- body ------------------------------------------------------------ */
  .body {
    padding: 0.18in 0.347in 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
  }
  .head, .foot { flex: 0 0 auto; }

  .section {
    font-weight: 700;
    font-size: 8pt;
    letter-spacing: 1pt;
    text-transform: uppercase;
    color: #6b6b6b;
    margin: 0.15in 0 0.06in;
  }

  .row { display: flex; gap: 0.16in; }
  .row > * { flex: 1 1 0; min-width: 0; }

  /* A labelled field: small caps-ish label over a ruled value line. */
  .f-label {
    font-weight: 700;
    font-size: 8pt;
    letter-spacing: 0.3pt;
    color: #6b6b6b;
    margin-bottom: 0.02in;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .f-label-ur {
    font-family: 'PortalUrdu', serif;
    direction: rtl;
    font-size: 7.5pt;
    line-height: 1.9;
  }
  /* min-height leaves a usable amount of room to write when the field is blank */
  .f-value {
    border-bottom: 0.75pt solid #b9b9b9;
    min-height: 0.26in;
    padding-bottom: 0.03in;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Voucher No. / Date strip */
  .meta {
    display: flex;
    gap: 0.16in;
    padding: 0.09in 0.11in;
    border-radius: 1.5pt;
  }
  .meta > * { flex: 1 1 0; }

  /* Description box — bordered, generous, for a few handwritten lines */
  /* Takes the larger share of the page's leftover height — a blank description
     box is what gets written in by hand — but capped, so a voucher with every
     field filled doesn't end up as one enormous empty rectangle. The .slack
     spacer below soaks up whatever is left over. */
  .desc {
    border: 0.75pt solid #c9c9c9;
    padding: 0.14in;
    flex: 2 1 auto;
    min-height: 1.05in;
    max-height: 2.9in;
    font-size: 10.5pt;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Amount block — tinted, larger figures */
  .amount {
    display: flex;
    border: 0.75pt solid ${t.amountFill};
    background: ${t.amountFill};
  }
  .amount > * { flex: 1 1 0; padding: 0.111in 0.174in; min-width: 0; }
  .amount > *:first-child { border-right: 0.75pt solid rgba(255,255,255,0.85); }
  .amount .f-label { color: ${t.amountInk}; }
  .amount .f-value {
    border-bottom-color: ${t.amountInk};
    color: ${t.amountInk};
    font-weight: 500;
  }
  .amount .amt-figure { font-size: 15pt; }
  .amount .amt-words { font-size: 10.5pt; white-space: normal; min-height: 0.26in; }

  /* ---- acknowledgment -------------------------------------------------- */
  .ack { margin-top: 0.18in; }
  .ack-head {
    font-weight: 700;
    font-size: 9pt;
    letter-spacing: 0.5pt;
    color: #1a1a1a;
    padding-bottom: 0.05in;
    border-bottom: 0.75pt solid #c9c9c9;
    margin-bottom: 0.08in;
  }
  .ack-en { font-size: 9pt; line-height: 1.5; color: #1a1a1a; }
  .ack-ur {
    font-family: 'PortalUrdu', serif;
    direction: rtl;
    text-align: right;
    font-size: 9.5pt;
    line-height: 2.35;
    margin-top: 0.06in;
    color: #1a1a1a;
  }

  /* ---- signatures ------------------------------------------------------ */
  .slack { flex: 1 1 auto; min-height: 0; }
  .signs { display: flex; gap: 0.347in; margin-top: 0.42in; flex: 0 0 auto; }
  .signs > * { flex: 1 1 0; min-width: 0; }
  .sign {
    border-top: 0.75pt solid #333;
    padding-top: 0.05in;
  }
  .sign-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.1in;
    font-weight: 700;
    font-size: 8.5pt;
    color: #1a1a1a;
  }
  .sign-title .ur {
    font-family: 'PortalUrdu', serif;
    direction: rtl;
    font-weight: 400;
    font-size: 8pt;
    line-height: 2;
  }
  .sign-line {
    font-size: 9pt;
    color: #1a1a1a;
    margin-top: 0.07in;
    display: flex;
    gap: 0.05in;
    align-items: baseline;
  }
  .sign-line .k { color: #6b6b6b; white-space: nowrap; }
  /* The rule is a real border rather than underscores, so a typed value and a
     blank line occupy exactly the same space. */
  .sign-line .v {
    flex: 1 1 auto;
    border-bottom: 0.75pt solid #8a8a8a;
    min-height: 0.17in;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .closing {
    text-align: center;
    font-size: 8.5pt;
    color: #6b6b6b;
    margin-top: 0.24in;
  }

  /* ---- footer ---------------------------------------------------------- */
  .foot {
    margin-top: 0.26in;
    padding: 0.076in 0.347in;
    font-style: italic;
    font-size: 8pt;
    ${t.footerBar ? `background:${t.footerBar};` : "border-top:0.75pt solid #c9c9c9;text-align:center;"}
    color: ${t.footerText};
  }

  ${
    options.watermark
      ? `.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
           pointer-events:none;z-index:99}
         .wm span{font-size:74pt;font-weight:700;letter-spacing:12pt;
           color:rgba(26,26,26,0.055);transform:rotate(-32deg)}`
      : ""
  }
</style>
</head>
<body>
${options.watermark ? `<div class="wm"><span>PREVIEW</span></div>` : ""}
${header}

<div class="body">

  <div class="meta" style="background:${metaFill}">
    ${field({
      label: "Voucher No.",
      value: voucher.voucherNo,
      ruleColor: "#b9b9b9",
      labelColor: "#6b6b6b",
      valueSize: "11pt",
    })}
    ${field({
      label: "Date",
      value: voucherDate,
      ruleColor: "#b9b9b9",
      labelColor: "#6b6b6b",
      valueSize: "11pt",
    })}
  </div>

  <div class="section">Paid To</div>
  <div class="row">
    ${field({
      label: "Full Name",
      value: recipient,
      ruleColor: "#b9b9b9",
      labelColor: "#6b6b6b",
      valueSize: "11pt",
    })}
    ${field({
      label: "Phone Number",
      value: phone,
      ruleColor: "#b9b9b9",
      labelColor: "#6b6b6b",
      valueSize: "11pt",
    })}
  </div>

  <div class="section">Description of Task Performed / Item Purchased</div>
  <div class="desc">${description ? esc(description) : "&#160;"}</div>

  <div class="section">Amount</div>
  <div class="amount">
    <div>
      <div class="f-label">AMOUNT PAID (PKR)</div>
      <div class="f-value amt-figure">${amountFigure ? esc(amountFigure) : "&#160;"}</div>
    </div>
    <div>
      <div class="f-label">AMOUNT IN WORDS</div>
      <div class="f-value amt-words">${amountWords ? esc(amountWords) : "&#160;"}</div>
    </div>
  </div>

  <div style="margin-top:0.15in">
    ${field({
      label: "Payment Method  (Cash / Bank Transfer / Other)",
      value: "",
      ruleColor: "#b9b9b9",
      labelColor: "#6b6b6b",
      valueSize: "11pt",
    })}
  </div>

  <div class="ack">
    <div class="ack-head">${esc(company.ackHeading)}</div>
    <div class="ack-en">${esc(company.ackEnglish)}</div>
    <div class="ack-ur">${esc(company.ackUrdu)}</div>
  </div>

  <div class="slack"></div>

  <div class="signs">
    <div class="sign">
      <div class="sign-title">
        <span>Signature of Recipient</span>
        <span class="ur">رقم لینے والے کے دستخط</span>
      </div>
      <div class="sign-line"><span class="k">Name :</span><span class="v">${esc(recipient)}</span></div>
      <div class="sign-line"><span class="k">Date :</span><span class="v">${esc(voucherDate)}</span></div>
    </div>
    <div class="sign">
      <div class="sign-title"><span>${esc(company.authorizedLabel)}</span></div>
      <div class="sign-line"><span class="k">Name :</span><span class="v">${esc(
        authorizedName,
      )}</span></div>
      <div class="sign-line"><span class="k">Date :</span><span class="v">${esc(
        authorizedDate,
      )}</span></div>
    </div>
  </div>

  ${company.closingNote ? `<div class="closing">${esc(company.closingNote)}</div>` : ""}
</div>

<div class="foot">${esc(company.footer)}</div>
</body>
</html>`;
}

/**
 * The voucher wrapped in an SVG, ready to be rasterised by the operator's
 * browser: draw it into an <img>, paint that onto a canvas, and you have the
 * page as pixels.
 *
 * Why go through SVG at all? Because <foreignObject> makes the *browser* lay the
 * page out and shape the text. That matters entirely for the Urdu — Nastaliq
 * needs real HarfBuzz shaping, and a JS PDF library would emit disconnected
 * letterforms. This way the shaping engine is the one already on the operator's
 * machine, so no Chromium has to be deployed anywhere.
 *
 * Assets are always inlined: an <img> loading an SVG treats it as an isolated
 * document that may not fetch anything, so a /fonts URL would silently render
 * in a fallback face.
 */
export function renderVoucherSvg(voucher: Voucher, company: Company): string {
  const html = renderVoucherHtml(voucher, company, { assets: "inline" });

  // Safe to split by pattern because this module produced the string: exactly
  // one <style> block and one <body>.
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1];
  if (!css || !body) {
    throw new Error("Could not split the voucher template into CSS and body.");
  }

  // Letter at the CSS reference resolution of 96dpi, and the DOCX page margins
  // in the same units. The content box is inset by those margins; the page
  // itself is the full sheet.
  const PX = 96;
  const page = { w: SHEET.widthPx, h: SHEET.heightPx };
  const margin = { top: 0.139 * PX, side: 0.181 * PX, bottom: 0.208 * PX };
  const content = {
    x: margin.side,
    y: margin.top,
    w: page.w - margin.side * 2,
    h: page.h - margin.top - margin.bottom,
  };

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}" height="${page.h}" ` +
    `viewBox="0 0 ${page.w} ${page.h}">` +
    `<rect x="0" y="0" width="${page.w}" height="${page.h}" fill="#ffffff" />` +
    `<foreignObject x="${content.x}" y="${content.y}" width="${content.w}" height="${content.h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="pv-root">` +
    // CDATA is essential: inside SVG (which is XML) a <style> body is parsed as
    // markup, not as opaque text the way HTML treats it. Without this, a child
    // selector, a stray ampersand, or an angle bracket in a CSS comment becomes
    // a parse error and the whole rasterisation silently fails.
    `<style><![CDATA[${css.replace(/\]\]>/g, "]]&gt;")}]]></style>${body}` +
    `</div></foreignObject></svg>`
  );
}
