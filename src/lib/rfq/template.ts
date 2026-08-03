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
import { currency as currencyOf, formatQty } from "../money";
import { SHEET } from "../sheet";
import { usableRfqItems } from "./parse";
import { rfqWatermarkFor, type RfqDoc, type RfqItem, type RfqStatus } from "./types";

/**
 * Renders a request for quotation as one or more self-contained HTML pages.
 *
 * Same machinery as the purchase order — one HTML page per sheet, rasterised by
 * the operator's browser — but a different document. The two things that make it
 * one rather than a PO with the prices deleted:
 *
 *   · The Unit Price and Amount columns print as empty ruled boxes, tinted so it
 *     is obvious they are to be written into. There is nothing to total.
 *   · There is no vendor. One generic request goes to whoever the operator
 *     chooses, so the addressee block is replaced by where to send the reply.
 *
 * The signature block is inverted too: the vendor signs this, not us.
 */

export interface RfqRenderable {
  rfqNo: string;
  status: RfqStatus;
  doc: RfqDoc;
}

export interface RfqRenderOptions {
  watermark?: string | null;
  assets?: AssetMode;
}

/* -------------------------------------------------------------------------
 * Page geometry
 *
 * As with the purchase order, pagination happens before the browser lays
 * anything out, so the fixed blocks state their heights here and a row's height
 * is estimated from how many lines its description wraps to. Every number was
 * measured from the rendered CSS — see the note in po/template.ts. Re-measure if
 * the stylesheet below changes.
 * ---------------------------------------------------------------------------*/

const MARGIN_IN = { top: 0.34, side: 0.4, bottom: 0.32 };

const CONTENT_H = 11 - MARGIN_IN.top - MARGIN_IN.bottom;
const CONTENT_W = 8.5 - MARGIN_IN.side * 2;

const FOOTER_H = 0.34;
const FOOTER_MARGIN = 0.12;
const GAP = 0.13;

const HEAD_FULL_H = 0.8;
const LOGO_H = 0.44;
const LOGO_INSET = 0.24;
const META_H = 0.62;
/** The reply-to and delivery blocks. Shorter than a PO's: less to say. */
const PARTIES_H = 1.34;
const SUBJECT_H = 0.56;
const HEAD_CONT_H = 0.52;
const THEAD_H = 0.36;

const FIRST_CHROME =
  HEAD_FULL_H + GAP + META_H + GAP + PARTIES_H + GAP + SUBJECT_H + GAP + THEAD_H;
const CONT_CHROME = HEAD_CONT_H + GAP + THEAD_H;

const FIRST_ROWS_H = CONTENT_H - FOOTER_H - FOOTER_MARGIN - FIRST_CHROME;
const CONT_ROWS_H = CONTENT_H - FOOTER_H - FOOTER_MARGIN - CONT_CHROME;

/**
 * Rows are taller than a purchase order's: the empty price cells need enough
 * height to be written into by hand, which is the whole point of the document.
 * Measured, like everything here.
 */
const ROW_BASE_H = 0.31;
const ROW_LINE_H = 0.165;
const ROW_CODE_H = 0.14;

const DESC_CHARS = 46;
/**
 * Notes sit beside the 2.95in totals box, so they only get the leftover ~4.5in
 * at 8.5pt. Counting on full width would under-count the lines and let the
 * closing block run off the page.
 */
const NOTE_CHARS = 62;
const TERMS_CHARS = 118;

const TAIL_GAP = 0.16;
/**
 * The blank box the vendor totals into — four ruled rows plus its heading.
 * Measured at 1.447in; the extra is margin for a longer heading wrapping.
 */
const TOTALS_H = 1.48;
const NOTES_PAD = 0.2;
const NOTES_LINE_H = 0.155;
const TERMS_PAD = 0.32;
const TERMS_LINE_H = 0.145;
const SIGNS_H = 1.15;

/** Column widths, in inches. Description takes whatever is left. */
const COLS = { n: 0.34, qty: 0.68, unit: 0.6, rate: 1.24, amount: 1.24 };
const COL_DESC = CONTENT_W - (COLS.n + COLS.qty + COLS.unit + COLS.rate + COLS.amount);

function wrappedLines(text: string, perLine: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  return trimmed
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / perLine)), 0);
}

function rowHeight(item: RfqItem): number {
  const lines = wrappedLines(item.description, DESC_CHARS);
  return ROW_BASE_H + (lines - 1) * ROW_LINE_H + (item.code.trim() ? ROW_CODE_H : 0);
}

/** Height of the closing block: blank totals, notes, terms, signatures. */
function tailHeight(doc: RfqDoc): number {
  const left =
    doc.notes.trim() ? NOTES_PAD + wrappedLines(doc.notes, NOTE_CHARS) * NOTES_LINE_H : 0;
  let h = Math.max(TOTALS_H, left);

  if (doc.terms.trim()) {
    h += GAP + TERMS_PAD + wrappedLines(doc.terms, TERMS_CHARS) * TERMS_LINE_H;
  }
  return h + GAP + SIGNS_H;
}

interface PagePlan {
  start: number;
  end: number;
  tail: boolean;
}

/**
 * Decides which line items land on which page. Greedy, with the closing block
 * kept whole — a signature line separated from what it signs off is not a
 * document anyone should return.
 */
export function planRfqPages(doc: RfqDoc): PagePlan[] {
  const items = usableRfqItems(doc);
  const heights = items.map(rowHeight);
  const tail = tailHeight(doc);

  const pages: PagePlan[] = [];
  let index = 0;

  for (let pageNo = 0; ; pageNo++) {
    const capacity = pageNo === 0 ? FIRST_ROWS_H : CONT_ROWS_H;
    const start = index;
    let used = 0;

    // `index === start` forces at least one row on, so a single enormous
    // description cannot spin this loop forever.
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
 * Stops the closing block sitting alone on an otherwise blank page — see the
 * fuller note on the equivalent in po/template.ts.
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

function headerFull(rfq: RfqRenderable, company: Company, logo: string): string {
  const t = company.theme;
  const bar = t.headerBar;

  return `<div class="head head-bar" style="${
    bar ? `background:${bar}` : `border-bottom:1.25pt solid ${t.headerText}`
  }">
    <img class="head-logo" src="${logo}" alt="" />
    <div class="head-titles" style="color:${t.headerText}">
      <div class="head-title">REQUEST FOR QUOTATION</div>
      <div class="head-no">${esc(rfq.rfqNo)}</div>
    </div>
  </div>`;
}

function headerContinued(rfq: RfqRenderable, logo: string): string {
  return `<div class="head-cont">
    <img class="head-cont-logo" src="${logo}" alt="" />
    <span class="head-cont-title">Request for Quotation — continued</span>
    <span class="head-cont-no">${esc(rfq.rfqNo)}</span>
  </div>`;
}

function metaStrip(rfq: RfqRenderable, company: Company): string {
  const d = rfq.doc;
  const cell = (label: string, value: string) =>
    `<div class="meta-cell"><div class="meta-label">${esc(label)}</div>` +
    `<div class="meta-value">${value.trim() ? esc(value) : "—"}</div></div>`;

  return `<div class="meta" style="background:${company.theme.metaFill ?? "transparent"};${
    company.theme.metaFill ? "" : "border:0.75pt solid #d8d8d8;"
  }">
    ${cell("Request No.", rfq.rfqNo)}
    ${cell("Date", formatDate(d.rfqDate))}
    ${cell("Quotations Due By", formatDate(d.replyBy))}
    ${cell("Quote In", currencyOf(d.currency).code)}
  </div>`;
}

/**
 * Where to send the quotation, and where the goods would go.
 *
 * A purchase order names its vendor here. This does not: the request is generic,
 * so the space is better spent telling the vendor how to reply.
 */
function blocks(rfq: RfqRenderable, company: Company): string {
  const d = rfq.doc;
  const contact = [d.contactPhone.trim(), d.contactEmail.trim()].filter(Boolean).join("  ·  ");

  return `<div class="parties">
    <div class="party">
      <div class="party-head">Submit Quotations To</div>
      <div class="party-name">${esc(company.legalName)}</div>
      ${d.contactName.trim() ? `<div class="party-body">${esc(d.contactName.trim())}</div>` : ""}
      ${contact ? `<div class="party-meta">${esc(contact)}</div>` : ""}
    </div>
    <div class="party">
      <div class="party-head">Delivery Location</div>
      ${
        d.deliveryAddress.trim()
          ? `<div class="party-body party-body-top">${escLines(d.deliveryAddress.trim())}</div>`
          : `<div class="party-body party-body-top party-blank">To be advised</div>`
      }
    </div>
  </div>`;
}

function subjectStrip(rfq: RfqRenderable): string {
  return `<div class="strip">
    <div class="strip-cell">
      <div class="strip-label">We invite your quotation for</div>
      <div class="strip-value">${rfq.doc.subject.trim() ? esc(rfq.doc.subject) : "—"}</div>
    </div>
  </div>`;
}

function itemsTable(items: RfqItem[], plan: PagePlan, code: string): string {
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
        <td class="c-fill"><div class="fill">${nbsp}</div></td>
        <td class="c-fill"><div class="fill">${nbsp}</div></td>
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
      <th class="c-fill">Unit Price<span class="th-sub">${esc(code)}</span></th>
      <th class="c-fill">Amount<span class="th-sub">${esc(code)}</span></th>
    </tr></thead>
    <tbody>${
      rows || `<tr><td class="c-empty" colspan="6">No items on this request.</td></tr>`
    }</tbody>
  </table>`;
}

function tailBlock(rfq: RfqRenderable, company: Company): string {
  const d = rfq.doc;
  const c = currencyOf(d.currency);
  const theme = company.theme;

  const blankRow = (label: string, grand = false) =>
    `<div class="t-row${grand ? " t-grand" : ""}">` +
    `<span class="t-label">${esc(label)}</span><span class="t-blank">${nbsp}</span></div>`;

  return `<div class="tail">
    <div class="tail-grid">
      <div class="tail-left">
        ${
          d.notes.trim()
            ? `<div class="notes"><div class="notes-label">Notes</div>
                 <div class="notes-body">${escLines(d.notes.trim())}</div></div>`
            : ""
        }
      </div>
      <div class="totals" style="border-color:${theme.amountFill}">
        <div class="totals-head" style="background:${theme.amountFill};color:${theme.amountInk}">
          To be completed by the vendor  (${esc(c.code)})
        </div>
        <div class="totals-body">
          ${blankRow("Subtotal")}
          ${blankRow("Tax, if applicable")}
          ${blankRow("Freight / Delivery")}
          ${blankRow("Total Quoted", true)}
        </div>
      </div>
    </div>

    ${
      d.terms.trim()
        ? `<div class="terms"><div class="terms-label">Conditions of Quoting</div>
             <div class="terms-body">${escLines(d.terms.trim())}</div></div>`
        : ""
    }

    <div class="signs">
      <div class="sign sign-vendor">
        <div class="sign-head">Quotation Submitted By</div>
        <div class="sign-line"><span class="k">Company</span><span class="v">${nbsp}</span></div>
        <div class="sign-line"><span class="k">Name</span><span class="v">${nbsp}</span></div>
        <div class="sign-line"><span class="k">Signature</span><span class="v">${nbsp}</span></div>
        <div class="sign-line"><span class="k">Date</span><span class="v">${nbsp}</span></div>
      </div>
      <div class="sign">
        <div class="sign-head">Requested By</div>
        <div class="sign-rule"></div>
        <div class="sign-name">${orBlank(d.preparedBy)}</div>
        <div class="sign-org">${esc(company.legalName)}</div>
        <div class="sign-org">${esc(formatDate(d.rfqDate))}</div>
      </div>
    </div>
  </div>`;
}

/** Renders every page of a request as a standalone HTML document. */
export function renderRfqPages(
  rfq: RfqRenderable,
  company: Company,
  options: RfqRenderOptions = {},
): string[] {
  const assets: AssetMode = options.assets ?? "inline";
  const logo = logoUri(company, assets);
  const items = usableRfqItems(rfq.doc);
  const plans = planRfqPages(rfq.doc);
  const code = currencyOf(rfq.doc.currency).code;

  return plans.map((plan, pageNo) =>
    renderPage({
      rfq,
      company,
      logo,
      assets,
      items,
      plan,
      pageNo,
      pageCount: plans.length,
      code,
      watermark: options.watermark ?? null,
    }),
  );
}

interface PageInput {
  rfq: RfqRenderable;
  company: Company;
  logo: string;
  assets: AssetMode;
  items: RfqItem[];
  plan: PagePlan;
  pageNo: number;
  pageCount: number;
  code: string;
  watermark: string | null;
}

function renderPage(input: PageInput): string {
  const { rfq, company, logo, assets, items, plan, pageNo, pageCount, code, watermark } = input;
  const t = company.theme;
  const first = pageNo === 0;
  // A continuation page carrying only the closing block has no table on it.
  const showTable = plan.end > plan.start || pageCount === 1;

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
  .head-logo { height: ${LOGO_H}in; width: auto; max-width: 3in; object-fit: contain; }
  .head-titles { text-align: right; }
  .head-title { font-weight: 700; font-size: 13pt; letter-spacing: 0.5pt; }
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

  /* ---- reply-to / delivery -------------------------------------------- */
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
  .party-body-top { margin-top: 0.06in; }
  .party-blank { color: #8a8a8a; font-style: italic; }
  .party-meta { margin-top: 0.04in; font-size: 8.5pt; color: #6b6b6b; line-height: 1.4; }

  /* ---- subject --------------------------------------------------------- */
  .strip { display: flex; gap: 0.16in; margin-top: ${GAP}in; height: ${SUBJECT_H}in; }
  .strip-cell { flex: 1 1 0; min-width: 0; }
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
    font-size: 10pt;
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
  .th-sub {
    display: block;
    font-size: 5.5pt;
    letter-spacing: 0.4pt;
    opacity: 0.75;
    font-weight: 600;
  }
  .items td {
    padding: 0.055in 0.08in;
    border-bottom: 0.75pt solid #e4e4e4;
    vertical-align: top;
    font-size: 9pt;
  }
  .items .c-n { text-align: right; color: #6b6b6b; }
  .items th.c-n { text-align: right; }
  .items .c-q { text-align: right; }
  .items th.c-q { text-align: right; }
  .items .c-u, .items th.c-u { text-align: center; }
  .items th.c-fill { text-align: right; }
  .i-desc { white-space: pre-wrap; word-break: break-word; }
  .i-code { margin-top: 0.02in; font-size: 7.5pt; color: #6b6b6b; }
  .c-empty { text-align: center; color: #6b6b6b; font-style: italic; padding: 0.3in 0; }

  /* The point of the whole document: a box the vendor writes a price into.
     Tinted and ruled so it reads as "fill this in", not as a rendering fault. */
  .c-fill { background: #fbfaf7; }
  .fill {
    border-bottom: 0.75pt solid #b9b9b9;
    min-height: 0.19in;
  }

  .slack { flex: 1 1 auto; min-height: 0; }

  /* ---- totals to be filled, notes, terms, signatures ------------------- */
  .tail { flex: 0 0 auto; margin-top: ${TAIL_GAP}in; }
  .tail-grid { display: flex; gap: 0.2in; align-items: flex-start; }
  .tail-left { flex: 1 1 auto; min-width: 0; }

  .notes-label, .terms-label {
    font-weight: 700;
    font-size: 6.5pt;
    letter-spacing: 0.9pt;
    text-transform: uppercase;
    color: #6b6b6b;
  }
  .notes-body { margin-top: 0.03in; font-size: 8.5pt; line-height: 1.45; color: #333; }

  .totals { flex: 0 0 2.95in; border: 0.75pt solid; }
  .totals-head {
    padding: 0.05in 0.12in;
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 0.5pt;
    text-transform: uppercase;
  }
  .totals-body { padding: 0.07in 0.12in 0.09in; }
  .t-row {
    display: flex;
    align-items: baseline;
    gap: 0.12in;
    height: 0.235in;
    font-size: 8.5pt;
  }
  .t-label { flex: 0 0 1.15in; color: #4a4a4a; }
  .t-blank { flex: 1 1 auto; border-bottom: 0.75pt solid #b9b9b9; min-height: 0.15in; }
  .t-grand {
    height: 0.3in;
    margin-top: 0.03in;
    padding-top: 0.05in;
    border-top: 1pt solid ${t.amountInk};
    font-size: 9.5pt;
  }
  .t-grand .t-label { font-weight: 700; color: ${t.amountInk}; }
  .t-grand .t-blank { border-bottom-color: ${t.amountInk}; }

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
  .sign { flex: 1 1 0; min-width: 0; }
  .sign-head {
    font-weight: 700;
    font-size: 7pt;
    letter-spacing: 0.8pt;
    text-transform: uppercase;
    color: #6b6b6b;
    padding-bottom: 0.05in;
    border-bottom: 0.75pt solid #d8d8d8;
  }
  /* The vendor fills this side in, so it is ruled lines rather than our names. */
  .sign-line {
    display: flex;
    align-items: baseline;
    gap: 0.07in;
    margin-top: 0.085in;
    font-size: 8pt;
  }
  .sign-line .k { flex: 0 0 0.62in; color: #6b6b6b; }
  .sign-line .v {
    flex: 1 1 auto;
    border-bottom: 0.75pt solid #8a8a8a;
    min-height: 0.16in;
  }
  .sign-rule { margin-top: 0.42in; border-top: 0.75pt solid #333; }
  .sign-name { margin-top: 0.05in; font-size: 9pt; font-weight: 600; }
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
${first ? headerFull(rfq, company, logo) : headerContinued(rfq, logo)}
${first ? metaStrip(rfq, company) : ""}
${first ? blocks(rfq, company) : ""}
${first ? subjectStrip(rfq) : ""}
${showTable ? itemsTable(items, plan, code) : ""}
<div class="slack"></div>
${plan.tail ? tailBlock(rfq, company) : ""}
<div class="foot">
  <span>${esc(company.footer)}</span>
  <span class="foot-page">Page ${pageNo + 1} of ${pageCount}</span>
</div>
</body>
</html>`;
}

/** Every page as an SVG, ready for the browser to rasterise into the PDF. */
export function renderRfqSvgs(rfq: RfqRenderable, company: Company): string[] {
  const PX = 96;
  const geometry = {
    widthPx: SHEET.widthPx,
    heightPx: SHEET.heightPx,
    marginTop: MARGIN_IN.top * PX,
    marginSide: MARGIN_IN.side * PX,
    marginBottom: MARGIN_IN.bottom * PX,
  };
  return renderRfqPages(rfq, company, {
    assets: "inline",
    watermark: rfqWatermarkFor(rfq.status),
  }).map((html) => wrapPageSvg(html, geometry));
}

export { rfqWatermarkFor };
