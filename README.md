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
separate history, separate settings. **Expenditure** is the one screen that spans
both, because one person runs them and sometimes needs the combined figure.

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

The password comes first. Every address in the portal, `/` included, sends you to
the lock screen until you are through it, and unlocking lands on the **company
picker** — so the order is one password, then one choice, then work. It used to be
the other way round on the first screen, which meant picking a company, being
asked for the password, arriving back at the picker and picking the same company
again.

Every header carries the **time and the date**, next to the theme control and
Lock. In the header because that is the part of the screen that does not scroll
away, and on every screen rather than only the one you arrive at — a clock is
worth having when you look up, not when you happen to be on the right page.

It is there because nearly everything in the portal is dated: a new voucher
arrives with today already in the date field, and the number it is about to be
given has today's month inside it. The clock shown is the one the portal dates
documents by — see [Where "today" comes from](#where-today-comes-from) — so if a
deployment's timezone is wrong, it says so up there rather than in a number
nobody can change afterwards. On a narrow screen the weekday and the year drop
off; the day and month, which are what a document carries, stay at every width.

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

Two things sit **outside** any workspace, on the right of the first row and on
the company picker: **Food**, whose entries belong to neither company, and
**Expenditure**, whose point is the combined figure.

Left of the clock is the **weather**, and it is off until you ask for it. The
portal cannot know where a laptop is and does not guess: press the pin once, the
browser asks whether to share the location, and from then on the header carries
the temperature and a glyph for the sky. The answer is remembered in that browser,
so it is asked once rather than daily; pressing it again re-asks, which is also how
you correct it — a laptop without GPS is placed by Wi-Fi and is usually right to
the city and occasionally somewhere else entirely. Declining costs nothing, and it
shows nothing rather than an error. Hidden on a phone, where the header has no room
to spare and the phone knows the weather anyway.

The coordinates are rounded to about a kilometre before they are stored or sent,
they never leave the browser except as those rounded numbers on the way to a
temperature, and nothing about them is written to the database. Conditions come
from [Open-Meteo](https://open-meteo.com) — no key, no signup — through the
portal's own `/api/weather`, cached fifteen minutes, so the page still only ever
talks to this origin. **Note its free tier is licensed for non-commercial use.**

Beside the padlock in the top corner is the **theme control**, which steps
through three states: a monitor for *match this device*, a sun for light, a moon
for dark. It starts on the monitor, so a laptop set to dark opens the portal
dark, and it follows that machine live — including when the machine turns dark at
sunset with the tab already open. The other two override it for this browser
only, and the choice survives locking the portal. It is on the lock screen too:
whoever is looking at the screen should be able to settle this without getting
past the password first.

The lock screen drifts faint Letter-proportioned sheets up the background — the
documents the portal holds, as texture. It is the one screen that exists to be
waited on, and nothing on it is fast enough to catch the eye: a sheet takes well
over a minute to cross, which is why it can be left running. Pure CSS, so it costs
nothing and starts before any JavaScript; anyone who has asked their machine for
less movement gets the same sheets standing still.

Printed things stay printed. A voucher, an order and a scanned receipt are white
sheets with black ink on them, and they look the same in either theme — nobody is
printing these on black paper, so a preview that went dark would be a preview of
something that does not exist.

---

## Locking

The password is not asked for again while you work, and it is asked for again
sooner than it used to be. Both of those are deliberate.

The session cookie is now a **sliding 15-minute idle window**. Real use pushes it
out — clicks, keystrokes, scrolling, even moving the pointer — so the clock only
ever runs down when nobody is there. A minute before it closes, a bar appears at
the foot of the screen:

```
Locking in 23s — nothing has happened here for a while.     [ Stay unlocked ]
```

Anything at all dismisses it; the button is only there for somebody who has read
it and has nothing else to press. When the minute runs out the screen goes to the
lock, exactly as if the padlock had been pressed.

Change the window with **`PORTAL_IDLE_MINUTES`** in the environment — no deploy
needed, because the right number is a fact about the room the laptop sits in and
not about this code. It is clamped between one minute and a day.

It also became a **session cookie**: no `Max-Age`, so quitting the browser drops
it. That is the weaker of the two locks and nothing relies on it — Chrome
restores session cookies when it is set to reopen the last tabs, and on a Mac
closing the last window does not quit the browser. It costs nothing and
occasionally helps.

### Where it is actually enforced

On the server, in `verifyToken`. The timestamp is inside the signed cookie value,
so the window closes whether or not the browser cooperates, and every page and
every API route already refuses a cookie that does not verify. Turning
JavaScript off does not extend anything.

The browser's part is two things the server cannot do: it *notices* — a laptop
left open would otherwise sit on a screenful of figures looking signed-in until
somebody clicked — and it *renews*. Renewal is one route, `POST /api/session`,
and it is a route rather than something a page does for two reasons: a page
cannot write a cookie, and most of what reaches a server is not evidence of a
person. Renewing on every request would renew on prefetches and background
revalidations, and a portal that stays unlocked because a tab is open is the
thing this was built to stop. An expired session is never revived — `/api/session`
answers 401 and the browser locks.

There is nothing in the portal that polls, which is what makes silence
trustworthy: the header clock ticks in the browser off its own `setTimeout`, and
the weather is fetched once when a page loads. No traffic really does mean nobody
is home.

### The one thing to know

A tab in the background has its timers throttled by the browser, so a hidden tab
may not lock itself on the minute. It locks the instant it is looked at again —
`IdleLock` re-checks on `visibilitychange`, which is also what makes a laptop
that slept for three hours lock as the lid opens rather than after a screenful
has already been read. The cookie expired on schedule either way.

And the cost, worth stating because it can lose work: the purchase order and
quotation editors hold a lot of unsaved state in the browser. Typing counts as
being there, so this only bites if you walk away from a half-typed order — but
then it locks and that draft is gone. The minute's warning is there for exactly
that, and it is the argument against setting the window much shorter than 15
minutes.

## Search

**⌘K** (Ctrl-K on Windows), or **/**, or the box in any header. One panel over
whatever you were doing, searching **every module of both companies at once** —
vouchers, orders, quotations, miscellaneous payments, food, assets, employees,
notifications, tranches and direct entries — plus the screens themselves.

Arrows move, Enter opens, Escape closes. The first result is selected on arrival,
because the first result is usually right.

### What you can type

| | |
|---|---|
| `GR-202608-014` | a document number, however you punctuate it — `gr 202608 014` and `GR202608014` are the same query |
| `014` | just the sequence, the way you would read a number off a page |
| `ali` | a name — the payee, the vendor, the employee, whoever is holding an asset |
| `4200` | an exact amount |
| `0300-1234567` | a phone number or a CNIC, off a call log or a photocopy |
| `new voucher` | a screen, to jump straight to it |

### Why it does not behave like most site search

Two rules, and between them they are most of the difference.

**Every word has to match.** Two words narrow the results rather than widening
them. Search that quietly ORs its terms always returns *something*, which sounds
generous and is precisely what teaches you to stop reading past the first row.

**A word has to start a word.** Landing in the middle of one does not count. This
sounds pedantic until you watch what happens without it — both of these were real
results here before the rule went in:

```
"ali"     → Zainab M-ali-k
"cement"  → the New notification screen, via "announ-cement"
```

Neither is a near miss to be tuned away with weights; they are noise, and noise in
the first few results is how a search box loses its reader. The case people
imagine needing loose matching for — "generator" finding "generators" — is a
prefix and already matches. The reverse ("laptops" finding "laptop") is the one
step of stemming that exists.

Ranking then weighs *where* a word matched, not just that it did: a document
number matched whole outranks everything, a name outranks a description, and a
description outranks something buried in a notification's body. Recency only
breaks ties — the largest date bonus is worth less than a single name match, so a
September record can never outrank a March one that is a better answer.

Results are **not grouped by module**. Grouping looks tidier and reads worse: it
makes you scan five headings for one row and throws away the ranking, which is the
part that knows the answer. One list, best first, each row saying what it is.

### How it works, and when it would need rebuilding

There is **no search index, no FTS table and no migration** — deliberately, and
that is a judgement about this portal rather than a general opinion:

- The corpus is a small company's paperwork. Thousands of rows, not millions. An
  index would buy speed nobody could perceive.
- Every module already has a `search` that knows which of its own columns are
  worth matching. Reusing those means one opinion about what a voucher is
  findable by, not two that drift apart.

So a query fans out to every module in parallel, the database does a coarse filter
on the single most selective word, and `src/lib/search/types.ts` — a pure function
with no database in sight — does the ranking. Every read is wrapped in `tryTable`,
so a module that is not set up on this deployment contributes nothing and search
keeps working.

The one query shape that would need a real index first is **searching by amount**:
no module's `search` looks inside its amount column, so a bare figure is matched by
scanning the most recent few hundred rows per module rather than by filtering.
Past that horizon an old amount stops being findable. At tens of thousands of
records the whole approach wants revisiting — the same line the expenditure and
funding modules draw.

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

## Miscellaneous payments

`/<company>/misc`, under **Miscellaneous** in the workspace switcher. Money that
left the company with no document behind it: the parking fee, the courier, the
tip to the man who carried the water bottles up.

Every other spend module here is built around a piece of paper. A voucher exists
to be printed and signed; a purchase order exists to be issued to a vendor. This
one deliberately has none — no template, no PDF, no signature block, nothing to
render. **The record is the record.**

That is why it exists. Until now those payments had two possible homes, and both
were wrong: raise a voucher nobody would ever sign, which puts a permanent gap in
the voucher sequence and a fiction in the file; or leave them out of the totals
altogether, which is what was happening and is why the figures never quite
matched the bank.

A payment is three facts and an optional fourth:

| | |
|---|---|
| **Date paid** | when the money went out — not when you typed it in |
| **Amount** | and its currency, PKR unless you say otherwise |
| **What it was for** | required: it is the only description the record has |
| **Receipt** | if there is one. Often there is not. |

**A missing receipt is an ordinary state, not a task.** Roughly the point of the
module is that these payments frequently have no paperwork, so nothing badges
them, nothing colours them amber, and the record screen says *"Nothing on file.
That is fine — the payment counts either way."* The one place the question gets
asked is the log's **Without a receipt** filter, used by somebody who came
looking for it.

The receipt can be attached while logging the payment, or months later from the
record — a bill that turns up in June for a payment made in March is normal. It
can be replaced when the first photograph came out unreadable, and removed when
it was the wrong document. **Removing it never removes the payment**: the receipt
was evidence, not the reason to believe the money moved.

Unlike a food receipt, this one is never shared between records — one payment,
one document — so removing it deletes the file outright, with no reference count
to check first.

### Not a way around vouchers

The shortest form in the portal is a standing temptation to use for something
that should have been signed for, so the New payment screen says so before the
form rather than after it: if somebody *can* be made to sign, raise a voucher. It
prints, it is acknowledged, and the signed copy comes back to the file.

### Company-scoped, unlike food

A lunch is genuinely ordered for both companies at once, which is why the food
log belongs to neither. A payment comes out of **one** company's account, so it
has an owner: it lives in that workspace, takes that workspace's number prefix,
and appears on that company's card under Expenditure. Reaching one company's
payment through the other's URL is a 404 rather than a redirect.

### Two tabs, not three

Every other module splits its working list from its history, because the two
answer different questions. Here they are the same question — a payment is logged
once and never moves through a lifecycle — so the log's own filters cover the
period and the recycle bin, and a History tab would be the same screen reached by
a second name.

## Food & refreshments

`/food`, reachable from the company picker and from **Food** in any workspace's
header. It replaces a four-sheet spreadsheet — `Company Lunch Expense Log.xlsx`,
still in the repo root as the original — with the log, the outstanding dashboard
and the spend report as three screens.

**It sits outside `/[company]`, and that is the whole design.** Roughly a quarter
of the entries in the sheet it replaces were ordered for *Green Rock + Sportech* —
one lunch, two companies at the table. An entry therefore has no owner, so there
is no `CompanySlug` anywhere in the module, no company column on the table, and
nothing is ever split 50/50. `Ordered for` is a **label**: it records what was
written on the order and carries no accounting meaning.

Two facts about an entry are independent, and conflating them was the flaw in the
spreadsheet:

| | |
|---|---|
| **Payment type** | who fronted the money — the vendor's tab (`Deferred`), or someone's own pocket (`Employee paid`) |
| **Status** | whether that person or vendor has been squared up yet |

The cross of the two is what the Outstanding screen is:

```
Deferred      + Pending  →  owed to a café
Employee paid + Pending  →  a reimbursement somebody is waiting on
```

They are settled by different people on different days, so they get their own
panels — and reimbursements come first even though they are usually the smaller
figure, because somebody is personally out of pocket on them.

### Pending by date

The same debts a second way, written onto the days they were ordered. The payee
panels answer *who* is owed; this answers *how far back it goes*, which they
cannot — a café owed for one order last week and eleven this month reads as a
single debt. A month grid rather than a list, because the answer is usually a
shape: every Tuesday, or the fortnight nobody was in to sign a cheque.

**One month at a time, with a step either side of its name.** It opens on this
month and goes back as far as the oldest thing owed, so "is anything still owed
from June?" is a question you can actually put to it. Months in between with
nothing owed say so and offer the nearest month that has something, rather than
drawing six blank rows; past the oldest debt the step greys out, because past
there is nothing to find.

The month is in the URL (`?month=2026-06`), so a month can be linked to and the
back button walks back through the ones already looked at.

### Settling a tab

The reason this beats the spreadsheet. A café's tab is a dozen separate orders
and one payment; in the sheet, clearing it meant editing a dozen rows by hand.
On `/food/outstanding` each payee is one form: every order ticked by default, a
payment date, an optional reference, one button.

Resubmitting that form — the browser-back-then-refresh everyone eventually does —
settles nothing twice. The update carries `status = 'pending'` in its `WHERE`
clause, so an entry already paid last week cannot have today's date stamped over
it. The banner reports how many rows actually changed, which is `0` on a
resubmit.

Unticking is for the one order that never arrived, so a partial settlement takes
an explicit act and a full one takes none. The button reads *Settle ticked*
rather than an amount: without client JavaScript a figure on the button could not
follow the checkboxes, and one reading ₨32,970 after unticking half the list
would be a lie. The total to check against sits in the panel header.

### The report

`/food/report` is total-to-date plus any date range, both bounds inclusive —
matching the `SUMIFS` it replaces, so 14–31 July counts both the 14th and the
31st. Breakdowns are by vendor and by the *ordered for* label; neither is a cost
allocation, and a shared lunch appears whole under `Green Rock + Sportech`.

Every entry counts towards spend whether settled or not: the food was eaten, so
the expense was incurred. What is still owed is a separate question, answered on
Outstanding.

### Numbers

```
F-202608-001         a food entry
```

The only number in the portal with no company prefix, because the entry has no
company to take one from. The sequence restarts each month, like vouchers and
orders and unlike assets.

### Importing the spreadsheet

One-off, and already done:

```bash
node --env-file=.env scripts/import-food.mjs        # add --force to append
```

It reads `scripts/food-seed.json` — a committed, reviewable extract of the
workbook's `Lunch_Log` table — rather than the `.xlsx`, so a script that runs
once does not leave a permanent `xlsx` dependency behind. It refuses to run
against a table that already has rows, and it checks its own arithmetic against
the workbook's totals at the end:

```
ok    entries            40
ok    spentAllTime       119038
ok    totalOutstanding   32970
ok    owedToVendors      32970
ok    owedToEmployees    0
ok    paidWithDate       30
ok    paidWithoutDate    0
```

Text is verbatim, typos included: this is a record of what was written, not an
opportunity to rewrite it.

### Payment dates

The sheet filled its `Payment Date` column on only **2 of 40 rows**, while
marking 30 as paid. **A settled entry always carries a date here**, so where the
sheet had one it wins, and for the other 28 the order date stands in.

The same fallback is the app's rule, not just the import's — `foodColumns` in
`src/lib/db/shared.ts` applies it to every write, so an entry saved as Paid with
the date field left empty gets the order date rather than a blank. The settle
flow supplies a real payment date, so in practice this only catches the edit
form.

Worth knowing when reading old figures: for those 28 rows the payment date is
the day the food was ordered, not the day the café was actually settled — which
was in batches, some weeks later. It is a stand-in that keeps the column
complete, not a record of when money moved.

## Expenditure

`/spend`, reachable from the company picker and from **Expenditure** in any
workspace's header. Both companies together, each on its own underneath, filtered
to all time, this year or this month.

The report refuses to give you one blended number, and that is the whole point of
it:

```
Vouchers                       PKR   246,000     money that has left, signed for
Purchase orders                PKR 1,910,420     promised to a vendor
Miscellaneous                  PKR    14,310     money that has left, unsigned
Food & refreshments            PKR   119,038     eaten, settled or not
─────────────────────────────────────────────
Combined                       PKR 2,289,768
Draft orders, not counted      PKR    69,384     promised to nobody yet
```

The lines carry the document names alone. What each one *means* is the note in
the right-hand column above, which belongs in this README rather than printed
beside every figure on the screen.

A voucher is money someone has signed for. A purchase order is money committed
that may not have been paid. A miscellaneous payment is money that has left with
nobody signing for it. Food is a fourth claim and none of those: the money may
not have moved, but the food was eaten, so the expense was incurred. Adding them
without saying so would produce a confident figure meaning four different things,
so they get their own lines and are combined only after.

Miscellaneous stays off the voucher line for a reason worth stating: the voucher
figure is worth reading precisely because a signature sits behind every rupee of
it, and folding the unsigned payments in would quietly cost it that meaning.

**Food appears only in the combined figure**, never on the two company cards — it
belongs to neither. It does get its own row under *Split by company*, so the
breakdown still adds up to Combined; a total that cannot be checked against its
parts is the one thing this page must not be.

What is left out, and why:

- **Drafts** are shown but excluded — nothing has been promised to a vendor yet.
- **Cancelled orders** are excluded, and the count is stated so the omission is
  visible rather than silent.
- **Deleted** records of any kind are excluded.
- **Currencies are never added together.** A PKR total and an SAR total are
  reported side by side, because a single number spanning both would look
  authoritative and mean nothing.

And the gaps worth knowing about. A voucher whose amount was **left blank to be
written by hand** has no figure to count. The report says so — *"1 of 6 vouchers
had the amount left blank"* — because a total that quietly omits some of your
spending is worse than one that admits what it is missing.

The other is stated the same way and means something different: *"4 of 5
miscellaneous payments have no receipt on file"*. Those **are** counted, in full.
It is a gap in the evidence, not in the total — the money left whether or not a
document came back with it, and holding those rows back would understate spend,
which is the one direction these figures must not fail in.

Figures are added up in the application rather than the database. PostgREST
cannot `GROUP BY` without a stored function, and adding one would mean another
migration to remember; at the scale of a small company's paperwork, selecting
five columns and summing them costs nothing. It would need revisiting at tens of
thousands of records.

### What it went on — tags

The four lines above answer *how much*, split by the kind of claim behind it.
They cannot answer the question anybody asks first — **how much have we spent on
laptops** — because that is not a fact about a purchase order. One order buys a
laptop, a bag and three cables, and the order's total is the only figure stored
against it.

So the unit is the **line item**. Every priced row of every issued or closed
purchase order gets a tag, and `/spend` grows a panel:

```
What it went on                                    All time, both companies

  Laptops           3 lines                            PKR   679,462
  ██████████████████████████████████
  Phones            2 lines                            PKR   629,928
  ███████████████████████████████
  Office furniture  1 line                             PKR   216,450
  ██████████
  Stationery        3 lines                            PKR    74,084.40
  ███
  Untagged          1 line                             PKR   229,320
  ███████████
  ────────────────────────────────────────────────────────────────────
  Purchase orders                                      PKR 1,829,244.40
```

Tags are added and assigned on **`/spend/tags`**, reached from *Assign tags*
beside *Create report*. That screen keeps the vocabulary — add, rename, delete —
and lists every line item grouped under its order, each with a dropdown. It is
all-time and unfiltered by period on purpose: tagging is a job that gets
finished, not a period that gets reported, and a range filter there would hide
the oldest untagged rows behind a control nobody would think to change.

Five things decide what the figures mean, and each is the reason a number here
cannot be read two ways:

- **One tag per line.** Two would count the same money twice, and the breakdown
  would add up to more than was spent.
- **Issued and closed orders only** — exactly what the *Purchase orders* line
  above counts. A draft is promised to nobody and a cancelled order was never
  spent, so either would make the breakdown disagree with the figure printed
  directly above it.
- **Every line carries its share of its order's tax, shipping and discount**,
  spread by line value. For two of the three that is arithmetic rather than a
  rule: the tax *is* a percentage of the taxable value and the discount comes off
  the subtotal, so a line's share of either is exactly its share of the subtotal.
  Shipping is the one genuinely decided, and by value is the ordinary answer. The
  rounding residual goes on the largest line, so the set adds up to the order to
  the paisa. `attributedLines` in `po/totals.ts` is the only copy of this.
- **Untagged is a row, not an omission.** It is what makes the panel checkable
  against the total under it, and it doubles as the list of work left.
- **Tags are global, not per company.** The expenditure page is outside a
  workspace because the combined figure belongs to neither; "Laptops" means the
  same thing in both, and two per-company vocabularies would make the combined
  breakdown a merge of two lists free to drift apart.

**Nothing about a purchase order changed.** No column was added to
`purchase_orders`; a tag lives in `po_item_tags`, keyed on the order and the
line's own `PoItem.id` — which is a UUID the editor preserves across saves, so a
tag survives a row being inserted, removed or moved above it. The editor, the
printed PDF, the stored totals and every PO screen are exactly as they were, and
the word "tag" appears nowhere in that module.

Deleting a tag is a **hard** delete, unlike everything else in the portal: it has
no number to keep spent and was never printed on anything, so there is no history
to protect. What it will untag is stated in the confirmation, because that is the
only part not obvious from the button. A line removed from an order by a later
edit leaves its assignment behind in the table; it is keyed on an item id that no
longer exists in the document, so nothing reads it and nothing has to clean it
up.

## Document numbers

```
GR-202607-014        a voucher
GR-PO-202608-001     a purchase order
GR-RFQ-202608-001    a request for quotation
GR-A-001             an asset
GR-MP-202608-001     a miscellaneous payment
F-202608-001         a food entry
```

Company prefix, a document-type segment for anything that isn't a voucher, then
year+month and a 3-digit sequence that restarts at `001` each month. Each
sequence is counted separately per company **and** per document type.

Two exceptions, each for a reason:

- **Assets** carry no year+month. The number is written on the item itself and
  outlives the month it was bought in, so the sequence spans all time and never
  resets — a monthly restart would put two `-001` labels on two laptops.
- **Food entries** carry no company prefix. A lunch ordered for both companies
  has no company to take one from, so the sequence is keyed on the month alone.

Numbers are assigned when the record is created and are never reused or
renumbered. A unique database constraint on `(company, period, seq)` — or
`(period, seq)` for food — is what enforces that, so two simultaneous creates
can't collide.

### Where "today" comes from

One line, in `src/lib/clock.ts`:

```ts
export const PORTAL_TIMEZONE = "Asia/Karachi";
```

Every "what day is it" in the portal is answered from there — the `202608` inside
a new number, the date a new-document form arrives pre-filled with, what "this
month" means on the expenditure report, whether an order counts as overdue today,
and the clock on the company picker. Nothing asks the machine it is running on.

That is not tidiness, it is the difference between a correct number and a wrong
one. Read with `Date`'s ordinary getters, "what month is it" is answered in the
timezone of whatever host happens to be executing — the desk's own zone locally,
and **UTC** on a serverless platform, five hours behind. A voucher created at 2am
on the 1st would have been handed the previous month's number, and one created at
half past midnight on 1 January the previous *year's*, permanently, because numbers
are never reissued. Nothing on screen would have said so.

It is a constant rather than an environment variable on purpose: a number can
outlive a deployment, so there must be no way for a host to be missing this or to
disagree about it. If the desk moves, that line moves with it — a change that goes
through review, not a variable somebody has to remember to set again.

The conversion goes through `Intl`, which owns the real rules for a zone including
the daylight-saving ones, rather than arithmetic on a stored UTC offset — an offset
is only right until the day the zone changes it.

`TZ` in the environment is no longer part of this. It is still set in `.env`, so a
host's own logs and shell read in the same zone as the portal, but no date the
portal writes depends on it any more.

Stored timestamps are a separate matter and were always fine: those are instants,
written with `toISOString()` in UTC. `stamp()` reads them back at the desk's wall
clock, so a record created at half past three says half past three no matter where
the server is.

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
  undone in full from **History → Deleted → Restore** — or, on the modules whose
  list carries its own filters rather than a separate History tab (Food,
  Miscellaneous), from **Show: Deleted → Restore**. There are no backups behind
  this tool, so an irreversible delete would be a poor trade.

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

**No timezone to configure.** The zone the portal dates documents in is stated in
the code, so a deployment cannot get it wrong by omission — see
[Where "today" comes from](#where-today-comes-from). Setting `TZ=Asia/Karachi` as a
project variable is still worth doing so the host's own logs read in the same zone,
but nothing the portal writes depends on it. You can confirm the deployment agrees
by reading the clock on the company picker.

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

## Colour, and the two themes

Every colour in the interface is a CSS variable declared twice in
`src/app/globals.css` — once under `:root`, once under `html.dark` — and
`tailwind.config.ts` maps a Tailwind name onto each one. So `bg-card`,
`text-ink-soft` and `border-ink-line` are already right in both themes wherever
they are written, and **no screen carries a `dark:` variant of its own**. Adding
one would be the beginning of the drift this arrangement exists to prevent: two
places deciding what a card looks like.

| Name | What it is |
| --- | --- |
| `page` | the background behind everything |
| `card` | a surface raised off it |
| `wash-soft` / `wash` / `wash-strong` | a panel set into a card, a filled quiet block, a hover |
| `ink` / `ink-soft` | type, and secondary type |
| `ink-line` / `ink-rule` | a hairline, and a rule meant to be seen |
| `amber-*` / `red-*` / `emerald-*` | pending, trouble, done — on Tailwind's own scale names |

The status scales are **mirrored** rather than replaced: in the dark theme the
low steps become tinted darks and the high steps tinted lights, which is what
lets every existing `bg-amber-100 text-amber-900` pair keep working with its
contrast the right way up. Only the steps in use are redefined, so reaching for a
new one means adding both halves to `globals.css` first — otherwise it silently
keeps its light value in the dark theme.

Four things do not come from that scale, and each has a reason:

- **`.accent-scope`** resolves a company's accent. The workspace shell hands down
  both of its accents and CSS picks one, because a server component cannot know
  which theme is in force — the choice is settled in the browser before paint.
- **`.swatch` / `.swatch-top`** do the same for a colour that comes from data
  rather than from the scale: a brand on a legend dot, the stripe along a
  company's card. Set `--swatch` and `--swatch-dark` on the element.
- **`.on-paper`** pins the whole scale back to its light values, for anything
  drawn on a document preview. That is why the "Updating…" badge on a voucher
  preview is grey on white in both themes rather than pale grey on white.
- **`.badge-on-accent`** mixes its fill from the accent's own text colour, so a
  count on a pill darkens a light accent and lightens a dark one without being
  told which it has.

The theme itself lives in `src/lib/theme.ts` and one control,
`src/components/ThemeToggle.tsx`. The choice is in `localStorage`, applied by a
small inline script in the document head — **before first paint**, which is the
whole point: corrected any later and every navigation would flash light. That
script is a longhand copy of `applyTheme` on purpose, because it has to run
before any bundle has loaded. `color-scheme` is set alongside the class, which is
what makes the date pickers, select menus and scrollbars go dark too.

## Adding a third company

Add one entry to `COMPANIES` in `src/lib/companies.ts` — name, prefix, logo
path, brand colours and the acknowledgment wording — and drop the logo into
`public/logos`. Numbering, history, pending list, settings and both document
templates all follow from it; no other file needs to change.

The theme block wants **six** web colours, not three: `ui` / `uiText` / `uiWash`
for the light theme and `uiDark` / `uiTextDark` / `uiWashDark` for the dark one.
Both are asked for because neither existing brand survives being shifted by a
formula — a brand colour chosen to be the darkest thing on white paper is either
muddy or invisible on a near-black page. Pick the dark trio by eye: something
recognisably the same colour, light enough to read as a button fill against
`--card`, with `uiTextDark` dark enough to read *on* it. Sportech is the useful
precedent — its night accent is the acid yellow that is its daytime *text*
colour, with the black moving to the label.

A company in a different country would also need `PORTAL_TIMEZONE` thinking about
— it is one zone for the whole portal, on the assumption that one desk files for
both companies. Two desks in two zones would mean moving that constant onto the
company, and `periodOf` taking a slug.

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

Nothing existing has to be touched — *unless the module records money*, which is
the one case that reaches outside itself, in **two** directions. Miscellaneous
payments is the worked example, and it is worth following because the first
attempt did only half of this and shipped a module that silently under-reported.

**Expenditure**, so the money counts:

- rows in `spendRows`, in both backends
- a `kind` and a line in `src/lib/spend/types.ts`
- a section in `src/lib/spend/report.ts`
- its line on `/spend` and in the printed report

**Funding**, so the money can be attributed to a tranche:

- a value in `SourceKind` and its two label maps (`src/lib/tranches/types.ts`),
  plus the `byKind` seed in `stand()`
- a branch in `allocatable()` in both backends, and in `assembleAllocatable`
- a colour in `KIND_SWATCH` (`src/components/DrawdownBar.tsx`)
- a case in `sourceHref` on the tranche page
- **the `source_kind` check constraint in `supabase/migration.sql`** — SQLite has
  no such constraint, so forgetting this one works locally and fails only on the
  live site, only when somebody first tries to allocate

Skip any of the first group and the module works perfectly while quietly not
counting. Skip any of the second and the money is counted but can never be
traced to the pot it came out of.

### …that belongs to no company

Food is the worked example, and `src/app/food/` is the template. A section whose
records belong to neither workspace differs in five ways:

1. **Not in `MODULES`.** That registry is for `/[company]/…`; an entry there
   would nest the section under a workspace, which is the thing to avoid. Add a
   card on `src/app/page.tsx` and a link beside **Expenditure** in
   `src/components/WorkspaceNav.tsx` instead.
2. **Its own `layout.tsx`** does the `isAuthenticated()` guard once and supplies
   the header and tabs, because there is no `WorkspaceNav` outside `/[company]`.
   It does **not** set `--accent`: outside a workspace there is no company theme
   to inherit, and the portal's own accent is already stated in `globals.css` for
   both themes. Restating it in a layout restates only the light half and pins
   the section to it.
3. **No `CompanySlug` in the store interface**, no company column on the table.
   Leaving one in is how a shared record ends up arbitrarily assigned to one
   workspace.
4. **Numbering** cannot use `formatDocNo`, whose first argument is a
   `CompanySlug`. Write a sibling in `src/lib/db/shared.ts`.
5. **Check `next.config.ts`.** The legacy voucher redirects are pinned to the
   real company slugs precisely because an unpinned `/:company/new` also matches
   `/food/new` — a new top-level section with a two-segment page would otherwise
   be silently redirected into a page that does not exist. Add the slug list
   there if you add a company.

---

## Layout of the code

```
src/
  lib/
    companies.ts     per-company brand, wording and numbering config
    modules.ts       which modules a workspace has, and their tabs
    settings.ts      per-company editable defaults, and their validation
    money.ts         currencies, formatting, and amounts written out in words
    clock.ts         the zone the portal keeps time in — the only place today is decided
    weather.ts       WMO codes → the seven conditions the header draws
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
    food/
      types.ts       the food domain model, and the SUMIFS the sheet used to do
      actions.ts     server actions, including the batch settle
    misc/
      types.ts       miscellaneous payments — the module with no document
      actions.ts     server actions: log, correct, attach or remove the receipt
    spend/
      types.ts       expenditure roll-up — the only place totals are decided
      report.ts      the detail behind the figures, assembled for printing
      tags.ts        what the money went on — the line-item roll-up
      tag-actions.ts server actions: add, rename, delete a tag; tag a line
    search/
      types.ts       what a hit is, and the ranking — a pure function, no database
      run.ts         the fan-out across every module, and how it degrades
      destinations.ts  the screens, searchable alongside the records
    client-pdf.ts    browser-side SVG → canvas → JPEG → PDF
    image-pdf.ts     minimal multi-page PDF writer (no dependencies)
    use-sheet-pdf.ts the render-and-file hook both document types use
    amount-words.ts  the voucher's PKR wording, on top of money.ts
    actions.ts       voucher server actions
    auth.ts          the password gate, and the sliding idle window
    theme.ts         the light/dark choice, and the script that applies it
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
