import type { Company } from "../companies";
import {
  esc,
  escLines,
  fontFaceCss,
  logoUri,
  wrapPageSvg,
  type AssetMode,
} from "../doc-assets";
import { formatDate } from "../format";
import { amountToWords, currency as currencyOf, formatMoneyFixed, formatQty } from "../money";
import { SHEET } from "../sheet";
import { poTotals, usableItems } from "./totals";
import type { PoDoc, PoItem, PoStatus } from "./types";

/**
 * Renders a purchase order as one or more self-contained HTML pages, sized for
 * US Letter and branded from the company's theme.
 *
 * Same approach as the voucher: the HTML here backs both the on-screen preview
 * and the PDF, so what the operator sees while typing is what the vendor
 * receives. The difference is that a PO has an unbounded number of line items,
 * so it paginates — see the note above the geometry block for how.
 *
 * No Urdu on a purchase order, so it asks for the Latin font set only. That
 * drops ~920 KB of base64 off every page of every render.
 */

/** The minimum a purchase order needs to be drawn. */
export interface PoRenderable {
  poNo: string;
  status: PoStatus;
  doc: PoDoc;
}

export interface PoRenderOptions {
  /** Diagonal wash across the page: "DRAFT", "PREVIEW", "CANCELLED". */
  watermark?: string | null;
  assets?: AssetMode;
}

/* -------------------------------------------------------------------------
 * Page geometry
 *
 * These numbers are the CSS below, measured. Pagination has to happen before
 * the browser lays anything out — the server decides which items land on which
 * page — so the heights of the fixed blocks are stated here and the height of a
 * line-item row is estimated from how many lines its description will wrap to.
 *
 * The estimate is deliberately generous. Guessing one line too many costs a bit
 * of white space at the foot of a page; guessing one too few would let the last
 * row run off the bottom edge. They must be re-measured if the CSS changes.
 * ---------------------------------------------------------------------------*/

const MARGIN_IN = { top: 0.34, side: 0.4, bottom: 0.32 };

/** Usable height inside the margins, in inches. */
const CONTENT_H = 11 - MARGIN_IN.top - MARGIN_IN.bottom;
/** Usable width inside the margins, in inches. */
const CONTENT_W = 8.5 - MARGIN_IN.side * 2;

const FOOTER_H = 0.34;
/** The footer's own margin-top, which the capacity maths has to reserve too. */
const FOOTER_MARGIN = 0.12;
const GAP = 0.13;

/** Blocks that appear only on the first page. */
const HEAD_FULL_H = 0.8;
/** Logo height inside the masthead, and the masthead's side padding. */
const LOGO_H = 0.44;
const LOGO_INSET = 0.24;
const META_H = 0.62;
const PARTIES_H = 1.58;
const TERMS_ROW_H = 0.56;
/** The slimmer header on every page after the first. */
const HEAD_CONT_H = 0.52;
const THEAD_H = 0.3;

const FIRST_CHROME = HEAD_FULL_H + GAP + META_H + GAP + PARTIES_H + GAP + TERMS_ROW_H + GAP + THEAD_H;
const CONT_CHROME = HEAD_CONT_H + GAP + THEAD_H;

const FIRST_ROWS_H = CONTENT_H - FOOTER_H - FOOTER_MARGIN - FIRST_CHROME;
const CONT_ROWS_H = CONTENT_H - FOOTER_H - FOOTER_MARGIN - CONT_CHROME;

/** One line-item row: base height, plus this much per extra wrapped line. */
const ROW_BASE_H = 0.29;
const ROW_LINE_H = 0.165;
/** An item code prints on its own line under the description. */
const ROW_CODE_H = 0.16;

/**
 * Characters that fit on one line of the description column, at 9pt Poppins in
 * a 3.85in column. Poppins averages ~0.55em per glyph, so ~53 fit; 48 is used
 * so a description of wide characters still errs towards a taller estimate.
 */
const DESC_CHARS = 48;
/**
 * Same idea for the closing blocks. Notes sit beside the totals box, so they
 * only get the leftover ~4.6in at 8.5pt; the terms run the full width at 7.5pt.
 */
const NOTE_CHARS = 62;
const TERMS_CHARS = 118;

const TAIL_GAP = 0.16;
const TOTALS_ROW_H = 0.235;
const TOTALS_GRAND_H = 0.34;
const TOTALS_PAD = 0.26;
const WORDS_H = 0.5;
const NOTES_PAD = 0.2;
const NOTES_LINE_H = 0.155;
const TERMS_PAD = 0.32;
const TERMS_LINE_H = 0.145;
const SIGNS_H = 1.05;

/** Column widths, in inches. Description takes whatever is left. */
const COLS = { n: 0.34, qty: 0.72, unit: 0.62, rate: 1.05, amount: 1.17 };
const COL_DESC = CONTENT_W - (COLS.n + COLS.qty + COLS.unit + COLS.rate + COLS.amount);

/** How many lines a string wraps to in a column that fits `perLine` characters. */
function wrappedLines(text: string, perLine: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  return trimmed
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / perLine)), 0);
}

function rowHeight(item: PoItem): number {
  const lines = wrappedLines(item.description, DESC_CHARS);
  return ROW_BASE_H + (lines - 1) * ROW_LINE_H + (item.code.trim() ? ROW_CODE_H : 0);
}

/** Height of the closing block: totals, amount in words, notes, terms, signatures. */
function tailHeight(doc: PoDoc): number {
  const t = poTotals(doc);
  const rows =
    1 + // subtotal
    (t.discount > 0 ? 1 : 0) +
    (doc.showTax ? 1 : 0) +
    (t.shipping > 0 ? 1 : 0);

  let h = TOTALS_PAD + rows * TOTALS_ROW_H + TOTALS_GRAND_H;
  // The words sit beside the totals box, so the taller of the two governs, but
  // notes stack under the words and can push past it.
  const leftColumn =
    WORDS_H +
    (doc.notes.trim() ? NOTES_PAD + wrappedLines(doc.notes, NOTE_CHARS) * NOTES_LINE_H : 0);
  h = Math.max(h, leftColumn);

  if (doc.terms.trim()) {
    h += GAP + TERMS_PAD + wrappedLines(doc.terms, TERMS_CHARS) * TERMS_LINE_H;
  }
  return h + GAP + SIGNS_H;
}

interface PagePlan {
  /** Indices into the usable item list, inclusive of start, exclusive of end. */
  start: number;
  end: number;
  /** This page carries the totals and signatures. Exactly one page does. */
  tail: boolean;
}

/**
 * Decides which line items land on which page.
 *
 * Greedy: fill the current page until the next row would overflow, then start a
 * new one. The closing block has to fit under the last row — if it doesn't, it
 * moves to a page of its own rather than being split across the fold, because a
 * signature line separated from its totals is not a document anyone should sign.
 */
export function planPoPages(doc: PoDoc): PagePlan[] {
  const items = usableItems(doc);
  const heights = items.map(rowHeight);
  const tail = tailHeight(doc);

  const pages: PagePlan[] = [];
  let index = 0;

  for (let pageNo = 0; ; pageNo++) {
    const capacity = pageNo === 0 ? FIRST_ROWS_H : CONT_ROWS_H;
    const start = index;
    let used = 0;

    // `index === start` forces at least one row onto the page, so a single item
    // with an enormous description can't spin this loop forever.
    while (index < heights.length && (used + heights[index] <= capacity || index === start)) {
      used += heights[index];
      index += 1;
    }

    const lastRowPage = index >= heights.length;
    const tailFits = used + TAIL_GAP + tail <= capacity;

    pages.push({ start, end: index, tail: lastRowPage && tailFits });

    if (lastRowPage) {
      if (!tailFits) pages.push({ start: index, end: index, tail: true });
      break;
    }
  }

  balanceLastPages(pages, heights, tail);
  return pages;
}

const sumRange = (heights: number[], from: number, to: number) =>
  heights.slice(from, to).reduce((sum, h) => sum + h, 0);

/**
 * Stops the closing block from sitting alone on an otherwise blank page.
 *
 * When the totals and signatures spill, the greedy pass leaves the page before
 * them half empty and the final page almost bare — which reads as a mistake
 * even though it isn't. This pulls rows forward onto the final page until the
 * two are roughly even, stopping before the earlier page becomes the emptier of
 * the pair and always leaving it at least one row.
 */
function balanceLastPages(pages: PagePlan[], heights: number[], tail: number): void {
  if (pages.length < 2) return;

  const last = pages[pages.length - 1];
  const previous = pages[pages.length - 2];
  if (last.start !== last.end || !last.tail) return;

  const room = CONT_ROWS_H - tail - TAIL_GAP;
  let moved = 0;

  while (last.start > previous.start + 1) {
    const height = heights[last.start - 1];
    if (moved + height > room) break;
    if (sumRange(heights, previous.start, last.start - 1) < moved + height) break;

    last.start -= 1;
    previous.end -= 1;
    moved += height;
  }
}

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------------*/

const nbsp = "&#160;";
const orBlank = (s: string) => (s.trim() ? esc(s) : nbsp);

/**
 * The masthead: logo on the left, document title and number on the right.
 *
 * Both companies get the same arrangement, unlike the voucher, where each one
 * reproduces its own approved DOCX layout. A purchase order is a new document
 * with no such original to match, and one arrangement means one height for the
 * paginator to reserve — a per-company masthead would need a per-company
 * geometry constant, which is a trap waiting for the third company.
 *
 * The logo is sized by *height*, not width, so a wide logo can never push the
 * masthead past the height reserved for it.
 */
function headerFull(po: PoRenderable, company: Company, logo: string): string {
  const t = company.theme;
  const bar = t.headerBar;

  return `<div class="head head-bar" style="${
    bar ? `background:${bar}` : `border-bottom:1.25pt solid ${t.headerText}`
  }">
    <img class="head-logo" src="${logo}" alt="" />
    <div class="head-titles" style="color:${t.headerText}">
      <div class="head-title">PURCHASE ORDER</div>
      <div class="head-no">${esc(po.poNo)}</div>
    </div>
  </div>`;
}

function headerContinued(po: PoRenderable, logo: string): string {
  return `<div class="head-cont">
    <img class="head-cont-logo" src="${logo}" alt="" />
    <span class="head-cont-title">Purchase Order — continued</span>
    <span class="head-cont-no">${esc(po.poNo)}</span>
  </div>`;
}

function metaStrip(po: PoRenderable, company: Company): string {
  const d = po.doc;
  const cell = (label: string, value: string) =>
    `<div class="meta-cell"><div class="meta-label">${esc(label)}</div>` +
    `<div class="meta-value">${value.trim() ? esc(value) : "—"}</div></div>`;

  return `<div class="meta" style="background:${company.theme.metaFill ?? "transparent"};${
    company.theme.metaFill ? "" : "border:0.75pt solid #d8d8d8;"
  }">
    ${cell("Purchase Order No.", po.poNo)}
    ${cell("Date", formatDate(d.poDate))}
    ${cell("Required By", formatDate(d.deliveryDate))}
    ${cell("Reference", d.reference)}
  </div>`;
}

function parties(po: PoRenderable, company: Company): string {
  const v = po.doc.vendor;

  const contactLine = [
    v.contact.trim() ? `Attn: ${v.contact.trim()}` : "",
    v.phone.trim(),
    v.email.trim(),
  ]
    .filter(Boolean)
    .join("  ·  ");

  return `<div class="parties">
    <div class="party">
      <div class="party-head">Vendor</div>
      <div class="party-name">${orBlank(v.name)}</div>
      ${v.address.trim() ? `<div class="party-body">${escLines(v.address.trim())}</div>` : ""}
      ${contactLine ? `<div class="party-meta">${esc(contactLine)}</div>` : ""}
      ${v.taxId.trim() ? `<div class="party-meta">Tax Reg. ${esc(v.taxId.trim())}</div>` : ""}
    </div>
    <div class="party">
      <div class="party-head">Deliver To</div>
      <div class="party-name">${esc(company.legalName)}</div>
      ${
        po.doc.deliveryAddress.trim()
          ? `<div class="party-body">${escLines(po.doc.deliveryAddress.trim())}</div>`
          : `<div class="party-body party-blank">${nbsp}</div>`
      }
    </div>
  </div>`;
}

function termsRow(po: PoRenderable): string {
  const d = po.doc;
  return `<div class="strip">
    <div class="strip-cell">
      <div class="strip-label">Payment Terms</div>
      <div class="strip-value">${d.paymentTerms.trim() ? esc(d.paymentTerms) : "—"}</div>
    </div>
    <div class="strip-cell strip-wide">
      <div class="strip-label">Subject</div>
      <div class="strip-value">${d.subject.trim() ? esc(d.subject) : "—"}</div>
    </div>
  </div>`;
}

function itemsTable(items: PoItem[], lines: number[], plan: PagePlan, code: string): string {
  const rows = items
    .slice(plan.start, plan.end)
    .map((item, offset) => {
      const n = plan.start + offset;
      return `<tr>
        <td class="c-n mono">${n + 1}</td>
        <td class="c-d">
          <div class="i-desc">${orBlank(item.description)}</div>
          ${item.code.trim() ? `<div class="i-code mono">Item code ${esc(item.code)}</div>` : ""}
        </td>
        <td class="c-q mono">${formatQty(item.qty)}</td>
        <td class="c-u">${item.unit.trim() ? esc(item.unit) : "—"}</td>
        <td class="c-r mono">${formatMoneyFixed(item.unitPrice, code)}</td>
        <td class="c-a mono">${formatMoneyFixed(lines[n], code)}</td>
      </tr>`;
    })
    .join("");

  return `<table class="items">
    <colgroup>
      <col style="width:${COLS.n}in" />
      <col style="width:${COL_DESC}in" />
      <col style="width:${COLS.qty}in" />
      <col style="width:${COLS.unit}in" />
      <col style="width:${COLS.rate}in" />
      <col style="width:${COLS.amount}in" />
    </colgroup>
    <thead><tr>
      <th class="c-n">#</th>
      <th class="c-d">Description</th>
      <th class="c-q">Qty</th>
      <th class="c-u">Unit</th>
      <th class="c-r">Rate</th>
      <th class="c-a">Amount</th>
    </tr></thead>
    <tbody>${rows || `<tr><td class="c-empty" colspan="6">No items on this order.</td></tr>`}</tbody>
  </table>`;
}

function tailBlock(po: PoRenderable, company: Company): string {
  const d = po.doc;
  const t = poTotals(d);
  const c = currencyOf(d.currency);
  const theme = company.theme;

  const row = (label: string, value: string, cls = "") =>
    `<div class="t-row ${cls}"><span class="t-label">${esc(label)}</span>` +
    `<span class="t-value mono">${esc(value)}</span></div>`;

  const totals = [
    row("Subtotal", formatMoneyFixed(t.subtotal, c.code)),
    t.discount > 0 ? row("Discount", `− ${formatMoneyFixed(t.discount, c.code)}`) : "",
    d.showTax
      ? row(`${d.taxLabel || "Tax"} @ ${formatQty(d.taxRate)}%`, formatMoneyFixed(t.tax, c.code))
      : "",
    t.shipping > 0 ? row("Freight / Handling", formatMoneyFixed(t.shipping, c.code)) : "",
    row("Total", `${c.code}  ${formatMoneyFixed(t.total, c.code)}`, "t-grand"),
  ].join("");

  return `<div class="tail">
    <div class="tail-grid">
      <div class="tail-left">
        <div class="words">
          <div class="words-label">Total in Words</div>
          <div class="words-value">${
            t.total > 0 ? esc(amountToWords(t.total, c.code)) : nbsp
          }</div>
        </div>
        ${
          d.notes.trim()
            ? `<div class="notes"><div class="notes-label">Notes</div>
                 <div class="notes-body">${escLines(d.notes.trim())}</div></div>`
            : ""
        }
      </div>
      <div class="totals" style="background:${theme.amountFill};border-color:${theme.amountFill}">
        ${totals}
      </div>
    </div>

    ${
      d.terms.trim()
        ? `<div class="terms"><div class="terms-label">Terms &amp; Conditions</div>
             <div class="terms-body">${escLines(d.terms.trim())}</div></div>`
        : ""
    }

    <div class="signs">
      <div class="sign">
        <div class="sign-rule"></div>
        <div class="sign-title">Prepared By</div>
        <div class="sign-name">${orBlank(d.preparedBy)}</div>
        <div class="sign-org">${esc(company.legalName)}</div>
      </div>
      <div class="sign">
        <div class="sign-rule"></div>
        <div class="sign-title">Approved By</div>
        <div class="sign-name">${orBlank(d.approvedBy)}</div>
        <div class="sign-org">${esc(company.legalName)}</div>
      </div>
      <div class="sign">
        <div class="sign-rule"></div>
        <div class="sign-title">Accepted By — Vendor</div>
        <div class="sign-name">${nbsp}</div>
        <div class="sign-org">Signature, name and date</div>
      </div>
    </div>
  </div>`;
}

/**
 * Renders every page of a purchase order as a standalone HTML document.
 *
 * One document per page rather than one document with page breaks, because the
 * PDF path rasterises each page separately and the preview shows them stacked;
 * both want the pages already separated.
 */
export function renderPoPages(
  po: PoRenderable,
  company: Company,
  options: PoRenderOptions = {},
): string[] {
  const assets: AssetMode = options.assets ?? "inline";
  const logo = logoUri(company, assets);
  const items = usableItems(po.doc);
  // Line amounts indexed against the *printed* rows. Rows dropped by
  // usableItems always amount to zero, so the totals are unaffected.
  const lines = poTotals({ ...po.doc, items }).lines;
  const plans = planPoPages(po.doc);
  const code = currencyOf(po.doc.currency).code;

  return plans.map((plan, pageNo) =>
    renderPage({
      po,
      company,
      logo,
      assets,
      items,
      lines,
      plan,
      pageNo,
      pageCount: plans.length,
      code,
      watermark: options.watermark ?? null,
    }),
  );
}

interface PageInput {
  po: PoRenderable;
  company: Company;
  logo: string;
  assets: AssetMode;
  items: PoItem[];
  lines: number[];
  plan: PagePlan;
  pageNo: number;
  pageCount: number;
  code: string;
  watermark: string | null;
}

function renderPage(input: PageInput): string {
  const { po, company, logo, assets, items, lines, plan, pageNo, pageCount, code, watermark } =
    input;
  // A continuation page that carries only the closing block has no table on it.
  // The exception is an order with no items at all: its single page still shows
  // the empty table, so the screen reads as "nothing ordered yet" rather than
  // as something that failed to render.
  const showTable = plan.end > plan.start || pageCount === 1;
  const t = company.theme;
  const first = pageNo === 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${fontFaceCss(assets, "latin")}

  *, *::before, *::after { box-sizing: border-box; }

  @page {
    size: Letter;
    margin: ${MARGIN_IN.top}in ${MARGIN_IN.side}in ${MARGIN_IN.bottom}in ${MARGIN_IN.side}in;
  }

  html, body, .pv-root { margin: 0; padding: 0; }

  /* .pv-root is the same box as the page body, for when this CSS is used inside
     an SVG foreignObject (the client-side PDF path), which has no body element. */
  body, .pv-root {
    font-family: 'Century Gothic', 'PortalSans', 'Avenir Next', sans-serif;
    color: #1a1a1a;
    font-size: 9.5pt;
    line-height: 1.35;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
    min-height: ${CONTENT_H}in;
  }

  .mono { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

  /* ---- headers --------------------------------------------------------- */
  .head, .head-cont, .foot { flex: 0 0 auto; }

  .head-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.2in;
    padding: 0.14in ${LOGO_INSET}in;
    height: ${HEAD_FULL_H}in;
    overflow: hidden;
  }
  /* Sized by height so any logo's aspect ratio fits the reserved masthead. */
  .head-logo { height: ${LOGO_H}in; width: auto; max-width: 3in; object-fit: contain; }
  .head-titles { text-align: right; }
  .head-title { font-weight: 700; font-size: 14pt; letter-spacing: 0.6pt; }
  .head-bar .head-no { font-size: 9pt; letter-spacing: 0.4pt; opacity: 0.85; margin-top: 0.02in; }

  .head-cont {
    display: flex;
    align-items: center;
    gap: 0.14in;
    height: ${HEAD_CONT_H}in;
    padding-bottom: 0.09in;
    border-bottom: 0.75pt solid ${t.headerBar ?? "#c9c9c9"};
  }
  .head-cont-logo { height: 0.22in; width: auto; }
  .head-cont-title {
    flex: 1 1 auto;
    font-weight: 600;
    font-size: 9pt;
    letter-spacing: 0.4pt;
    color: #6b6b6b;
  }
  .head-cont-no { font-weight: 700; font-size: 9.5pt; font-variant-numeric: tabular-nums; }

  /* ---- meta strip ------------------------------------------------------ */
  .meta {
    display: flex;
    margin-top: ${GAP}in;
    height: ${META_H}in;
    border-radius: 1.5pt;
    overflow: hidden;
  }
  .meta-cell {
    flex: 1 1 0;
    min-width: 0;
    padding: 0.08in 0.13in;
    border-right: 0.75pt solid rgba(255,255,255,0.7);
  }
  .meta-cell:last-child { border-right: 0; }
  .meta-label {
    font-weight: 700;
    font-size: 6.5pt;
    letter-spacing: 0.7pt;
    text-transform: uppercase;
    color: #6b6b6b;
  }
  .meta-value {
    margin-top: 0.03in;
    font-size: 10pt;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---- vendor / deliver-to -------------------------------------------- */
  .parties { display: flex; gap: 0.16in; margin-top: ${GAP}in; height: ${PARTIES_H}in; }
  .party {
    flex: 1 1 0;
    min-width: 0;
    border: 0.75pt solid #d8d8d8;
    border-top: 2pt solid ${t.ui};
    padding: 0.1in 0.14in;
    overflow: hidden;
  }
  .party-head {
    font-weight: 700;
    font-size: 6.5pt;
    letter-spacing: 0.9pt;
    text-transform: uppercase;
    color: ${t.ui};
  }
  .party-name { margin-top: 0.04in; font-size: 11pt; font-weight: 600; line-height: 1.2; }
  .party-body { margin-top: 0.05in; font-size: 9pt; line-height: 1.4; color: #333; }
  .party-blank { min-height: 0.4in; }
  .party-meta { margin-top: 0.04in; font-size: 8.5pt; color: #6b6b6b; line-height: 1.4; }

  /* ---- payment terms / subject ---------------------------------------- */
  .strip {
    display: flex;
    gap: 0.16in;
    margin-top: ${GAP}in;
    height: ${TERMS_ROW_H}in;
  }
  .strip-cell { flex: 1 1 0; min-width: 0; }
  .strip-wide { flex: 2 1 0; }
  .strip-label {
    font-weight: 700;
    font-size: 6.5pt;
    letter-spacing: 0.7pt;
    text-transform: uppercase;
    color: #6b6b6b;
  }
  .strip-value {
    margin-top: 0.03in;
    padding-bottom: 0.04in;
    border-bottom: 0.75pt solid #d8d8d8;
    font-size: 9.5pt;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---- line items ------------------------------------------------------ */
  .items {
    width: 100%;
    margin-top: ${GAP}in;
    border-collapse: collapse;
    table-layout: fixed;
    flex: 0 0 auto;
  }
  .items th {
    height: ${THEAD_H}in;
    padding: 0 0.08in;
    background: ${t.ui};
    color: ${t.uiText};
    font-weight: 700;
    font-size: 7pt;
    letter-spacing: 0.7pt;
    text-transform: uppercase;
    text-align: left;
    vertical-align: middle;
  }
  .items td {
    padding: 0.055in 0.08in;
    border-bottom: 0.75pt solid #e4e4e4;
    vertical-align: top;
    font-size: 9pt;
  }
  .items .c-n { text-align: right; color: #6b6b6b; }
  .items th.c-n { text-align: right; }
  .items .c-q, .items .c-r, .items .c-a { text-align: right; }
  .items th.c-q, .items th.c-r, .items th.c-a { text-align: right; }
  .items .c-u { text-align: center; }
  .items th.c-u { text-align: center; }
  .items .c-a { font-weight: 600; }
  .i-desc { white-space: pre-wrap; word-break: break-word; }
  .i-code { margin-top: 0.02in; font-size: 7.5pt; color: #6b6b6b; }
  .c-empty { text-align: center; color: #6b6b6b; font-style: italic; padding: 0.3in 0; }

  /* Pushes the closing block to the bottom of a short page and the footer to
     the very bottom of a full one. */
  .slack { flex: 1 1 auto; min-height: 0; }

  /* ---- totals, notes, terms, signatures -------------------------------- */
  .tail { flex: 0 0 auto; margin-top: ${TAIL_GAP}in; }
  .tail-grid { display: flex; gap: 0.2in; align-items: flex-start; }
  .tail-left { flex: 1 1 auto; min-width: 0; }

  .words-label, .notes-label, .terms-label {
    font-weight: 700;
    font-size: 6.5pt;
    letter-spacing: 0.9pt;
    text-transform: uppercase;
    color: #6b6b6b;
  }
  .words-value {
    margin-top: 0.03in;
    font-size: 9.5pt;
    font-weight: 500;
    line-height: 1.4;
  }
  .notes { margin-top: 0.14in; }
  .notes-body { margin-top: 0.03in; font-size: 8.5pt; line-height: 1.45; color: #333; }

  .totals {
    flex: 0 0 2.85in;
    border: 0.75pt solid;
    padding: 0.1in 0.14in;
    color: ${t.amountInk};
  }
  .t-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.1in;
    height: ${TOTALS_ROW_H}in;
    font-size: 9pt;
  }
  .t-label { color: ${t.amountInk}; opacity: 0.85; }
  .t-value { font-weight: 500; }
  .t-grand {
    height: ${TOTALS_GRAND_H}in;
    margin-top: 0.04in;
    padding-top: 0.06in;
    border-top: 1pt solid ${t.amountInk};
    font-size: 11.5pt;
    font-weight: 700;
  }
  .t-grand .t-label { font-weight: 700; opacity: 1; letter-spacing: 0.4pt; }

  .terms {
    margin-top: ${GAP}in;
    padding-top: 0.08in;
    border-top: 0.75pt solid #d8d8d8;
  }
  .terms-body {
    margin-top: 0.03in;
    font-size: 7.5pt;
    line-height: ${TERMS_LINE_H * 72}pt;
    color: #4a4a4a;
    white-space: pre-wrap;
  }

  .signs { display: flex; gap: 0.3in; margin-top: ${GAP}in; height: ${SIGNS_H}in; }
  .sign { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; }
  .sign-rule { border-top: 0.75pt solid #333; }
  .sign-title {
    margin-top: 0.05in;
    font-weight: 700;
    font-size: 8pt;
    letter-spacing: 0.3pt;
  }
  .sign-name {
    margin-top: 0.02in;
    font-size: 9pt;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sign-org { margin-top: 0.01in; font-size: 7.5pt; color: #6b6b6b; }

  /* ---- footer ---------------------------------------------------------- */
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.2in;
    height: ${FOOTER_H}in;
    margin-top: 0.12in;
    padding: 0 0.24in;
    font-style: italic;
    font-size: 7.5pt;
    ${t.footerBar ? `background:${t.footerBar};` : "border-top:0.75pt solid #c9c9c9;"}
    color: ${t.footerText};
  }
  .foot-page { font-style: normal; font-variant-numeric: tabular-nums; }

  ${
    watermark
      ? `.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
           pointer-events:none;z-index:99}
         .wm span{font-size:70pt;font-weight:700;letter-spacing:10pt;
           color:rgba(26,26,26,0.055);transform:rotate(-32deg);white-space:nowrap}`
      : ""
  }
</style>
</head>
<body>
${watermark ? `<div class="wm"><span>${esc(watermark)}</span></div>` : ""}
${first ? headerFull(po, company, logo) : headerContinued(po, logo)}
${first ? metaStrip(po, company) : ""}
${first ? parties(po, company) : ""}
${first ? termsRow(po) : ""}
${showTable ? itemsTable(items, lines, plan, code) : ""}
<div class="slack"></div>
${plan.tail ? tailBlock(po, company) : ""}
<div class="foot">
  <span>${esc(company.footer)}</span>
  <span class="foot-page">Page ${pageNo + 1} of ${pageCount}</span>
</div>
</body>
</html>`;
}

/** Every page as an SVG, ready for the browser to rasterise into the PDF. */
export function renderPoSvgs(po: PoRenderable, company: Company): string[] {
  const PX = 96;
  const geometry = {
    widthPx: SHEET.widthPx,
    heightPx: SHEET.heightPx,
    marginTop: MARGIN_IN.top * PX,
    marginSide: MARGIN_IN.side * PX,
    marginBottom: MARGIN_IN.bottom * PX,
  };
  return renderPoPages(po, company, {
    assets: "inline",
    watermark: watermarkFor(po.status),
  }).map((html) => wrapPageSvg(html, geometry));
}

/**
 * What, if anything, is stamped across the page.
 *
 * A draft PDF says so, because a draft that reaches a vendor looking like a
 * final order is exactly the mistake this is here to prevent. A cancelled one
 * says so for the same reason: the vendor may already hold a copy.
 */
export function watermarkFor(status: PoStatus): string | null {
  if (status === "draft") return "DRAFT";
  if (status === "cancelled") return "CANCELLED";
  return null;
}
