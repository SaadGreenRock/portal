# Company Portal — Green Rock & Sportech

A single-operator web portal for the paperwork that has to be numbered, findable
and consistent. It currently does two things:

- **Payment acknowledgment vouchers** — numbered, company-branded voucher PDFs,
  with the signed scans kept in a searchable permanent record.
- **Purchase orders** — priced, totalled orders raised on vendors, issued as a
  branded PDF and closed by filing the vendor's invoice.
- **Requests for quotation** — the same list of items with the prices left
  *blank*, for vendors to fill in and send back.

Each company is its own workspace. They share nothing: separate numbering,
separate history, separate settings.

It does not replace the handwritten signature — it makes the paper trail
numbered, organised and findable.

---

## Run it

```bash
npm install
cp .env.example .env      # then set PORTAL_PASSWORD
npm run dev               # http://localhost:3000
```

That's the whole setup. Out of the box it stores data in SQLite and files on
disk under `./.data`, so there is no account to create and nothing to configure.

**Set `PORTAL_PASSWORD` before exposing this to a network.** Until you do, the
password is `change-me` and the login screen says so.

Requires Node 20+. Nothing else — no Chromium, no system packages.

> **Upgrading an existing Supabase deployment?** Each module adds tables.
> Re-run [`supabase/migration.sql`](supabase/migration.sql) — it is safe to
> re-run — then `npm run check:supabase`. Until you do, the Purchase Orders tab
> explains what to run and vouchers carry on working.

---

## Getting around

Opening a company lands on its **Overview**: what needs attention today, and the
way into each module. It is not a menu — the module switcher is on every screen
anyway, so a page that only listed the modules would not be worth the click. It
earns it by answering "what is waiting on me" first: vouchers without a signed
scan and how long the oldest has waited, orders overdue on delivery, value still
outstanding per currency.

Below that, the header has two rows. The first picks the **module** — Vouchers,
Purchase Orders or Quotations — and holds Settings. The second is that module's
screens. Badges count what is outstanding.

The Overview draws its cards from the module registry, so a new module appears
there automatically with its description and links; it gets counts of its own
when someone writes a summary for it.

---

## Vouchers

| Screen | What it's for |
|---|---|
| **Generate** | Set an internal note, switch on whichever fields are already known, press Generate. A live preview shows exactly what will print. |
| **Pending** | Everything generated but not yet uploaded, oldest first, with how long each has been waiting. |
| **History** | Every voucher ever issued. Search by number, recipient, internal note or description; filter by status, date range and amount. |
| **History → Deleted** | Anything deleted, with a Restore button on each row. |

The lifecycle is: **Generate** → print → sign in person → scan → **Upload** →
*Completed*. The Pending list exists so nothing gets stranded halfway.

### Printed vs. handwritten

Seven fields have an independent ON/OFF switch:

- Description, Amount Paid, Recipient Name, Phone Number, Voucher Date,
  Authorized Person Name, Authorized Person Date

**ON** prints the typed value. **OFF** prints a blank ruled line to fill in by
hand at signing time. Typing into a switched-off field turns it on for you.

Two things are never toggled, because they are the point of the document:
**Payment Method** and **both signatures** are always handwritten.

`Amount in Words` is not a separate field — it is generated from the amount
using South Asian numbering, so `1250000` prints as *Twelve Lakh Fifty Thousand
Rupees Only*.

`Internal Note` and `Printed Description` are deliberately separate. The note is
private shorthand for searching later and never appears on the voucher; the
description prints on the signed document.

---

## Purchase orders

| Screen | What it's for |
|---|---|
| **New PO** | The editor. Vendor, dates, terms, line items, tax, notes. A live preview shows every page exactly as it will print. |
| **Open** | Drafts and orders still out with a vendor, most urgent first — anything overdue on delivery leads. Shows the value outstanding per currency. |
| **History** | Every order ever raised. Search by number, vendor, subject or internal note; filter by status, date range and total. |
| **History → Deleted** | Anything deleted, with a Restore button on each row. |

The lifecycle is short on purpose:

```
Draft ──▶ Issued ──▶ Closed          (closed by filing the invoice)
             └────▶ Cancelled
```

Every transition can be reversed. A one-operator tool has nobody to appeal to
when a status is set by mistake, so being able to put it back is worth more than
a state machine that refuses.

**Create & issue** does both in one press, so the PDF comes out without a DRAFT
watermark and is ready to send. **Save as draft** stops short of that; a draft's
PDF is stamped *DRAFT*, and a cancelled order's is stamped *CANCELLED*, because
the vendor may already hold a copy of either.

### Closing an order: file the invoice

When the equipment arrives, photograph or scan the vendor's invoice and upload
it on the order's page. **That closes the order** — one action, not two things
to remember.

This works because of what the portal is used to buy. For bulk materials the
delivery note and the invoice are separate documents arriving at separate times,
and closing needs a goods-receipt step of its own. For a laptop or a monitor the
invoice comes *with* the item: it is the delivery document, the proof the order
was fulfilled, and — long after the order is closed — the warranty record.

Three loose ends are handled:

- **Paid in advance, not yet delivered?** The invoice can arrive before the
  goods do. Uploading it still closes the order, and **Reopen** puts it back.
- **Closed without an invoice?** Both the order page and the lists flag it, so
  an order can't quietly be marked done on a verbal say-so.
- **Wrong file uploaded?** Removing it reopens the order and deletes the file.

Cancelled orders are the one exception: filing an invoice against one attaches
the document but leaves the status alone. Reviving a cancelled order should be a
decision, not a side effect of filing paperwork.

### Editing an issued order

An issued PO stays editable, and saving re-renders its PDF in place. Two things
protect you from that:

- If a render was interrupted, the order page warns *"The PDF on file is older
  than this order"* and offers **Re-render PDF** instead of Print, so a stale
  file can't be sent by accident.
- The PDF URL is versioned by its render time, so a browser that already
  downloaded the old one does not serve it from cache.

That warning is deliberately narrow. It fires when the *printed page* would
differ — an edit, or a status change that adds or removes a watermark — and not
when something merely happened to the record. Filing an invoice or closing an
order leaves the document byte-identical, so it stays marked current. A warning
that cried wolf on every action is one the operator would learn to click past.

### Vendors

There is no vendor directory to maintain. Typing a vendor name suggests every
vendor previously ordered from, with how many orders each has; picking one fills
in the address, contact, phone and tax number from the most recent order. Typing
a name that isn't there is how a vendor gets added.

### Money

Currency, tax label, tax rate and whether tax shows at all are **per company**,
set in **Settings → Purchase order defaults**, and can be overridden on any
individual order. PKR, SAR, AED, USD, EUR and GBP are supported.

The amount in words follows the currency: PKR counts in Lakh and Crore and says
*Rupees*; SAR counts in Millions and says *Riyals*.

Line totals, tax and the grand total are computed in exactly one place
(`src/lib/po/totals.ts`), so the figure the operator saw while typing is the
figure on the PDF and the figure History filters on.

### Pages

A purchase order is as long as it needs to be. Line items flow across pages,
each continuation page repeats the table header and the PO number, and the
footer numbers them *Page 2 of 3*.

The closing block — totals, amount in words, notes, terms, signatures — is never
split across a fold: a signature line separated from its totals is not a
document anyone should sign. If it doesn't fit under the last row it moves to
the next page, and line items are pulled forward with it so the last two pages
end up evenly filled rather than one of them nearly blank.

---

## Uploads

Scans and invoices are photographed far more often than they are scanned, and a
phone camera produces 3–12 MB per shot. A serverless function will not accept a
request body over 4.5 MB, so a straight upload of a phone photo fails outright.

The browser therefore re-encodes photographs before sending them: 2400px on the
long edge — roughly 200 dpi across a page — dropping quality in steps until the
result is under 3 MB. A 9.6 MB photo lands around 400 KB, and the shrink is
reported under the button so nothing happens silently.

This is best-effort by design. A format the browser can't decode (HEIC outside
Safari) falls through unchanged rather than throwing, and the size is then
checked in the browser *and* on the server, so the failure that reaches the
operator is a sentence about rescanning rather than a platform error page.

PDFs can't be re-encoded here, so a scanner set to 600 dpi will be refused with
an explanation. Photograph the document instead — it is both smaller and, for a
document you only need to be able to read later, entirely sufficient.

**The 4 MB ceiling is the platform, not a preference.** Raising it in the config
would only move the failure to Vercel's own limit, where the message is worse.

## When a module isn't set up

Adding purchase orders added two tables, and on a deployment where the migration
hasn't been run every query against them fails. The first version of this let
that take down the *whole portal*, vouchers included, because the workspace
header draws a purchase-order count on every page.

That was the wrong shape. Reads that only feed a badge now tolerate a missing
table, and the module's own screens detect it and print what to run. Vouchers
keep working regardless.

The tolerance is narrow on purpose (`src/lib/db/resilience.ts`): only "that
table does not exist" is treated as unavailability. A permissions problem, a
network failure or a missing *column* still surfaces as an error, because a
broken deployment quietly showing zeroes is worse than one that crashes.

## Requests for quotation

| Screen | What it's for |
|---|---|
| **New request** | The editor. What you want, how much of it, when replies are due. A live preview shows every page as it will print. |
| **Open** | Drafts and requests still out with vendors, soonest deadline first. |
| **History** | Every request ever raised, searchable by number, subject or internal note. |

A purchase order states the prices. A request for quotation is the opposite: the
**Unit Price and Amount columns print as empty ruled boxes**, tinted so it is
obvious they are to be written into, with a blank totals box headed *"to be
completed by the vendor"*. There is nothing to add up, and no money is stored.

**There is no vendor on the record.** One generic request is produced and you send
it to whoever you like, by whatever means you already use. That is a deliberate
limit, not an oversight — addressing a request per vendor, recording who replied,
and comparing quotes side by side are three separate features, and none of them
are half-built here.

The signature block is inverted from a purchase order's: the **vendor** signs this
one, so their side is ruled blank lines for company, name, signature and date,
while ours just states who requested it.

The lifecycle mirrors purchase orders — `Draft → Sent → Closed`, plus
`Cancelled`, every transition reversible — and so do the details that matter: the
PDF is stamped *DRAFT* until it is marked sent, editing re-renders it in place,
and the "PDF on file is older than this request" warning only fires when the
printed page would actually differ.

Defaults live in **Settings → Quotation request defaults**: which currency to ask
vendors to quote in, how many days they get to reply, where to send the answer,
and the conditions of quoting printed at the foot.

## Document numbers

```
GR-202607-014        a voucher
GR-PO-202608-001     a purchase order
GR-RFQ-202608-001    a request for quotation
```

Company prefix, a document-type segment for anything that isn't a voucher, then
year+month and a 3-digit sequence that restarts at `001` each month. Each
sequence is counted separately per company **and** per document type.

Numbers are assigned when the record is created and are never reused or
renumbered. A unique database constraint on `(company, period, seq)` is what
enforces that, so two simultaneous creates can't collide.

## Deleting

There's a **Delete** button on every list row and on each record's own page. It
asks for confirmation first, then the record disappears from the lists and the
counts.

The row itself is kept behind the scenes, for two reasons:

- **The number stays spent.** The sequence allocator takes `MAX(seq) + 1`, so a
  genuinely removed row would let the next document reuse a number that may
  already have been printed, signed, or sent to a vendor. Deleting leaves a gap
  in the sequence instead — the same way a paper book does.
- **It's reversible.** Files are retained, so a delete pressed by mistake can be
  undone in full from **History → Deleted → Restore**. There are no backups
  behind this tool, so an irreversible delete would be a poor trade.

If you ever do need to purge a record and its files outright, that isn't in the
UI by design — say the word and I'll add it as an explicit second step on the
Deleted view.

---

## Deploying it

Local mode is fine for generating and printing, but the scan step usually
happens away from the main computer. For that, the portal needs to be hosted.

Deploys to Vercel as-is — there is no Chromium to work around, because the PDFs
are rendered in the operator's browser. See [PDF rendering](#pdf-rendering).

1. Create a Supabase project.

2. Run [`supabase/migration.sql`](supabase/migration.sql) in the SQL editor. It
   creates all five tables and a **private** `vouchers` storage bucket. Safe to
   re-run, and re-running is how an existing project picks up new tables and
   columns.

3. Copy the **secret** API key from **Project Settings → API keys** and put it
   in `.env` along with the project URL:

   ```
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ```

   Supabase issues `sb_secret_…` / `sb_publishable_…` keys now; the older
   `service_role` / `anon` JWTs still work too. Use the **secret** or
   **service_role** one.

   > The publishable/anon key will not work, by design. The tables have RLS
   > enabled with no policies, so only a secret key can read them — that's what
   > makes the data unreachable from a browser.

4. Check it before trusting it:

   ```bash
   npm run check:supabase
   ```

   This verifies the key is the right kind, the project is reachable, every
   table and the columns added after the first release exist, the bucket exists
   and is private, and that a file can be written and read back. Each failure
   tells you the fix.

5. Set `BACKEND=supabase` and restart.

Nothing else changes — the same code runs against either backend.

**Keep the secret key secret.** It bypasses RLS. It is only ever read in server
code and is never sent to the browser, so keep it out of any `NEXT_PUBLIC_*`
variable. If it leaks, rotate it in the dashboard.

`SUPABASE_SERVICE_KEY` is accepted as an alias for `SUPABASE_SECRET_KEY`, so an
existing deployment doesn't need renaming.

Files are always served through the portal's own `/api/file/…` route rather than
a public bucket URL, so a stored document or scan can't be read without a valid
session — in either backend.

### PDF rendering

Documents are rendered to PDF **in the operator's browser**, not on the server.

That is a deliberate choice driven by the voucher's Urdu. The acknowledgment
paragraph is Nastaliq, which needs real OpenType shaping — contextual joining,
mark positioning, ligature substitution. The JavaScript PDF libraries don't
implement it and would emit disconnected, unreadable letterforms. So a browser
has to do the shaping, and rather than deploy Chromium to do it, the portal uses
the browser that is already open in front of the operator:

```
document HTML  →  SVG <foreignObject>  →  <img>  →  <canvas>  →  JPEG  →  PDF
                  (browser lays out            (288 dpi)      (one page
                   and shapes the text)                        per sheet)
```

The server only ever hands over the pages as SVG (`/api/voucher/[id]/sheet`,
`/api/po/[id]/sheet`) and takes back the finished PDF. Consequences:

- **Nothing to install and nothing to keep pinned.** No Chromium in the bundle,
  no `@sparticuz/chromium`, no cold-start penalty. Runs on Vercel's free tier.
- **The PDF text is an image**, at 288 dpi (2448×3168 per Letter page, ~400–500
  KB). It prints indistinguishably from vector; you just can't select text in
  it.
- **Generation is two steps.** The server assigns the number, then the browser
  renders. If the render fails the record still exists — its page says so and
  offers **Render PDF** to retry, which rebuilds from the stored values.

Purchase orders take the same path, one SVG per page, rasterised one at a time
so a phone never holds several 2448×3168 canvases at once. Two limits shape how:

- **Pages are fetched one per request.** Each inlines the whole font family and
  weighs about 1.2 MB, so returning them together overran the response limit on
  anything past three pages — working perfectly in development and failing in
  production, which is the worst way for a limit to be discovered.
- **Long orders render at lower resolution.** The finished PDF is posted back in
  one request. At 288 dpi a page costs ~570 KB, so past about seven pages it
  could not be saved at all; orders of 4–8 pages drop to 240 dpi and longer ones
  to 192. Ordinary one-to-three page orders keep the full 288.

Two implementation details that are load-bearing, and were both found by testing
rather than by reading the spec:

- The CSS inside the SVG is wrapped in `CDATA`. SVG is XML, so a `<style>` body
  is parsed as markup — a child selector, a stray `&`, or an angle bracket in a
  CSS comment silently breaks the whole render.
- The SVG is handed to the `<img>` as a **`data:` URI, not a `blob:` URL**.
  Chrome treats an SVG drawn from a blob URL as tainting the canvas, so
  `toBlob()` then fails with a `SecurityError`.

Fonts are bundled in `public/fonts` (Poppins and Noto Nastaliq Urdu, both OFL)
and inlined into the SVG, so output is identical on any machine. A purchase
order asks for the Latin set only, which keeps 920 KB of Nastaliq out of every
page it renders. Century Gothic is used when present; Poppins stands in
otherwise, being the closest freely redistributable geometric sans.

### Why the purchase order paginates on the server

Page breaks have to be decided before the browser lays anything out, so the
heights of the fixed blocks are stated as constants in `src/lib/po/template.ts`
and a line-item row's height is estimated from how many lines its description
will wrap to. Every constant there was measured from the real rendered CSS, and
the wrap estimate is deliberately conservative: guessing one line too many costs
a little white space, guessing one too few would run a row off the bottom edge.

**If you change that CSS, re-measure.** The constants and the stylesheet are one
mechanism split across two places, which is the price of not shipping a layout
engine.

---

## The icon

`src/app/icon.svg` and `src/app/apple-icon.png` — Next picks both up by file
convention, so there is no link tag to maintain.

One mark for the whole portal rather than one per company: a favicon is the
site's identity, and swapping it per workspace would make the same tab look like
two different tools. The warm band in it is the voucher's own amount block, so
it is a small picture of the real document rather than a generic page glyph.

It was drawn for **16px** and checked at 16, 20, 24, 32 and 48 before being
chosen over three other attempts — at tab size the sheet has to fill most of the
tile, two marks inside is the limit before the third becomes a smudge, and
nothing thinner than about 5% of the height survives. The Apple icon is the same
artwork with square corners, because iOS applies its own rounded mask and a
rounded tile inside that gives you corners inside corners.

## Adding a third company

Add one entry to `COMPANIES` in `src/lib/companies.ts` — name, prefix, logo
path, brand colours and the acknowledgment wording — and drop the logo into
`public/logos`. Numbering, history, pending list, settings and both document
templates all follow from it; no other file needs to change.

The purchase order masthead sizes the logo by height, so any aspect ratio fits.
The voucher reproduces each company's approved DOCX layout, so for a new
company's voucher template, provide an **editable source** (DOCX or the original
design file), not a flattened PDF — the Green Rock and Sportech layouts in
`src/lib/template.ts` were reconstructed from their DOCX sources, which is
possible because the structure and exact measurements are still in there. A
flattened PDF has no such structure to work from.

## Adding a module

The portal is built to grow. A new module — delivery notes, invoices, a plant
register — is:

1. An entry in `MODULES` in `src/lib/modules.ts`, which draws the nav.
2. Pages under `src/app/[company]/<segment>/`. A card on the workspace Overview
   appears on its own; add a `summaries` entry there when it has counts worth
   showing.
3. An interface in `src/lib/db/types.ts` and a section in each backend. The
   compiler names every method a backend is still missing.
4. Optionally a section in `CompanySettings` (`src/lib/settings.ts`) — settings
   are one JSON document per company, so that costs no schema change.

Nothing existing has to be touched.

---

## Layout of the code

```
src/
  lib/
    companies.ts     per-company brand, wording and numbering config
    modules.ts       which modules a workspace has, and their tabs
    settings.ts      per-company editable defaults, and their validation
    money.ts         currencies, formatting, and amounts written out in words
    format.ts        dates, timestamps, "3 days overdue"
    doc-assets.ts    bundled fonts and logos, and the SVG page wrapper
    template.ts      the voucher — HTML/CSS, plus its SVG
    po/
      types.ts       the purchase order domain model
      totals.ts      line amounts, tax and the grand total — the only copy
      template.ts    the purchase order, its CSS, and the paginator
      parse.ts       untrusted payload → a document, or a refusal
      actions.ts     server actions: create, save, status, settings
    rfq/
      types.ts       the quotation-request domain model
      template.ts    the request, its CSS, and its own measured paginator
      parse.ts       as po/parse.ts, sharing its text validation
      actions.ts     server actions
    client-pdf.ts    browser-side SVG → canvas → JPEG → PDF
    image-pdf.ts     minimal multi-page PDF writer (no dependencies)
    use-sheet-pdf.ts the render-and-file hook both document types use
    amount-words.ts  the voucher's PKR wording, on top of money.ts
    actions.ts       voucher server actions
    auth.ts          the password gate
    uploads.ts       the one whitelist and size limit for scanned uploads
    storage.ts       file storage — local disk or Supabase Storage
    db/
      types.ts       the Store interface, one section per module
      shared.ts      numbering, row mapping, vendor rollup
      sqlite.ts      local backend
      supabase.ts    hosted backend
  app/               screens (Next.js App Router)
  components/        forms, toggles, previews, upload
```

Each document's preview and its PDF are rendered from the same function, so what
the operator sees while typing cannot drift from what prints.
