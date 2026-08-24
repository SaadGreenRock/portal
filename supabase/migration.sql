-- Green Rock Portal — Supabase schema
--
-- Run this once in the Supabase SQL editor before setting BACKEND=supabase.
-- It is safe to re-run: every statement is guarded.
--
-- Access model: the portal is a single-operator tool behind its own password
-- gate, and the server talks to Postgres with the service key. Row Level
-- Security is therefore enabled with NO permissive policies — which blocks the
-- anon and authenticated keys entirely, while the service key bypasses RLS.
-- The effect is that these tables are unreachable from a browser.

create table if not exists public.vouchers (
  id             uuid primary key,
  voucher_no     text        not null unique,
  company        text        not null,
  status         text        not null default 'pending'
                             check (status in ('pending', 'completed')),
  seq            integer     not null,
  period         text        not null,           -- yyyymm, e.g. 202607
  internal_note  text        not null default '',
  fields         jsonb       not null,
  -- Lifted out of `fields` so History can filter without deserialising rows.
  recipient_name text        not null default '',
  description    text        not null default '',
  amount         numeric,
  voucher_date   date,
  created_at     timestamptz not null default now(),
  generated_at   timestamptz,
  uploaded_at    timestamptz,
  -- Deleted vouchers keep their row so the sequence allocator (MAX(seq) + 1)
  -- can never reissue a number that has already been printed. Hidden from
  -- Pending, History and the counts; visible under History → Deleted.
  deleted_at     timestamptz,
  pdf_key        text,
  scan_key       text,
  scan_name      text,
  -- A sequence number is never handed out twice for the same company and
  -- month. This constraint, not application logic, is what guarantees it.
  constraint vouchers_company_period_seq_key unique (company, period, seq)
);

-- Applied separately so a project created before delete support picks it up.
alter table public.vouchers add column if not exists deleted_at timestamptz;

create index if not exists vouchers_company_status_idx
  on public.vouchers (company, status);

create index if not exists vouchers_company_created_idx
  on public.vouchers (company, created_at desc);

-- Backs the free-text search in History.
create index if not exists vouchers_search_idx
  on public.vouchers (company, recipient_name, internal_note);

create table if not exists public.signatories (
  id         uuid primary key,
  company    text        not null,
  name       text        not null,
  created_at timestamptz not null default now(),
  constraint signatories_company_name_key unique (company, name)
);

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
-- The typed document lives in one jsonb column, so adding a field to a PO needs
-- no migration. Only what the list filters and sorts on is lifted into columns.
create table if not exists public.purchase_orders (
  id            uuid primary key,
  po_no         text        not null unique,
  company       text        not null,
  status        text        not null default 'draft'
                            check (status in ('draft', 'issued', 'closed', 'cancelled')),
  seq           integer     not null,
  period        text        not null,           -- yyyymm, e.g. 202608
  internal_note text        not null default '',
  doc           jsonb       not null,
  vendor_name   text        not null default '',
  subject       text        not null default '',
  currency      text        not null default 'PKR',
  subtotal      numeric     not null default 0,
  total         numeric     not null default 0,
  po_date       date,
  delivery_date date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  issued_at     timestamptz,
  closed_at     timestamptz,
  -- Same reasoning as vouchers: the row stays so the number stays spent.
  deleted_at    timestamptz,
  pdf_key       text,
  -- Older than updated_at means the stored PDF predates the current document.
  pdf_at        timestamptz,
  -- The vendor's invoice. Attaching it is what closes the order.
  invoice_key   text,
  invoice_name  text,
  invoice_at    timestamptz,
  constraint purchase_orders_company_period_seq_key unique (company, period, seq)
);

-- Applied separately so a project created before PDF-freshness tracking picks it up.
alter table public.purchase_orders add column if not exists pdf_at       timestamptz;
alter table public.purchase_orders add column if not exists invoice_key  text;
alter table public.purchase_orders add column if not exists invoice_name text;
alter table public.purchase_orders add column if not exists invoice_at   timestamptz;

create index if not exists po_company_status_idx
  on public.purchase_orders (company, status);

create index if not exists po_company_date_idx
  on public.purchase_orders (company, po_date desc);

-- Backs both the free-text search and the vendor autocomplete.
create index if not exists po_company_vendor_idx
  on public.purchase_orders (company, vendor_name);

-- ---------------------------------------------------------------------------
-- Requests for quotation
-- ---------------------------------------------------------------------------
-- The opposite of a purchase order in the one way that matters: a PO states the
-- prices, an RFQ leaves them blank for the vendor to fill in. So there is no
-- money on this table and nothing to total -- item_count stands in where a
-- purchase order keeps subtotal and total.
create table if not exists public.requests_for_quotation (
  id            uuid primary key,
  rfq_no        text        not null unique,
  company       text        not null,
  status        text        not null default 'draft'
                            check (status in ('draft', 'sent', 'closed', 'cancelled')),
  seq           integer     not null,
  period        text        not null,           -- yyyymm, e.g. 202608
  internal_note text        not null default '',
  doc           jsonb       not null,
  subject       text        not null default '',
  currency      text        not null default 'PKR',
  item_count    integer     not null default 0,
  rfq_date      date,
  reply_by      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  sent_at       timestamptz,
  closed_at     timestamptz,
  -- Same reasoning as the others: the row stays so the number stays spent.
  deleted_at    timestamptz,
  pdf_key       text,
  -- Older than updated_at means the stored PDF predates the current document.
  pdf_at        timestamptz,
  constraint requests_for_quotation_company_period_seq_key unique (company, period, seq)
);

create index if not exists rfq_company_status_idx
  on public.requests_for_quotation (company, status);

create index if not exists rfq_company_date_idx
  on public.requests_for_quotation (company, rfq_date desc);

-- ---------------------------------------------------------------------------
-- Asset register
-- ---------------------------------------------------------------------------
-- Two records, not one. An asset is a *thing* -- a laptop keeps its number and
-- its identity when it changes hands -- and a holding is one period in someone's
-- possession. Putting the employee on the asset itself would make "who has it"
-- and "who had it" the same field, so recording a return would overwrite the
-- only copy of who it was with.
--
-- Nothing here is printed, so there is no jsonb doc, no status and no pdf_key.
--
-- The number is `GR-A-001` -- no year+month, unlike every other number in the
-- portal. An asset number is written on the item itself and outlives the month
-- it was bought in, so the sequence spans all time and never resets.
create table if not exists public.assets (
  id            uuid primary key,
  asset_no      text        not null unique,
  company       text        not null,
  -- Running, per company. Hence (company, seq) and not (company, period, seq).
  seq           integer     not null,
  asset_name    text        not null default '',
  -- From the last return. A fact about the thing, not about a holding, and what
  -- makes "which of our returned laptops are broken" answerable from this table.
  condition     text        not null default 'good'
                            check (condition in ('good', 'damaged', 'lost')),
  -- Cache of the open row in asset_holdings, so the register can list and search
  -- current holders without a join. Empty holder_name means the asset is in
  -- stock. asset_holdings is the authority; these are rewritten by allotting and
  -- by returning.
  holder_name   text        not null default '',
  holder_no     text        not null default '',
  held_since    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Same reasoning as the others, and it matters more here: the number is on a
  -- physical label, so reissuing it would tag two things identically.
  deleted_at    timestamptz,
  constraint assets_company_seq_key unique (company, seq)
);

create index if not exists assets_company_holder_idx
  on public.assets (company, holder_no);

create index if not exists assets_company_created_idx
  on public.assets (company, created_at desc);

-- One row per period in one person's possession. The authority on history.
create table if not exists public.asset_holdings (
  id            uuid primary key,
  asset_id      uuid        not null references public.assets (id),
  -- Denormalised so the history screen can filter by company without a join. An
  -- asset never moves between companies, so this cannot go stale.
  company       text        not null,
  employee_name text        not null default '',
  -- The number the company already issued the employee. Not generated here.
  employee_no   text        not null default '',
  allotted_on   date,
  -- NULL while they still have it. This is what marks a holding open.
  returned_on   date,
  condition     text        not null default 'good'
                            check (condition in ('good', 'damaged', 'lost')),
  note          text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- The holding's period with both ends filled in, so the history screen's
  -- overlap filter is two plain comparisons rather than a pair of OR-with-NULL
  -- clauses. PostgREST puts each OR group in its own query parameter, and one
  -- `or=` per request is the pattern the rest of this schema is queried with.
  -- An open holding runs to the far future; an undated one is treated as having
  -- always been in progress.
  span_start    date generated always as (coalesce(allotted_on, date '0001-01-01')) stored,
  span_end      date generated always as (coalesce(returned_on, date '9999-12-31')) stored
);

create index if not exists holdings_asset_idx
  on public.asset_holdings (asset_id, allotted_on desc);

create index if not exists holdings_company_date_idx
  on public.asset_holdings (company, allotted_on desc);

-- Backs both the free-text search and the employee suggestions on the form.
create index if not exists holdings_company_employee_idx
  on public.asset_holdings (company, employee_no);

-- An asset is returned before it goes to anyone else, so only one holding per
-- asset may be open. This partial unique index, not application logic, is what
-- guarantees two people can never hold the same asset at once.
create unique index if not exists holdings_one_open_idx
  on public.asset_holdings (asset_id) where returned_on is null;

-- Backs the overlap filter on the history screen.
create index if not exists holdings_span_idx
  on public.asset_holdings (company, span_end, span_start);

-- ---------------------------------------------------------------------------
-- Food and refreshments log
-- ---------------------------------------------------------------------------
-- The one table here with no company column, and that is the point. Roughly a
-- quarter of the entries this replaces were ordered for "Green Rock + Sportech"
-- -- one lunch, two companies at the table -- so an entry has no single owner.
-- `ordered_for` records what was written on the order as a label, and nothing is
-- ever split between the companies on the strength of it.
--
-- Two facts about an entry are independent, and conflating them was the flaw in
-- the spreadsheet this replaces:
--
--   payment_type  who fronted the money -- the vendor's tab, or an employee's
--                 own pocket.
--   status        whether that person or vendor has been squared up yet.
--
-- The cross of the two gives the two outstanding figures: deferred + pending is
-- money owed to a cafe, employee-paid + pending is a reimbursement someone is
-- waiting on, and they are settled by different people on different days.
--
-- Nothing here is printed, so there is no jsonb doc and no pdf_key.
--
-- The number is `F-202608-001` -- no company prefix, because the entry has no
-- company to take one from. It is the only number in the portal without one.
create table if not exists public.food_expenses (
  id            uuid primary key,
  entry_no      text        not null unique,
  seq           integer     not null,
  period        text        not null,
  -- When the food was ordered, which is not when the row was created: the log is
  -- often caught up on a few days late.
  date          date        not null,
  -- A label, never parsed into companies. Free text on purpose: a guest, a site
  -- team or a third company must not need a migration before lunch can be logged.
  ordered_for   text        not null default '',
  vendor        text        not null default '',
  details       text        not null default '',
  amount        numeric(14, 2) not null default 0,
  currency      text        not null default 'PKR',
  payment_type  text        not null default 'deferred'
                            check (payment_type in ('deferred', 'employee-paid')),
  -- The employee owed a reimbursement. NULL on a deferred order, where the
  -- company never handed anything over and there is nobody to reimburse.
  paid_by       text,
  status        text        not null default 'pending'
                            check (status in ('pending', 'paid')),
  -- NULL while pending, and also NULL on entries imported from the spreadsheet
  -- as paid without a date. Absence means unknown, not today.
  paid_at       date,
  -- Cheque number, transfer reference. Filled in by the settle flow.
  reference     text,
  notes         text,
  -- Proof of payment: the receipt or invoice filed when this was settled.
  -- Deliberately shareable — one cheque clears a whole cafe tab, so every entry
  -- in that settlement carries the same key and the file is stored once. That is
  -- why removing one has to check for other references before deleting the file.
  receipt_key   text,
  receipt_name  text,
  receipt_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Same reasoning as the others: the row stays, so the number stays spent and a
  -- deleted entry's figures remain reconstructable.
  deleted_at    timestamptz,
  -- Period + seq, with no company to key on. Guarantees a number is never handed
  -- out twice in a month even if two requests race.
  constraint food_period_seq_key unique (period, seq)
);

-- Receipts arrived after the food log did, and `create table if not exists`
-- above will not touch a table that already holds entries.
alter table public.food_expenses add column if not exists receipt_key  text;
alter table public.food_expenses add column if not exists receipt_name text;
alter table public.food_expenses add column if not exists receipt_at   timestamptz;

create index if not exists food_date_idx
  on public.food_expenses (date desc);

-- Backs the "is anything else still using this receipt" check that runs before
-- a shared file is deleted.
create index if not exists food_receipt_idx
  on public.food_expenses (receipt_key) where receipt_key is not null;

-- Backs the outstanding screen's only query: pending rows, split by who fronted
-- the money.
create index if not exists food_status_type_idx
  on public.food_expenses (status, payment_type);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
-- Branded announcement cards -- a headline and a short message, rendered as a
-- PNG for WhatsApp and a PDF for email. Every field is a column, like assets
-- and food_expenses: nothing here is printed except what is also searched or
-- filtered on, so a jsonb doc would only add indirection.
--
-- No status, no lifecycle: a notification is composed once and never edited,
-- so this table carries none of the draft/issued/closed machinery the three
-- document tables above have.
create table if not exists public.notifications (
  id           uuid primary key,
  notif_no     text        not null unique,
  company      text        not null,
  seq          integer     not null,
  period       text        not null,           -- yyyymm, e.g. 202608
  headline     text        not null default '',
  body         text        not null default '',
  tag          text        not null default 'notice'
                           check (tag in ('notice', 'announcement', 'action-required', 'urgent')),
  sender       text        not null default '',
  notify_date  date,
  created_at   timestamptz not null default now(),
  png_key      text,
  png_at       timestamptz,
  pdf_key      text,
  pdf_at       timestamptz,
  -- Same reasoning as every other module: the row stays, so its number stays
  -- spent, and a mistaken compose can be undone.
  deleted_at   timestamptz,
  constraint notifications_company_period_seq_key unique (company, period, seq)
);

create index if not exists notifications_company_created_idx
  on public.notifications (company, created_at desc);

-- Backs the free-text search in History.
create index if not exists notifications_search_idx
  on public.notifications (company, headline, sender);

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
-- Who works here, and how to reach them.
--
-- This is the record that did not exist. The asset register has always known an
-- employee as two free-text columns on a holding -- a name and a number, typed
-- fresh each time -- which costs nothing to maintain and is precisely why
-- nothing could be recorded against it: there was nowhere to put a CNIC, a phone
-- number or an address, because no row was *about a person*.
--
-- Strictly per company, structurally rather than by filtering. Numbering is a
-- separate sequence per company, so Green Rock and Sportech can both have an 001
-- and they are different people. Somebody working for both companies is two
-- records, which is what "no mixing" means followed all the way through.
--
-- The number is typed by hand and never generated -- the only number in the
-- portal that isn't. Everything below `name` is genuinely optional from the
-- first day: the columns exist so that filling them in later needs no
-- migration.
create table if not exists public.employees (
  id            uuid primary key,
  company       text        not null,
  -- Issued by the company, typed by the operator. Unique per company among live
  -- rows; see the partial index below.
  employee_no   text        not null,
  name          text        not null,
  -- Marked rather than deleted, so a leaver stays in the register and in every
  -- holding they ever had while dropping out of the asset dropdown. Reversible.
  status        text        not null default 'active'
                            check (status in ('active', 'left')),
  left_on       date,
  -- Stored exactly as typed rather than reformatted: it is a number somebody
  -- will read off a card and compare by eye, and helpfully inserting or removing
  -- dashes is how the two come to disagree.
  cnic          text,
  cnic_key      text,
  cnic_name     text,
  cnic_at       timestamptz,
  -- Separate from the CNIC, because one person may have either, both or neither.
  passport      text,
  passport_key  text,
  passport_name text,
  passport_at   timestamptz,
  address       text,
  phone         text,
  -- Next of kin as two columns, not one. A number with no name beside it is the
  -- thing you would least want to be guessing at on the day you need it.
  kin_name      text,
  kin_phone     text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Soft delete, so an employee's holdings never point into nothing.
  deleted_at    timestamptz
);

-- Among live rows only, which is a deliberate departure from every other number
-- in the portal. A voucher number or an asset tag stays spent forever because it
-- is printed on a thing; an employee number is typed by hand, so a deleted
-- record's number has to be free to type again -- otherwise a typo is permanent.
create unique index if not exists employees_company_no_key
  on public.employees (company, employee_no) where deleted_at is null;

create index if not exists employees_company_name_idx
  on public.employees (company, name);

-- Backs the register's only filtered query, and the dropdown's: this company's
-- active employees.
create index if not exists employees_company_status_idx
  on public.employees (company, status);

-- ---------------------------------------------------------------------------
-- Asset photographs
-- ---------------------------------------------------------------------------
-- A dated log per asset rather than one picture, because the value is in the
-- sequence: one photo says what a laptop looks like, four say it left in one
-- piece in July and came back with a cracked lid in September -- which is the
-- argument that actually has to be had.
--
-- No "primary photo" flag. The newest by `taken_on` is the thumbnail on the
-- register, so there is no second piece of state to keep correct.
create table if not exists public.asset_photos (
  id         uuid primary key,
  asset_id   uuid        not null references public.assets (id) on delete cascade,
  company    text        not null,
  key        text        not null,
  name       text        not null default '',
  -- The date the picture shows, which is not when it was uploaded: the log is
  -- often caught up on days later. Same reasoning as a food entry's order date.
  taken_on   date        not null,
  -- What the picture is of. The reason a photo log beats a photo.
  info       text        not null default '',
  created_at timestamptz not null default now()
);

create index if not exists asset_photos_asset_idx
  on public.asset_photos (asset_id, taken_on desc);

-- ---------------------------------------------------------------------------
-- Assets and holdings: the link to a real employee
-- ---------------------------------------------------------------------------
-- Added rather than replacing anything. The existing free-text `holder_name` /
-- `employee_name` columns stay and become the snapshot of who the asset was
-- handed to at the time -- the same habit the tranche ledger uses for its source
-- documents. That is what keeps a holding readable after a name is corrected in
-- the register, and what lets every holding already recorded go on reading
-- correctly with no link at all.
--
-- NULL therefore means one of two ordinary things: the asset is in stock, or the
-- holding predates the employee register.
--
-- `on delete set null` rather than cascade: employees are soft-deleted in normal
-- use, and if a row is ever hard-deleted from the dashboard the holding should
-- lose its link, not disappear from history.
alter table public.assets
  add column if not exists holder_id uuid references public.employees (id) on delete set null;

alter table public.asset_holdings
  add column if not exists employee_id uuid references public.employees (id) on delete set null;

create index if not exists holdings_employee_idx
  on public.asset_holdings (employee_id) where employee_id is not null;

-- ---------------------------------------------------------------------------
-- Investor funding: tranches, and what each one paid for
-- ---------------------------------------------------------------------------
-- Money arrives from one outside investor in lumps rather than per purchase: a
-- wire of dollars, converted at whatever rate that week gave, landing as rupees
-- in a Pakistani account. Every expense the portal records is then paid out of
-- one of those lumps. These three tables are the ledger tying the two together.
--
-- The dependency runs one way and only one way. This section reads vouchers,
-- purchase orders and food entries so it can offer them for allocation; none of
-- those tables gained a column for this, and nothing in those modules reads a
-- tranche. Drop these three tables and every screen that existed before behaves
-- exactly as it did.
--
-- A tranche stores exactly two figures -- what was sent and what was received --
-- and everything else about it is arithmetic on those. There is deliberately no
-- rate column: derived as received / sent it can never disagree with the two
-- numbers printed beside it, and it is automatically the *effective* rate, with
-- the bank's charge on the inward remittance already inside it, because the
-- received figure is what actually landed in the account. A gross amount plus a
-- separate fee column would give two ways to state one thing, and the bank
-- statement only agrees with one of them.
create table if not exists public.funding_tranches (
  id             uuid primary key,
  -- `TR-001`, continuous and never resetting. No year+month, for the same
  -- reason an asset number carries none: you refer to "the fourth tranche" for
  -- years afterwards, and a sequence that restarted monthly would put two
  -- `-001` labels on two different wires.
  tranche_no     text        not null unique,
  -- Unique on its own, not on (period, seq): there is no period. Deleted rows
  -- keep their number, so a number is never handed out twice.
  seq            integer     not null unique,
  label          text        not null default '',
  funder         text        not null default '',
  -- What left the investor's account.
  sent_amount    numeric(14, 2) not null default 0,
  sent_currency  text        not null default 'USD',
  -- Nullable, unlike the received date: a tranche is often logged the day it
  -- lands, before anybody has looked up when it was actually wired.
  sent_date      date,
  -- What landed here, net of bank charges -- the pool everything draws from.
  recv_amount    numeric(14, 2) not null default 0,
  recv_currency  text        not null default 'PKR',
  -- NOT NULL because it orders the buckets, and the order is not cosmetic: a
  -- split fills the oldest open tranche first, because that is how the money
  -- was actually spent.
  recv_date      date        not null,
  account        text,
  reference      text,
  notes          text,
  -- Set when a bucket is closed by hand with money still in it. The one part of
  -- a bucket's state that is stored rather than derived, because it is a
  -- decision: a bucket with 2,400 rupees left that nothing will ever be small
  -- enough to spend should stop being offered. The remainder is stated on the
  -- card and still counts in total received; it is never moved into another
  -- bucket, because it never moved in the bank.
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Same reasoning as every other module: the row stays, so the number stays
  -- spent and a deleted tranche's figures remain reconstructable.
  deleted_at     timestamptz
);

create index if not exists tranches_recv_date_idx
  on public.funding_tranches (recv_date desc);

-- One debit from one bucket.
--
-- The rule the whole module rests on: an allocation carries its OWN amount
-- rather than pointing at a document's total. That single choice is what lets
-- one expense be paid out of two tranches, lets an expense sit half allocated
-- while the next tranche is still in the air, lets a voucher whose amount was
-- left blank to be written in by hand still be attributed, and stops an edit to
-- a voucher in September from silently moving a bucket that was closed in July.
--
-- Three amounts, and the difference between them is the whole currency story:
--
--   amount         what leaves the bucket, in the bucket's received currency.
--                  The authoritative figure -- the only one a balance is built
--                  from.
--   source_amount  how much of the document this covers, in the document's own
--                  currency. What the over-allocation guard counts, so a split
--                  adds up against the document rather than against the bucket.
--   source_total   the document's whole total when this row was written, so a
--                  ledger line can say "part of 340,000" without joining three
--                  other tables, and so drift is detectable later.
--
-- On the ordinary case -- a rupee voucher against a rupee bucket -- the first
-- two are equal and rate is 1. They part company only when the document is in
-- another currency, which today means a purchase order raised in SAR.
--
-- The snapshot columns are the same habit as the voucher table's denormalised
-- recipient_name and amount: a tranche's ledger renders without joining to
-- three modules, and a line still reads correctly after the document behind it
-- is deleted.
create table if not exists public.tranche_allocations (
  id              uuid primary key,
  tranche_id      uuid        not null
                              references public.funding_tranches (id) on delete cascade,
  source_kind     text        not null
                              check (source_kind in ('voucher', 'po', 'food', 'misc', 'direct')),
  source_id       uuid        not null,
  amount          numeric(14, 2) not null,
  source_amount   numeric(14, 2) not null,
  -- NULL where the document records no total -- a voucher left blank to be
  -- written in at signing. That is why such a row can never read as fully
  -- allocated: there is nothing to compare against.
  source_total    numeric(14, 2),
  source_currency text        not null default 'PKR',
  rate            numeric(16, 6) not null default 1,
  source_ref      text        not null default '',
  source_label    text        not null default '',
  source_company  text,
  source_date     date,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Miscellaneous payments became allocatable after this table shipped, and
-- `create table if not exists` above will not touch a table that already exists
-- -- so a database created before them still carries the four-value constraint
-- above and would reject every misc allocation with a check violation. The
-- symptom is nasty: the SQLite backend has no such constraint, so this fails
-- only on the hosted deployment and only once somebody tries to allocate one.
--
-- Dropped and recreated rather than altered, because Postgres has no ALTER for
-- a check expression. The pair is safe to re-run, which is this file's standing
-- promise: the drop tolerates the constraint already being gone, and the add
-- then always puts back exactly the five-value version. Nothing is rewritten --
-- every existing row holds one of the four values the new constraint still
-- allows, so the revalidating scan cannot fail.
--
-- `tranche_allocations_source_kind_check` is the name Postgres generates for an
-- inline column check: <table>_<column>_check.
alter table public.tranche_allocations
  drop constraint if exists tranche_allocations_source_kind_check;

alter table public.tranche_allocations
  add constraint tranche_allocations_source_kind_check
  check (source_kind in ('voucher', 'po', 'food', 'misc', 'direct'));

create index if not exists tranche_alloc_tranche_idx
  on public.tranche_allocations (tranche_id);

-- Backs the question the picker asks of every row it draws: how much of this
-- expense is already in a bucket, and which ones.
create index if not exists tranche_alloc_source_idx
  on public.tranche_allocations (source_kind, source_id);

-- An expense that lives only in this ledger.
--
-- Confidential in a structural sense rather than an enforced one: nothing
-- outside the funding section reads this table, so these never appear in the
-- expenditure report, on the landing card's figures, or anywhere in either
-- company workspace. What that does not do is keep out somebody who already has
-- the portal password -- there is one gate and it opens everything.
--
-- The honest consequence, which the tranche screen states rather than hides: a
-- bucket's allocations will exceed what the expenditure report knows about, by
-- exactly the value of the direct entries in it.
--
-- `TE-202608-001` -- period and sequence, no company prefix, the same choice
-- the food log made and for the same reason.
create table if not exists public.tranche_expenses (
  id           uuid primary key,
  entry_no     text        not null unique,
  seq          integer     not null,
  period       text        not null,
  date         date        not null,
  payee        text        not null default '',
  details      text        not null default '',
  amount       numeric(14, 2) not null default 0,
  currency     text        not null default 'PKR',
  -- A label if it belongs to one company, NULL for neither. Never parsed into
  -- an accounting split -- the same rule the food log's ordered_for follows.
  company      text,
  notes        text,
  receipt_key  text,
  receipt_name text,
  receipt_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint tranche_expenses_period_seq_key unique (period, seq)
);

create index if not exists tranche_expenses_date_idx
  on public.tranche_expenses (date desc);

-- ---------------------------------------------------------------------------
-- Miscellaneous payments
-- ---------------------------------------------------------------------------
-- Money out with no document behind it: a parking fee, a courier, a tip. Every
-- other spend module here is built around a piece of paper -- a voucher exists
-- to be signed, an order to be issued -- and this one deliberately has none.
-- The row is the record.
--
-- Company-scoped, unlike food_expenses. A lunch is genuinely ordered for both
-- companies at once; a payment comes out of one company's account, so it has an
-- owner and belongs in that workspace's totals.
--
-- No status column. The money has already gone by the time this is typed, so
-- there is nothing to move through -- the only thing that can turn up later is
-- the receipt, which is why proof is its own three columns rather than a field
-- of the form. See src/lib/misc/types.ts.
create table if not exists public.misc_payments (
  id            uuid primary key,
  payment_no    text        not null unique,
  company       text        not null,
  seq           integer     not null,
  period        text        not null,           -- yyyymm, e.g. 202608
  -- When the money went out, which is not when the row was created: these are
  -- typically caught up on at the end of a week.
  date          date        not null,
  amount        numeric(14, 2) not null default 0,
  currency      text        not null default 'PKR',
  -- What it was for. The only description the record has, which is why the
  -- action refuses an empty one.
  notes         text        not null default '',
  -- The receipt, if there ever was one. Never shared between payments, unlike a
  -- food receipt, so removing it can delete the file outright with no reference
  -- count to check first.
  proof_key     text,
  proof_name    text,
  proof_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Same reasoning as the others: the row stays, so the number stays spent and a
  -- deleted payment's figures remain reconstructable.
  deleted_at    timestamptz,
  -- A sequence number is never handed out twice for the same company and month.
  -- This constraint, not application logic, is what guarantees it.
  constraint misc_company_period_seq_key unique (company, period, seq)
);

create index if not exists misc_company_date_idx
  on public.misc_payments (company, date desc);

-- Backs the "which of these can I actually evidence" view on the log.
create index if not exists misc_proof_idx
  on public.misc_payments (company, proof_key)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Per-company settings
-- ---------------------------------------------------------------------------
-- One JSON document per company. A new module adds a section to the document
-- rather than a column here, so this table never needs migrating again.
create table if not exists public.company_settings (
  company    text primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.vouchers               enable row level security;
alter table public.signatories            enable row level security;
alter table public.purchase_orders        enable row level security;
alter table public.requests_for_quotation enable row level security;
alter table public.assets                 enable row level security;
alter table public.asset_holdings         enable row level security;
alter table public.food_expenses          enable row level security;
alter table public.company_settings       enable row level security;
alter table public.notifications          enable row level security;
alter table public.funding_tranches       enable row level security;
alter table public.tranche_allocations    enable row level security;
alter table public.tranche_expenses       enable row level security;
alter table public.employees              enable row level security;
alter table public.asset_photos           enable row level security;
alter table public.misc_payments          enable row level security;

-- Deliberately no policies: see the note at the top of this file.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- One private bucket holds every generated document and uploaded scan. Private
-- is important: files are served through the portal's own /api/file route so
-- they stay behind the password gate.
insert into storage.buckets (id, name, public)
values ('vouchers', 'vouchers', false)
on conflict (id) do nothing;
