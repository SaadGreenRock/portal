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
alter table public.company_settings       enable row level security;

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
