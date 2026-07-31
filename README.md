# Payment Acknowledgment Voucher Portal

A single-operator web portal for Green Rock and Sportech. It generates numbered,
company-branded voucher PDFs, tracks which ones are still waiting on a physical
signature, and keeps the signed scans in a searchable permanent record.

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

---

## How it works day to day

| Screen | What it's for |
|---|---|
| **Landing** | Pick a company. The two workspaces share nothing — separate numbering, history, signatories. |
| **Generate** | Set an internal note, switch on whichever fields are already known, press Generate. A live preview shows exactly what will print. |
| **Pending** | Everything generated but not yet uploaded, oldest first, with how long each has been waiting. |
| **History** | Every voucher ever issued. Search by number, recipient, internal note or description; filter by status, date range and amount. |
| **History → Deleted** | Anything deleted, with a Restore button on each row. |
| **Settings** | The company's saved Authorized Signatory names. |

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

### Voucher numbers

`GR-202607-014` — company prefix, year+month, then a 3-digit sequence that
restarts at `001` each month, counted separately per company. Numbers are
assigned when the voucher is generated and are never reused or renumbered. A
unique database constraint on `(company, period, seq)` is what enforces that,
so two simultaneous generates can't collide.

### Deleting a voucher

There's a **Delete** button on each row in Pending and History, and on the
voucher's own page. It asks for confirmation first, then the voucher disappears
from Pending, History and the counts.

The record itself is kept behind the scenes, for two reasons:

- **The number stays spent.** The sequence allocator takes `MAX(seq) + 1`, so a
  genuinely removed row would let the next voucher reuse a number that may
  already have been printed and signed. Deleting leaves a gap in the sequence
  instead — the same way a paper voucher book does.
- **It's reversible.** Both files are retained, so a delete pressed by mistake
  can be undone in full from **History → Deleted → Restore**. There are no
  backups behind this tool, so an irreversible delete would be a poor trade.

If you ever do need to purge a record and its files outright, that isn't in the
UI by design — say the word and I'll add it as an explicit second step on the
Deleted view.

---

## Deploying it (so you can upload scans from a phone)

Local mode is fine for generating and printing, but the scan step usually
happens away from the main computer. For that, the portal needs to be hosted.

Deploys to Vercel as-is — there is no Chromium to work around, because the PDF
is rendered in the operator's browser. See [PDF rendering](#pdf-rendering).

1. Create a Supabase project.

2. Run [`supabase/migration.sql`](supabase/migration.sql) in the SQL editor. It
   creates both tables and a **private** `vouchers` storage bucket. Safe to
   re-run.

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

   This verifies the key is the right kind, the project is reachable, both
   tables and the `deleted_at` column exist, the bucket exists and is private,
   and that a file can be written and read back. Each failure tells you the fix.

5. Set `BACKEND=supabase` and restart.

Nothing else changes — the same code runs against either backend.

**Keep the secret key secret.** It bypasses RLS. It is only ever read in server
code and is never sent to the browser, so keep it out of any `NEXT_PUBLIC_*`
variable. If it leaks, rotate it in the dashboard.

`SUPABASE_SERVICE_KEY` is accepted as an alias for `SUPABASE_SECRET_KEY`, so an
existing deployment doesn't need renaming.

Files are always served through the portal's own `/api/file/…` route rather than
a public bucket URL, so a stored voucher or scan can't be read without a valid
session — in either backend.

### PDF rendering

Vouchers are rendered to PDF **in the operator's browser**, not on the server.

That is a deliberate choice driven by the Urdu. The acknowledgment paragraph is
Nastaliq, which needs real OpenType shaping — contextual joining, mark
positioning, ligature substitution. The JavaScript PDF libraries don't implement
it and would emit disconnected, unreadable letterforms. So a browser has to do
the shaping, and rather than deploy Chromium to do it, the portal uses the
browser that is already open in front of the operator:

```
voucher HTML  →  SVG <foreignObject>  →  <img>  →  <canvas>  →  JPEG  →  PDF
                 (browser lays out             (288 dpi)      (one page,
                  and shapes the text)                         Letter)
```

The server only ever hands over the page as an SVG (`/api/voucher/[id]/sheet`)
and takes back the finished PDF (`POST /api/voucher/[id]/pdf`). Consequences:

- **Nothing to install and nothing to keep pinned.** No Chromium in the bundle,
  no `@sparticuz/chromium`, no cold-start penalty. Runs on Vercel's free tier.
- **The PDF text is an image**, at 288 dpi (2448×3168 for Letter, ~400–500 KB).
  It prints indistinguishably from vector; you just can't select text in it.
- **Generation is two steps.** The server assigns the number, then the browser
  renders. If the render fails the voucher still exists — its page says so and
  offers **Render PDF** to retry, which rebuilds from the stored field values.

Two implementation details that are load-bearing, and were both found by testing
rather than by reading the spec:

- The CSS inside the SVG is wrapped in `CDATA`. SVG is XML, so a `<style>` body
  is parsed as markup — a child selector, a stray `&`, or an angle bracket in a
  CSS comment silently breaks the whole render.
- The SVG is handed to the `<img>` as a **`data:` URI, not a `blob:` URL**.
  Chrome treats an SVG drawn from a blob URL as tainting the canvas, so
  `toBlob()` then fails with a `SecurityError`.

Fonts are bundled in `public/fonts` (Poppins and Noto Nastaliq Urdu, both OFL)
and inlined into the SVG, so output is identical on any machine. Century Gothic
is used when present; Poppins stands in otherwise, being the closest freely
redistributable geometric sans.

---

## Adding a third company

Add one entry to `COMPANIES` in `src/lib/companies.ts` — name, prefix, logo
path, brand colours and the acknowledgment wording — and drop the logo into
`public/logos`. Numbering, history, pending list, settings and the voucher
template all follow from it; no other file needs to change.

For a new company's template, provide an **editable source** (DOCX or the
original design file), not a flattened PDF. The Green Rock and Sportech layouts
in `src/lib/template.ts` were reconstructed from their DOCX sources, which is
possible because the structure and exact measurements are still in there. A
flattened PDF has no such structure to work from.

---

## Layout of the code

```
src/
  lib/
    companies.ts     per-company brand, wording and numbering config
    template.ts      the voucher itself — HTML/CSS, plus the SVG the browser rasterises
    client-pdf.ts    browser-side SVG → canvas → JPEG → PDF
    single-image-pdf.ts  minimal one-page PDF writer (no dependencies)
    amount-words.ts  PKR amounts in South Asian numbering
    actions.ts       server actions: generate, upload, signatories
    auth.ts          the password gate
    storage.ts       file storage — local disk or Supabase Storage
    db/
      types.ts       the Store interface both backends implement
      sqlite.ts      local backend
      supabase.ts    hosted backend
  app/               screens (Next.js App Router)
  components/        form, toggles, preview, upload
```

The preview and the PDF are rendered from the same function in `template.ts`, so
what the operator sees while typing cannot drift from what prints.
