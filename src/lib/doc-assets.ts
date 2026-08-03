import fs from "node:fs";
import path from "node:path";
import type { Company } from "./companies";

/**
 * The pieces every printed document needs: bundled fonts, the company logo, and
 * the SVG wrapper that lets the operator's browser rasterise a page.
 *
 * Server-only — it reads from /public. Both the voucher and the purchase order
 * templates build on it, so there is one answer to "how does a document get its
 * fonts" rather than one per document type.
 */

const PUBLIC = path.join(process.cwd(), "public");

/**
 * How fonts and logos are embedded.
 * "inline" — base64 data URIs; nothing is fetched. Required for PDF rendering.
 * "url"    — plain /fonts and /logos paths; far smaller payload, browser-cached.
 */
export type AssetMode = "inline" | "url";

/** Reads a file from /public once and memoises it as a data URI. */
const assetCache = new Map<string, string>();
export function dataUri(relPath: string, mime: string): string {
  const cached = assetCache.get(relPath);
  if (cached) return cached;
  const bytes = fs.readFileSync(path.join(PUBLIC, relPath));
  const uri = `data:${mime};base64,${bytes.toString("base64")}`;
  assetCache.set(relPath, uri);
  return uri;
}

export function logoUri(company: Company, mode: AssetMode): string {
  return mode === "inline" ? dataUri(company.logo.replace(/^\//, ""), "image/png") : company.logo;
}

/**
 * Which faces a document needs.
 *
 * Urdu is the expensive one — Noto Nastaliq is 690 KB, four times any Poppins
 * weight — and inlining it costs ~920 KB of base64 on every page of every
 * render. The voucher needs it; a purchase order is Latin-only, so it asks for
 * "latin" and its pages come out a third of the size.
 */
export type FontSet = "latin" | "latin+urdu";

const fontCache = new Map<string, string>();

export function fontFaceCss(mode: AssetMode, set: FontSet = "latin+urdu"): string {
  const key = `${mode}:${set}`;
  const cached = fontCache.get(key);
  if (cached) return cached;

  // Inlined for the PDF renderer, which must not depend on an HTTP server being
  // reachable — an <img> loading an SVG treats it as an isolated document that
  // may not fetch anything, so a /fonts URL would silently fall back. Referenced
  // by URL for on-screen previews, where the browser caches the files once.
  const src = (file: string) =>
    mode === "inline" ? dataUri(`fonts/${file}`, "font/ttf") : `/fonts/${file}`;

  const face = (family: string, file: string, weight: string, style = "normal") =>
    `@font-face{font-family:'${family}';src:url('${src(
      file,
    )}') format('truetype');font-weight:${weight};font-style:${style};font-display:block}`;

  const faces = [
    // Poppins stands in for Century Gothic: both are geometric sans faces with a
    // single-storey 'a'. A machine that has the real Century Gothic installed
    // will use it, since it is first in the stack.
    face("PortalSans", "Poppins-Regular.ttf", "400"),
    face("PortalSans", "Poppins-Medium.ttf", "500"),
    face("PortalSans", "Poppins-SemiBold.ttf", "600"),
    face("PortalSans", "Poppins-Bold.ttf", "700"),
    face("PortalSans", "Poppins-Italic.ttf", "400", "italic"),
  ];

  if (set === "latin+urdu") {
    // Variable Nastaliq — Chrome shapes this correctly, which is the whole
    // reason the PDF is rendered by a browser rather than drawn by a JS library.
    faces.push(face("PortalUrdu", "NotoNastaliqUrdu.ttf", "400 700"));
  }

  const css = faces.join("");
  fontCache.set(key, css);
  return css;
}

/** Escapes text for inclusion in HTML that will also be parsed as XML. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Same, but turns newlines into <br/> so a typed address keeps its shape. */
export const escLines = (s: string) => esc(s).replace(/\r?\n/g, "<br/>");

export interface SheetGeometry {
  /** Page size in CSS pixels at the 96dpi reference resolution. */
  widthPx: number;
  heightPx: number;
  /** Page margins, in CSS pixels. Content is inset by these. */
  marginTop: number;
  marginSide: number;
  marginBottom: number;
}

/**
 * Wraps one page of document HTML in an SVG the browser can rasterise.
 *
 * Why go through SVG at all? Because <foreignObject> makes the *browser* lay the
 * page out and shape the text, so the shaping engine is the one already on the
 * operator's machine and no Chromium has to be deployed anywhere.
 *
 * `html` must be a complete document produced by one of the templates: exactly
 * one <style> block and exactly one <body>.
 */
export function wrapPageSvg(html: string, geometry: SheetGeometry): string {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1];
  if (!css || !body) {
    throw new Error("Could not split the document template into CSS and body.");
  }

  const { widthPx: w, heightPx: h, marginTop, marginSide, marginBottom } = geometry;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" />` +
    `<foreignObject x="${marginSide}" y="${marginTop}" ` +
    `width="${w - marginSide * 2}" height="${h - marginTop - marginBottom}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="pv-root">` +
    // CDATA is essential: inside SVG (which is XML) a <style> body is parsed as
    // markup, not as opaque text the way HTML treats it. Without this, a child
    // selector, a stray ampersand, or an angle bracket in a CSS comment becomes
    // a parse error and the whole rasterisation silently fails.
    `<style><![CDATA[${css.replace(/\]\]>/g, "]]&gt;")}]]></style>${body}` +
    `</div></foreignObject></svg>`
  );
}
