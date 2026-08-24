import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  AllotFields,
  AssetCounts,
  AssetFields,
  AssetHolding,
  AssetPhoto,
  AssetQuery,
  AssetThumb,
  PhotoFields,
  HoldingQuery,
  ReturnFields,
} from "../assets/types";
import { COMPANIES, type CompanySlug } from "../companies";
import {
  duplicateNumber,
  isEmployeeStatus,
  type DocKind,
  type Employee,
  type EmployeeCounts,
  type EmployeeFields,
  type EmployeeQuery,
  type EmployeeStatus,
  type EmployeeSummary,
} from "../employees/types";
import {
  summariseFood,
  type FoodCounts,
  type FoodExpense,
  type FoodFields,
  type FoodQuery,
} from "../food/types";
import {
  summariseMisc,
  type MiscCounts,
  type MiscFields,
  type MiscPayment,
  type MiscQuery,
} from "../misc/types";
import type { Notification, NotificationCounts, NotificationQuery } from "../notifications/types";
import { OPEN_STATUSES, type PoCounts, type PoDoc, type PoQuery, type PoStatus, type PurchaseOrder } from "../po/types";
import {
  RFQ_OPEN_STATUSES,
  type RfqCounts,
  type RfqDoc,
  type RfqQuery,
  type RfqStatus,
} from "../rfq/types";
import { todayIso } from "../format";
import { mergeSettings, type CompanySettings } from "../settings";
import type { SpendRow } from "../spend/types";
import {
  isSourceKind,
  overAllocateMessage,
  overdrawMessage,
  paisa,
  type AllocatableItem,
  type Allocation,
  type Debit,
  type SourceKind,
  type DirectExpense,
  type DirectFields,
  type NewAllocation,
  type Tranche,
  type TrancheFields,
} from "../tranches/types";
import type { HistoryQuery, Signatory, Voucher } from "../types";
import type {
  NewAsset,
  NewEmployee,
  NewMiscPayment,
  NewNotification,
  NewPurchaseOrder,
  NewRfq,
  NewVoucher,
  Store,
} from "./types";
import {
  allocationColumns,
  assembleAllocatable,
  denormalize,
  denormalizePo,
  denormalizeRfq,
  directColumns,
  directPayeesFrom,
  employeeColumns,
  employeeKey,
  employeeNoKey,
  foodColumns,
  miscColumns,
  foodNamesFrom,
  formatAssetNo,
  formatDirectNo,
  formatFoodNo,
  formatMiscNo,
  formatNotifNo,
  formatPoNo,
  formatRfqNo,
  formatTrancheNo,
  formatVoucherNo,
  docColumns,
  docKeyColumn,
  holderColumns,
  holdingColumns,
  IN_STOCK_COLUMNS,
  newId,
  periodOf,
  poStatusPatch,
  rfqStatusPatch,
  rowToAllocation,
  rowToAsset,
  rowToDirect,
  rowToEmployee,
  rowToFood,
  rowToHolding,
  rowToMisc,
  rowToHoldingWithAsset,
  rowToNotification,
  newestPerAsset,
  rowToPhoto,
  rowToPo,
  rowToRfq,
  rowToTranche,
  trancheColumns,
  statusChangesDocument,
  rowToVoucher,
  vendorProfilesFrom,
  type AllocationRow,
  type AssetRow,
  type DirectRow,
  type EmployeeRow,
  type FoodRow,
  type HoldingRow,
  type HoldingWithAssetRow,
  type MiscRow,
  type NotificationRow,
  type PhotoRow,
  type PoRow,
  type RfqRow,
  type TrancheRow,
  type VoucherRow,
} from "./shared";

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");

interface SignatoryRow {
  id: string;
  company: string;
  name: string;
  created_at: string;
}

const toSignatory = (r: SignatoryRow): Signatory => ({
  id: r.id,
  company: r.company as CompanySlug,
  name: r.name,
  createdAt: r.created_at,
});

/**
 * The live employee in this company already using a number, if any.
 *
 * Compared loosely — case and spacing folded — because "emp 001", "EMP-001" and
 * "emp-001" typed on three different days are one number to everybody except a
 * database. The stored value keeps whatever was typed; only the comparison is
 * loosened, and the unique index stays as the exact-match backstop.
 *
 * `exceptId` is the row being edited, which must not be found as a clash with
 * itself.
 */
function findEmployeeByNo(
  handle: Database.Database,
  company: CompanySlug,
  employeeNo: string,
  exceptId: string | null,
): { id: string; name: string } | null {
  const key = employeeNoKey(employeeNo);
  if (!key) return null;

  const rows = handle
    .prepare(
      `SELECT id, name, employee_no FROM employees
        WHERE company = ? AND deleted_at IS NULL`,
    )
    .all(company) as Array<{ id: string; name: string; employee_no: string }>;

  const hit = rows.find((r) => r.id !== exceptId && employeeNoKey(r.employee_no) === key);
  return hit ? { id: hit.id, name: hit.name } : null;
}

let db: Database.Database | null = null;

function connect(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const handle = new Database(path.join(DATA_DIR, "vouchers.db"));

  // WAL keeps reads fast while a write is in flight; NORMAL sync is plenty for
  // a single-operator tool and avoids an fsync on every insert.
  handle.pragma("journal_mode = WAL");
  handle.pragma("synchronous = NORMAL");
  handle.pragma("foreign_keys = ON");

  handle.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id            TEXT PRIMARY KEY,
      voucher_no    TEXT NOT NULL UNIQUE,
      company       TEXT NOT NULL,
      status        TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      period        TEXT NOT NULL,
      internal_note TEXT NOT NULL DEFAULT '',
      fields        TEXT NOT NULL,
      recipient_name TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      amount        REAL,
      voucher_date  TEXT,
      created_at    TEXT NOT NULL,
      generated_at  TEXT,
      uploaded_at   TEXT,
      deleted_at    TEXT,
      pdf_key       TEXT,
      scan_key      TEXT,
      scan_name     TEXT,
      -- Guarantees a sequence number is never handed out twice for the same
      -- company and month, even if two requests race.
      UNIQUE (company, period, seq)
    );

    CREATE INDEX IF NOT EXISTS vouchers_company_status ON vouchers (company, status);
    CREATE INDEX IF NOT EXISTS vouchers_company_created ON vouchers (company, created_at DESC);

    CREATE TABLE IF NOT EXISTS signatories (
      id         TEXT PRIMARY KEY,
      company    TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (company, name)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id            TEXT PRIMARY KEY,
      po_no         TEXT NOT NULL UNIQUE,
      company       TEXT NOT NULL,
      status        TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      period        TEXT NOT NULL,
      internal_note TEXT NOT NULL DEFAULT '',
      -- The whole typed document. Adding a field to a PO costs nothing here.
      doc           TEXT NOT NULL,
      -- Lifted out of doc so lists and filters never deserialise a row.
      vendor_name   TEXT NOT NULL DEFAULT '',
      subject       TEXT NOT NULL DEFAULT '',
      currency      TEXT NOT NULL DEFAULT 'PKR',
      subtotal      REAL NOT NULL DEFAULT 0,
      total         REAL NOT NULL DEFAULT 0,
      po_date       TEXT,
      delivery_date TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      issued_at     TEXT,
      closed_at     TEXT,
      deleted_at    TEXT,
      pdf_key       TEXT,
      pdf_at        TEXT,
      invoice_key   TEXT,
      invoice_name  TEXT,
      invoice_at    TEXT,
      -- Same guarantee as vouchers: a number is never handed out twice.
      UNIQUE (company, period, seq)
    );

    CREATE INDEX IF NOT EXISTS po_company_status ON purchase_orders (company, status);
    CREATE INDEX IF NOT EXISTS po_company_date ON purchase_orders (company, po_date DESC);
    CREATE INDEX IF NOT EXISTS po_company_vendor ON purchase_orders (company, vendor_name);

    CREATE TABLE IF NOT EXISTS requests_for_quotation (
      id            TEXT PRIMARY KEY,
      rfq_no        TEXT NOT NULL UNIQUE,
      company       TEXT NOT NULL,
      status        TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      period        TEXT NOT NULL,
      internal_note TEXT NOT NULL DEFAULT '',
      doc           TEXT NOT NULL,
      -- Lifted out of doc. A count, not a total: there is no money on an RFQ.
      subject       TEXT NOT NULL DEFAULT '',
      currency      TEXT NOT NULL DEFAULT 'PKR',
      item_count    INTEGER NOT NULL DEFAULT 0,
      rfq_date      TEXT,
      reply_by      TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      sent_at       TEXT,
      closed_at     TEXT,
      deleted_at    TEXT,
      pdf_key       TEXT,
      pdf_at        TEXT,
      UNIQUE (company, period, seq)
    );

    CREATE INDEX IF NOT EXISTS rfq_company_status ON requests_for_quotation (company, status);
    CREATE INDEX IF NOT EXISTS rfq_company_date ON requests_for_quotation (company, rfq_date DESC);

    -- The asset register: the thing itself. Plain columns rather than a doc,
    -- because every field here is searched or sorted on. No period column
    -- either -- an asset number carries no month.
    CREATE TABLE IF NOT EXISTS assets (
      id            TEXT PRIMARY KEY,
      asset_no      TEXT NOT NULL UNIQUE,
      company       TEXT NOT NULL,
      -- Running, per company, never reset. GR-A-001 is on the item itself.
      seq           INTEGER NOT NULL,
      asset_name    TEXT NOT NULL DEFAULT '',
      -- From the last return. A fact about the thing, not about a holding.
      condition     TEXT NOT NULL DEFAULT 'good',
      -- Cache of the open holding in asset_holdings, so the register can list
      -- and search current holders without touching a second table. Empty
      -- holder_name means in stock.
      holder_name   TEXT NOT NULL DEFAULT '',
      holder_no     TEXT NOT NULL DEFAULT '',
      held_since    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      -- Company + seq, not company + period + seq: the sequence spans all time.
      UNIQUE (company, seq)
    );

    CREATE INDEX IF NOT EXISTS assets_company_holder ON assets (company, holder_no);
    CREATE INDEX IF NOT EXISTS assets_company_created ON assets (company, created_at DESC);

    -- One row per period in one person's possession. The authority on history;
    -- the holder columns on assets are derived from the open row here.
    CREATE TABLE IF NOT EXISTS asset_holdings (
      id            TEXT PRIMARY KEY,
      asset_id      TEXT NOT NULL REFERENCES assets (id),
      -- Denormalised so the history screen can filter by company without a
      -- join. An asset never moves between companies, so it cannot go stale.
      company       TEXT NOT NULL,
      employee_name TEXT NOT NULL DEFAULT '',
      employee_no   TEXT NOT NULL DEFAULT '',
      allotted_on   TEXT,
      -- NULL while they still have it.
      returned_on   TEXT,
      condition     TEXT NOT NULL DEFAULT 'good',
      note          TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      -- The holding's period with both ends filled in, so the history screen's
      -- overlap filter is two plain comparisons rather than a pair of
      -- OR-with-NULL clauses. That matters for the Supabase backend, where every
      -- OR group is a separate query parameter, and it keeps the two backends
      -- filtering identically. An open holding runs to the far future; an
      -- undated one is treated as having always been in progress.
      span_start    TEXT GENERATED ALWAYS AS (COALESCE(allotted_on, '0001-01-01')) VIRTUAL,
      span_end      TEXT GENERATED ALWAYS AS (COALESCE(returned_on, '9999-12-31')) VIRTUAL
    );

    CREATE INDEX IF NOT EXISTS holdings_asset ON asset_holdings (asset_id, allotted_on DESC);
    CREATE INDEX IF NOT EXISTS holdings_company_date
      ON asset_holdings (company, allotted_on DESC);
    CREATE INDEX IF NOT EXISTS holdings_company_employee
      ON asset_holdings (company, employee_no);
    -- An asset is returned before it goes to anyone else, so only one holding
    -- per asset may be open. A partial unique index makes that the database's
    -- rule rather than something the application has to remember.
    CREATE UNIQUE INDEX IF NOT EXISTS holdings_one_open
      ON asset_holdings (asset_id) WHERE returned_on IS NULL;
    CREATE INDEX IF NOT EXISTS holdings_span ON asset_holdings (company, span_end, span_start);

    -- The food and refreshments log. The one table here with no company column:
    -- a lunch ordered for both companies belongs to neither, and ordered_for is
    -- a label rather than an owner. See src/lib/food/types.ts.
    CREATE TABLE IF NOT EXISTS food_expenses (
      id            TEXT PRIMARY KEY,
      entry_no      TEXT NOT NULL UNIQUE,
      seq           INTEGER NOT NULL,
      period        TEXT NOT NULL,
      -- When the food was ordered, which is not when the row was created: the
      -- log is often caught up on a few days late.
      date          TEXT NOT NULL,
      ordered_for   TEXT NOT NULL DEFAULT '',
      vendor        TEXT NOT NULL DEFAULT '',
      details       TEXT NOT NULL DEFAULT '',
      amount        REAL NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'PKR',
      -- 'deferred' (on the vendor's tab) or 'employee-paid' (out of pocket).
      payment_type  TEXT NOT NULL DEFAULT 'deferred',
      -- The employee owed a reimbursement. NULL on a deferred order.
      paid_by       TEXT,
      -- 'pending' or 'paid'. Crossed with payment_type this gives the two
      -- outstanding figures: owed to vendors, and owed to employees.
      status        TEXT NOT NULL DEFAULT 'pending',
      -- NULL while pending, and also NULL on imported entries recorded as paid
      -- without a date. Absence means unknown, not today.
      paid_at       TEXT,
      reference     TEXT,
      notes         TEXT,
      -- Proof of payment. Shared by every entry settled in the same payment, so
      -- a dozen rows can carry the same key and the file is stored once.
      receipt_key   TEXT,
      receipt_name  TEXT,
      receipt_at    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      -- Period + seq, with no company to key on. Guarantees a number is never
      -- handed out twice in a month even if two requests race.
      UNIQUE (period, seq)
    );

    CREATE INDEX IF NOT EXISTS food_date ON food_expenses (date DESC);
    -- The outstanding screen's only query: pending rows, split by who fronted it.
    CREATE INDEX IF NOT EXISTS food_status_type ON food_expenses (status, payment_type);
    -- The index on receipt_key is created in migrate(), not here: this block
    -- runs first, and on a database that predates the column an index over it
    -- would fail with "no such column" before the migration could add it.

    -- Money out with no document behind it: a parking fee, a courier, a tip.
    -- Company-scoped, unlike food_expenses -- a payment comes out of one
    -- company's account, so it has an owner. No status column: the money has
    -- already gone by the time this is typed, and the only thing that can turn
    -- up later is the receipt. See src/lib/misc/types.ts.
    CREATE TABLE IF NOT EXISTS misc_payments (
      id            TEXT PRIMARY KEY,
      payment_no    TEXT NOT NULL UNIQUE,
      company       TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      period        TEXT NOT NULL,
      -- When the money went out, which is not when the row was created: these
      -- are typically caught up on at the end of a week.
      date          TEXT NOT NULL,
      amount        REAL NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'PKR',
      -- What it was for. The only description the record has, which is why the
      -- action refuses an empty one.
      notes         TEXT NOT NULL DEFAULT '',
      -- The receipt, if there ever was one. Never shared between payments,
      -- unlike a food receipt, so removing it can delete the file outright.
      proof_key     TEXT,
      proof_name    TEXT,
      proof_at      TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      -- Guarantees a number is never handed out twice for the same company and
      -- month, even if two requests race.
      UNIQUE (company, period, seq)
    );

    CREATE INDEX IF NOT EXISTS misc_company_date
      ON misc_payments (company, date DESC);

    -- Branded announcement cards. Every field is a column, like assets and
    -- food_expenses: nothing here is printed except what is also searched or
    -- filtered on, so a jsonb doc would only add indirection. No status, no
    -- lifecycle: a notification is composed once and never edited.
    CREATE TABLE IF NOT EXISTS notifications (
      id            TEXT PRIMARY KEY,
      notif_no      TEXT NOT NULL UNIQUE,
      company       TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      period        TEXT NOT NULL,
      headline      TEXT NOT NULL DEFAULT '',
      body          TEXT NOT NULL DEFAULT '',
      tag           TEXT NOT NULL DEFAULT 'notice',
      sender        TEXT NOT NULL DEFAULT '',
      notify_date   TEXT,
      created_at    TEXT NOT NULL,
      png_key       TEXT,
      png_at        TEXT,
      pdf_key       TEXT,
      pdf_at        TEXT,
      deleted_at    TEXT,
      UNIQUE (company, period, seq)
    );

    CREATE INDEX IF NOT EXISTS notifications_company_created
      ON notifications (company, created_at DESC);

    -- The employee register, per company. The record that did not exist: an
    -- employee used to be two free-text columns on a holding, which is why
    -- nothing could be stored about a person. See src/lib/employees/types.ts.
    --
    -- The only number in the portal that is typed rather than generated.
    CREATE TABLE IF NOT EXISTS employees (
      id            TEXT PRIMARY KEY,
      company       TEXT NOT NULL,
      employee_no   TEXT NOT NULL,
      name          TEXT NOT NULL,
      -- 'active' or 'left'. Marked rather than deleted, so a leaver stays in
      -- every holding they ever had while dropping out of the asset dropdown.
      status        TEXT NOT NULL DEFAULT 'active',
      left_on       TEXT,
      -- Stored exactly as typed, never reformatted: it is compared by eye
      -- against a card, and inserting or removing dashes is how the two come to
      -- disagree.
      cnic          TEXT,
      cnic_key      TEXT,
      cnic_name     TEXT,
      cnic_at       TEXT,
      passport      TEXT,
      passport_key  TEXT,
      passport_name TEXT,
      passport_at   TEXT,
      address       TEXT,
      phone         TEXT,
      -- Next of kin as two columns. A number with no name beside it is the thing
      -- you would least want to be guessing at on the day you need it.
      kin_name      TEXT,
      kin_phone     TEXT,
      notes         TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      -- Soft delete, so the holdings pointing at them never point into nothing.
      deleted_at    TEXT
    );

    -- Among live rows only, unlike every other number in the portal. A voucher
    -- number stays spent because it is printed on a thing; an employee number is
    -- typed by hand, so a deleted record's number has to be free to type again
    -- or a typo becomes permanent.
    CREATE UNIQUE INDEX IF NOT EXISTS employees_company_no
      ON employees (company, employee_no) WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS employees_company_status
      ON employees (company, status);

    -- A dated log per asset rather than one picture: the value is in the
    -- sequence. The newest by taken_on is the register's thumbnail, so there is
    -- no "primary photo" flag to keep correct.
    CREATE TABLE IF NOT EXISTS asset_photos (
      id         TEXT PRIMARY KEY,
      asset_id   TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
      company    TEXT NOT NULL,
      key        TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      -- The date the picture shows, not when it was uploaded.
      taken_on   TEXT NOT NULL,
      info       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS asset_photos_asset
      ON asset_photos (asset_id, taken_on DESC);

    -- Investor funding. Three tables, and the dependency runs one way: this
    -- section reads vouchers, purchase orders and food entries so a bucket can
    -- be filled from any of them, and none of those tables gained a column for
    -- it. See src/lib/tranches/types.ts, and the fuller note in migration.sql.
    --
    -- No rate column on purpose: derived as recv / sent it can never disagree
    -- with the two figures printed beside it, and it is automatically the
    -- effective rate, with the bank's charge already inside it.
    CREATE TABLE IF NOT EXISTS funding_tranches (
      id             TEXT PRIMARY KEY,
      -- TR-001, continuous. UNIQUE on seq alone because there is no period to
      -- key on; deleted rows keep their number, so one is never reissued.
      tranche_no     TEXT NOT NULL UNIQUE,
      seq            INTEGER NOT NULL UNIQUE,
      label          TEXT NOT NULL DEFAULT '',
      funder         TEXT NOT NULL DEFAULT '',
      sent_amount    REAL NOT NULL DEFAULT 0,
      sent_currency  TEXT NOT NULL DEFAULT 'USD',
      -- Nullable, unlike recv_date: a tranche is often logged the day it lands,
      -- before anyone has looked up when it was wired.
      sent_date      TEXT,
      -- Net of bank charges: the pool everything draws from.
      recv_amount    REAL NOT NULL DEFAULT 0,
      recv_currency  TEXT NOT NULL DEFAULT 'PKR',
      -- NOT NULL because it orders the buckets, and the order is not cosmetic:
      -- a split fills the oldest open tranche first, because that is how the
      -- money was actually spent.
      recv_date      TEXT NOT NULL,
      account        TEXT,
      reference      TEXT,
      notes          TEXT,
      -- Closed by hand with money still in it. The one part of a bucket's state
      -- that is stored rather than derived, because it is a decision.
      closed_at      TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      deleted_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS tranches_recv_date ON funding_tranches (recv_date DESC);

    -- One debit from one bucket. An allocation carries its OWN amount rather
    -- than pointing at a document's total, which is what lets one expense be
    -- paid out of two tranches and stops a September edit from moving a bucket
    -- closed in July. The three amounts are explained in tranches/types.ts.
    CREATE TABLE IF NOT EXISTS tranche_allocations (
      id              TEXT PRIMARY KEY,
      tranche_id      TEXT NOT NULL REFERENCES funding_tranches (id) ON DELETE CASCADE,
      source_kind     TEXT NOT NULL,
      source_id       TEXT NOT NULL,
      -- Leaves the bucket, in the bucket's received currency. Authoritative.
      amount          REAL NOT NULL,
      -- Portion of the document covered, in the document's currency. What the
      -- over-allocation guard counts.
      source_amount   REAL NOT NULL,
      -- The document's total when this row was written. NULL where none was
      -- recorded, which is why such a row can never read as fully allocated.
      source_total    REAL,
      source_currency TEXT NOT NULL DEFAULT 'PKR',
      rate            REAL NOT NULL DEFAULT 1,
      -- Snapshots, so a ledger line still reads after its document is deleted,
      -- and a bucket renders without joining to three modules.
      source_ref      TEXT NOT NULL DEFAULT '',
      source_label    TEXT NOT NULL DEFAULT '',
      source_company  TEXT,
      source_date     TEXT,
      note            TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tranche_alloc_tranche
      ON tranche_allocations (tranche_id);
    -- Backs the question the picker asks of every row it draws: how much of
    -- this expense is already in a bucket, and which ones.
    CREATE INDEX IF NOT EXISTS tranche_alloc_source
      ON tranche_allocations (source_kind, source_id);

    -- An expense that lives only in this ledger. Confidential in a structural
    -- sense: nothing outside the funding section reads this table.
    CREATE TABLE IF NOT EXISTS tranche_expenses (
      id           TEXT PRIMARY KEY,
      entry_no     TEXT NOT NULL UNIQUE,
      seq          INTEGER NOT NULL,
      period       TEXT NOT NULL,
      date         TEXT NOT NULL,
      payee        TEXT NOT NULL DEFAULT '',
      details      TEXT NOT NULL DEFAULT '',
      amount       REAL NOT NULL DEFAULT 0,
      currency     TEXT NOT NULL DEFAULT 'PKR',
      -- A label if it belongs to one company, NULL for neither. Never parsed.
      company      TEXT,
      notes        TEXT,
      receipt_key  TEXT,
      receipt_name TEXT,
      receipt_at   TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      deleted_at   TEXT,
      UNIQUE (period, seq)
    );

    CREATE INDEX IF NOT EXISTS tranche_expenses_date ON tranche_expenses (date DESC);

    -- One JSON document of settings per company, so a new module can add a
    -- section without a schema change.
    CREATE TABLE IF NOT EXISTS company_settings (
      company    TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrate(handle);
  db = handle;
  seedSignatories(handle);
  return handle;
}

/**
 * Columns added after a table first shipped.
 *
 * CREATE TABLE IF NOT EXISTS won't touch a table that already exists, so a
 * database created by an earlier version keeps its old shape until these are
 * applied. Every column here must be nullable — there is no backfill.
 */
const ADDED_COLUMNS: Array<[table: string, column: string, type: string]> = [
  ["vouchers", "deleted_at", "TEXT"],
  ["purchase_orders", "pdf_at", "TEXT"],
  ["purchase_orders", "invoice_key", "TEXT"],
  ["purchase_orders", "invoice_name", "TEXT"],
  ["purchase_orders", "invoice_at", "TEXT"],
  // Receipts arrived after the food log did, so a database created between the
  // two has the table but not these.
  ["food_expenses", "receipt_key", "TEXT"],
  ["food_expenses", "receipt_name", "TEXT"],
  ["food_expenses", "receipt_at", "TEXT"],
  // The link to a real employee, added when the register arrived. The existing
  // free-text holder_name / employee_name columns stay and become the snapshot
  // of who the asset was handed to at the time, so every holding already
  // recorded goes on reading correctly with no link at all. NULL therefore means
  // one of two ordinary things: in stock, or recorded before the register.
  //
  // No REFERENCES clause: SQLite cannot add a foreign key by ALTER TABLE. The
  // Postgres migration declares one with ON DELETE SET NULL, and this backend is
  // the zero-setup local one.
  ["assets", "holder_id", "TEXT"],
  ["asset_holdings", "employee_id", "TEXT"],
];

/** Brings a database created by an earlier version up to date. */
function migrate(handle: Database.Database) {
  const columnsOf = (table: string) =>
    new Set(
      (handle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );

  const seen = new Map<string, Set<string>>();
  for (const [table, column, type] of ADDED_COLUMNS) {
    let existing = seen.get(table);
    if (!existing) {
      existing = columnsOf(table);
      seen.set(table, existing);
    }
    if (!existing.has(column)) {
      handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      existing.add(column);
    }
  }

  // Indexes over added columns, which can only be built once the columns above
  // exist. Backs the "is anything else still using this receipt" check that runs
  // before a shared file is deleted.
  handle.exec(
    `CREATE INDEX IF NOT EXISTS food_receipt ON food_expenses (receipt_key)
       WHERE receipt_key IS NOT NULL`,
  );
}

/** Puts each company's configured starting signatories in place, once. */
function seedSignatories(handle: Database.Database) {
  const insert = handle.prepare(
    `INSERT OR IGNORE INTO signatories (id, company, name, created_at) VALUES (?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const company of Object.values(COMPANIES)) {
    for (const name of company.defaultSignatories) {
      insert.run(newId(), company.slug, name, now);
    }
  }
}

export const sqliteStore: Store = {
  async createVoucher({ company, internalNote, fields }: NewVoucher): Promise<Voucher> {
    const handle = connect();
    const period = periodOf();
    const now = new Date().toISOString();
    const d = denormalize(fields);

    const insert = handle.prepare(`
      INSERT INTO vouchers (
        id, voucher_no, company, status, seq, period, internal_note, fields,
        recipient_name, description, amount, voucher_date, created_at
      ) VALUES (
        @id, @voucher_no, @company, 'pending', @seq, @period, @internal_note, @fields,
        @recipient_name, @description, @amount, @voucher_date, @created_at
      )
    `);

    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM vouchers WHERE company = ? AND period = ?`,
    );

    // The UNIQUE(company, period, seq) constraint is the real guard; the retry
    // loop just picks up the next free number if we lost a race.
    const claim = handle.transaction((): VoucherRow => {
      const { seq } = nextSeq.get(company, period) as { seq: number };
      const id = newId();
      const voucherNo = formatVoucherNo(company, period, seq);
      insert.run({
        id,
        voucher_no: voucherNo,
        company,
        seq,
        period,
        internal_note: internalNote,
        fields: JSON.stringify(fields),
        recipient_name: d.recipientName,
        description: d.description,
        amount: d.amount,
        voucher_date: d.voucherDate,
        created_at: now,
      });
      return handle.prepare(`SELECT * FROM vouchers WHERE id = ?`).get(id) as VoucherRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToVoucher(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a voucher number after several attempts");
  },

  async getVoucher(id) {
    const row = connect().prepare(`SELECT * FROM vouchers WHERE id = ?`).get(id) as
      | VoucherRow
      | undefined;
    return row ? rowToVoucher(row) : null;
  },

  async getVoucherByNo(voucherNo) {
    const row = connect()
      .prepare(`SELECT * FROM vouchers WHERE voucher_no = ?`)
      .get(voucherNo) as VoucherRow | undefined;
    return row ? rowToVoucher(row) : null;
  },

  async attachPdf(id, pdfKey) {
    connect()
      .prepare(`UPDATE vouchers SET pdf_key = ?, generated_at = ? WHERE id = ?`)
      .run(pdfKey, new Date().toISOString(), id);
  },

  async attachScan(id, scanKey, scanName) {
    connect()
      .prepare(
        `UPDATE vouchers
            SET scan_key = ?, scan_name = ?, uploaded_at = ?, status = 'completed'
          WHERE id = ?`,
      )
      .run(scanKey, scanName, new Date().toISOString(), id);
  },

  async removeScan(id) {
    connect()
      .prepare(
        `UPDATE vouchers
            SET scan_key = NULL, scan_name = NULL, uploaded_at = NULL, status = 'pending'
          WHERE id = ?`,
      )
      .run(id);
  },

  async softDelete(id) {
    connect()
      .prepare(`UPDATE vouchers SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(new Date().toISOString(), id);
  },

  async restore(id) {
    connect().prepare(`UPDATE vouchers SET deleted_at = NULL WHERE id = ?`).run(id);
  },

  async listPending(company) {
    const rows = connect()
      .prepare(
        `SELECT * FROM vouchers
          WHERE company = ? AND status = 'pending' AND deleted_at IS NULL
          ORDER BY created_at ASC`,
      )
      .all(company) as VoucherRow[];
    return rows.map(rowToVoucher);
  },

  async search(query: HistoryQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    // "deleted" is the recycle-bin view; every other view hides deleted rows.
    if (query.status === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.status && query.status !== "all") {
        where.push("status = @status");
        params.status = query.status;
      }
    }
    if (query.q?.trim()) {
      where.push(`(
        voucher_no     LIKE @q COLLATE NOCASE OR
        recipient_name LIKE @q COLLATE NOCASE OR
        internal_note  LIKE @q COLLATE NOCASE OR
        description    LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }
    if (query.from) {
      where.push("date(created_at) >= date(@from)");
      params.from = query.from;
    }
    if (query.to) {
      where.push("date(created_at) <= date(@to)");
      params.to = query.to;
    }
    if (query.minAmount != null) {
      where.push("amount IS NOT NULL AND amount >= @minAmount");
      params.minAmount = query.minAmount;
    }
    if (query.maxAmount != null) {
      where.push("amount IS NOT NULL AND amount <= @maxAmount");
      params.maxAmount = query.maxAmount;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM vouchers WHERE ${clause}`)
      .get(params) as { total: number };

    const rows = handle
      .prepare(
        `SELECT * FROM vouchers WHERE ${clause}
          ORDER BY created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as VoucherRow[];

    return { rows: rows.map(rowToVoucher), total };
  },

  async counts(company: CompanySlug) {
    const rows = connect()
      .prepare(
        `SELECT status, COUNT(*) AS n FROM vouchers
          WHERE company = ? AND deleted_at IS NULL
          GROUP BY status`,
      )
      .all(company) as Array<{ status: string; n: number }>;
    const pending = rows.find((r) => r.status === "pending")?.n ?? 0;
    const completed = rows.find((r) => r.status === "completed")?.n ?? 0;
    return { pending, completed, total: pending + completed };
  },

  async listSignatories(company) {
    const rows = connect()
      .prepare(`SELECT * FROM signatories WHERE company = ? ORDER BY name ASC`)
      .all(company) as SignatoryRow[];
    return rows.map(toSignatory);
  },

  async addSignatory(company, name) {
    const handle = connect();
    const trimmed = name.trim();
    handle
      .prepare(
        `INSERT INTO signatories (id, company, name, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (company, name) DO NOTHING`,
      )
      .run(newId(), company, trimmed, new Date().toISOString());
    // If the name already existed, return the existing record rather than failing.
    const row = handle
      .prepare(`SELECT * FROM signatories WHERE company = ? AND name = ?`)
      .get(company, trimmed) as SignatoryRow;
    return toSignatory(row);
  },

  async removeSignatory(id) {
    connect().prepare(`DELETE FROM signatories WHERE id = ?`).run(id);
  },

  /* ---- purchase orders ------------------------------------------------- */

  async createPo({ company, internalNote, doc }: NewPurchaseOrder): Promise<PurchaseOrder> {
    const handle = connect();
    const period = periodOf();
    const now = new Date().toISOString();
    const d = denormalizePo(doc);

    const insert = handle.prepare(`
      INSERT INTO purchase_orders (
        id, po_no, company, status, seq, period, internal_note, doc,
        vendor_name, subject, currency, subtotal, total, po_date, delivery_date,
        created_at, updated_at
      ) VALUES (
        @id, @po_no, @company, 'draft', @seq, @period, @internal_note, @doc,
        @vendor_name, @subject, @currency, @subtotal, @total, @po_date, @delivery_date,
        @created_at, @created_at
      )
    `);

    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM purchase_orders
        WHERE company = ? AND period = ?`,
    );

    // As with vouchers, the UNIQUE (company, period, seq) constraint is the real
    // guard; the retry loop just picks up the next free number if we lost a race.
    const claim = handle.transaction((): PoRow => {
      const { seq } = nextSeq.get(company, period) as { seq: number };
      const id = newId();
      insert.run({
        id,
        po_no: formatPoNo(company, period, seq),
        company,
        seq,
        period,
        internal_note: internalNote,
        doc: JSON.stringify(doc),
        created_at: now,
        ...d,
      });
      return handle.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id) as PoRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToPo(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a purchase order number after several attempts");
  },

  async getPo(id) {
    const row = connect().prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id) as
      | PoRow
      | undefined;
    return row ? rowToPo(row) : null;
  },

  async updatePo(id, doc: PoDoc, internalNote: string) {
    const handle = connect();
    handle
      .prepare(
        `UPDATE purchase_orders SET
            doc = @doc, internal_note = @internal_note, updated_at = @updated_at,
            vendor_name = @vendor_name, subject = @subject, currency = @currency,
            subtotal = @subtotal, total = @total,
            po_date = @po_date, delivery_date = @delivery_date
          WHERE id = @id`,
      )
      .run({
        id,
        doc: JSON.stringify(doc),
        internal_note: internalNote,
        updated_at: new Date().toISOString(),
        ...denormalizePo(doc),
      });

    const row = handle.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id) as
      | PoRow
      | undefined;
    if (!row) throw new Error("Purchase order not found");
    return rowToPo(row);
  },

  async setPoStatus(id, status: PoStatus) {
    const handle = connect();
    const row = handle.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id) as
      | PoRow
      | undefined;
    if (!row) throw new Error("Purchase order not found");

    const patch = poStatusPatch(rowToPo(row), status, new Date().toISOString());
    // COALESCE, because the patch omits updated_at when the change does not
    // alter the printed page — every named parameter still has to be bound.
    handle
      .prepare(
        `UPDATE purchase_orders
            SET status = @status,
                updated_at = COALESCE(@updated_at, updated_at),
                issued_at = @issued_at, closed_at = @closed_at
          WHERE id = @id`,
      )
      .run({ id, updated_at: null, ...patch });
  },

  async attachPoPdf(id, pdfKey) {
    // updated_at is deliberately untouched: rendering the PDF is not an edit to
    // the document, and pdf_at older than updated_at is how a stale file is spotted.
    connect()
      .prepare(`UPDATE purchase_orders SET pdf_key = ?, pdf_at = ? WHERE id = ?`)
      .run(pdfKey, new Date().toISOString(), id);
  },

  async attachPoInvoice(id, invoiceKey, invoiceName) {
    const handle = connect();
    const row = handle.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id) as
      | PoRow
      | undefined;
    if (!row) throw new Error("Purchase order not found");

    const current = rowToPo(row);
    // A cancelled order that turns out to have been delivered anyway keeps its
    // status: reviving it is a decision for the operator, not a side effect of
    // filing a document.
    const status = current.status === "cancelled" ? current.status : "closed";
    const now = new Date().toISOString();

    handle
      .prepare(
        `UPDATE purchase_orders
            SET invoice_key = @key, invoice_name = @name, invoice_at = @now,
                status = @status, closed_at = @closed_at,
                updated_at = COALESCE(@updated_at, updated_at)
          WHERE id = @id`,
      )
      .run({
        id,
        key: invoiceKey,
        name: invoiceName,
        now,
        status,
        closed_at: status === "closed" ? now : current.closedAt,
        // Filing paperwork is not an edit to the document, so the stored PDF
        // stays current unless the status change itself alters the watermark.
        updated_at: statusChangesDocument(current.status, status) ? now : null,
      });
  },

  async removePoInvoice(id) {
    const handle = connect();
    const row = handle.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(id) as
      | PoRow
      | undefined;
    if (!row) throw new Error("Purchase order not found");

    const current = rowToPo(row);
    const status = current.status === "closed" ? "issued" : current.status;
    const now = new Date().toISOString();

    handle
      .prepare(
        `UPDATE purchase_orders
            SET invoice_key = NULL, invoice_name = NULL, invoice_at = NULL,
                status = @status, closed_at = @closed_at,
                updated_at = COALESCE(@updated_at, updated_at)
          WHERE id = @id`,
      )
      .run({
        id,
        status,
        // Reopening clears the close stamp; any other status keeps whatever it had.
        closed_at: current.status === "closed" ? null : current.closedAt,
        updated_at: statusChangesDocument(current.status, status) ? now : null,
      });
  },

  async softDeletePo(id) {
    connect()
      .prepare(
        `UPDATE purchase_orders SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);
  },

  async restorePo(id) {
    connect().prepare(`UPDATE purchase_orders SET deleted_at = NULL WHERE id = ?`).run(id);
  },

  async searchPos(query: PoQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    if (query.status === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.status === "open") {
        where.push(`status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`);
      } else if (query.status && query.status !== "all") {
        where.push("status = @status");
        params.status = query.status;
      }
    }
    if (query.q?.trim()) {
      where.push(`(
        po_no         LIKE @q COLLATE NOCASE OR
        vendor_name   LIKE @q COLLATE NOCASE OR
        subject       LIKE @q COLLATE NOCASE OR
        internal_note LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }
    if (query.from) {
      where.push("po_date IS NOT NULL AND date(po_date) >= date(@from)");
      params.from = query.from;
    }
    if (query.to) {
      where.push("po_date IS NOT NULL AND date(po_date) <= date(@to)");
      params.to = query.to;
    }
    if (query.minAmount != null) {
      where.push("total >= @minAmount");
      params.minAmount = query.minAmount;
    }
    if (query.maxAmount != null) {
      where.push("total <= @maxAmount");
      params.maxAmount = query.maxAmount;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM purchase_orders WHERE ${clause}`)
      .get(params) as { total: number };

    // Ordered by PO date with created_at as the tie-break, so two orders raised
    // the same day still come back in the order they were raised.
    const rows = handle
      .prepare(
        `SELECT * FROM purchase_orders WHERE ${clause}
          ORDER BY po_date DESC, created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as PoRow[];

    return { rows: rows.map(rowToPo), total };
  },

  async poCounts(company: CompanySlug): Promise<PoCounts> {
    const rows = connect()
      .prepare(
        `SELECT status, COUNT(*) AS n FROM purchase_orders
          WHERE company = ? AND deleted_at IS NULL
          GROUP BY status`,
      )
      .all(company) as Array<{ status: string; n: number }>;

    const of = (s: PoStatus) => rows.find((r) => r.status === s)?.n ?? 0;
    const draft = of("draft");
    const issued = of("issued");
    return {
      draft,
      issued,
      closed: of("closed"),
      cancelled: of("cancelled"),
      open: draft + issued,
      total: rows.reduce((sum, r) => sum + r.n, 0),
    };
  },

  async listVendors(company) {
    // Capped: this feeds an autocomplete, and a few hundred distinct vendors is
    // already far more than a workspace of this size will ever have.
    const rows = connect()
      .prepare(
        `SELECT doc, created_at FROM purchase_orders
          WHERE company = ? AND deleted_at IS NULL AND vendor_name <> ''
          ORDER BY created_at DESC
          LIMIT 600`,
      )
      .all(company) as Array<{ doc: string; created_at: string }>;
    return vendorProfilesFrom(rows);
  },

  /* ---- requests for quotation ------------------------------------------ */

  async createRfq({ company, internalNote, doc }: NewRfq) {
    const handle = connect();
    const period = periodOf();
    const now = new Date().toISOString();

    const insert = handle.prepare(`
      INSERT INTO requests_for_quotation (
        id, rfq_no, company, status, seq, period, internal_note, doc,
        subject, currency, item_count, rfq_date, reply_by, created_at, updated_at
      ) VALUES (
        @id, @rfq_no, @company, 'draft', @seq, @period, @internal_note, @doc,
        @subject, @currency, @item_count, @rfq_date, @reply_by, @created_at, @created_at
      )
    `);

    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM requests_for_quotation
        WHERE company = ? AND period = ?`,
    );

    // The UNIQUE (company, period, seq) constraint is the real guard.
    const claim = handle.transaction((): RfqRow => {
      const { seq } = nextSeq.get(company, period) as { seq: number };
      const id = newId();
      insert.run({
        id,
        rfq_no: formatRfqNo(company, period, seq),
        company,
        seq,
        period,
        internal_note: internalNote,
        doc: JSON.stringify(doc),
        created_at: now,
        ...denormalizeRfq(doc),
      });
      return handle
        .prepare(`SELECT * FROM requests_for_quotation WHERE id = ?`)
        .get(id) as RfqRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToRfq(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a request number after several attempts");
  },

  async getRfq(id) {
    const row = connect()
      .prepare(`SELECT * FROM requests_for_quotation WHERE id = ?`)
      .get(id) as RfqRow | undefined;
    return row ? rowToRfq(row) : null;
  },

  async updateRfq(id, doc: RfqDoc, internalNote: string) {
    const handle = connect();
    handle
      .prepare(
        `UPDATE requests_for_quotation SET
            doc = @doc, internal_note = @internal_note, updated_at = @updated_at,
            subject = @subject, currency = @currency, item_count = @item_count,
            rfq_date = @rfq_date, reply_by = @reply_by
          WHERE id = @id`,
      )
      .run({
        id,
        doc: JSON.stringify(doc),
        internal_note: internalNote,
        updated_at: new Date().toISOString(),
        ...denormalizeRfq(doc),
      });

    const row = handle
      .prepare(`SELECT * FROM requests_for_quotation WHERE id = ?`)
      .get(id) as RfqRow | undefined;
    if (!row) throw new Error("Request for quotation not found");
    return rowToRfq(row);
  },

  async setRfqStatus(id, status: RfqStatus) {
    const handle = connect();
    const row = handle
      .prepare(`SELECT * FROM requests_for_quotation WHERE id = ?`)
      .get(id) as RfqRow | undefined;
    if (!row) throw new Error("Request for quotation not found");

    const patch = rfqStatusPatch(rowToRfq(row), status, new Date().toISOString());
    // COALESCE, because the patch omits updated_at when the printed page is
    // unchanged — every named parameter still has to be bound.
    handle
      .prepare(
        `UPDATE requests_for_quotation
            SET status = @status,
                updated_at = COALESCE(@updated_at, updated_at),
                sent_at = @sent_at, closed_at = @closed_at
          WHERE id = @id`,
      )
      .run({ id, updated_at: null, ...patch });
  },

  async attachRfqPdf(id, pdfKey) {
    // updated_at untouched: rendering is not an edit to the document.
    connect()
      .prepare(`UPDATE requests_for_quotation SET pdf_key = ?, pdf_at = ? WHERE id = ?`)
      .run(pdfKey, new Date().toISOString(), id);
  },

  async softDeleteRfq(id) {
    connect()
      .prepare(
        `UPDATE requests_for_quotation SET deleted_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);
  },

  async restoreRfq(id) {
    connect()
      .prepare(`UPDATE requests_for_quotation SET deleted_at = NULL WHERE id = ?`)
      .run(id);
  },

  async searchRfqs(query: RfqQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    if (query.status === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.status === "open") {
        where.push(`status IN (${RFQ_OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`);
      } else if (query.status && query.status !== "all") {
        where.push("status = @status");
        params.status = query.status;
      }
    }
    if (query.q?.trim()) {
      where.push(`(
        rfq_no        LIKE @q COLLATE NOCASE OR
        subject       LIKE @q COLLATE NOCASE OR
        internal_note LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }
    if (query.from) {
      where.push("rfq_date IS NOT NULL AND date(rfq_date) >= date(@from)");
      params.from = query.from;
    }
    if (query.to) {
      where.push("rfq_date IS NOT NULL AND date(rfq_date) <= date(@to)");
      params.to = query.to;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM requests_for_quotation WHERE ${clause}`)
      .get(params) as { total: number };

    const rows = handle
      .prepare(
        `SELECT * FROM requests_for_quotation WHERE ${clause}
          ORDER BY rfq_date DESC, created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as RfqRow[];

    return { rows: rows.map(rowToRfq), total };
  },

  async rfqCounts(company: CompanySlug): Promise<RfqCounts> {
    const rows = connect()
      .prepare(
        `SELECT status, COUNT(*) AS n FROM requests_for_quotation
          WHERE company = ? AND deleted_at IS NULL
          GROUP BY status`,
      )
      .all(company) as Array<{ status: string; n: number }>;

    const of = (s: RfqStatus) => rows.find((r) => r.status === s)?.n ?? 0;
    const draft = of("draft");
    const sent = of("sent");
    return {
      draft,
      sent,
      closed: of("closed"),
      cancelled: of("cancelled"),
      open: draft + sent,
      total: rows.reduce((sum, r) => sum + r.n, 0),
    };
  },

  /* ---- asset register --------------------------------------------------- */

  async createAsset({ company, fields, allot }: NewAsset) {
    const handle = connect();
    const now = new Date().toISOString();

    const insertAsset = handle.prepare(`
      INSERT INTO assets (
        id, asset_no, company, seq, asset_name, condition,
        holder_name, holder_no, holder_id, held_since, created_at, updated_at
      ) VALUES (
        @id, @asset_no, @company, @seq, @asset_name, 'good',
        @holder_name, @holder_no, @holder_id, @held_since, @created_at, @created_at
      )
    `);

    const insertHolding = handle.prepare(`
      INSERT INTO asset_holdings (
        id, asset_id, company, employee_name, employee_no, employee_id, allotted_on,
        returned_on, condition, note, created_at, updated_at
      ) VALUES (
        @id, @asset_id, @company, @employee_name, @employee_no, @employee_id, @allotted_on,
        NULL, 'good', '', @created_at, @created_at
      )
    `);

    // No period filter, and deleted rows are deliberately counted: a number
    // that has been written on an item is spent even if the row was binned.
    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM assets WHERE company = ?`,
    );

    // The asset and its first holding in one transaction, so the register can
    // never show a holder the history does not have. UNIQUE (company, seq) is
    // the real guard on the number. With no allotment there is simply no second
    // insert, and the asset is in stock from the start.
    const claim = handle.transaction((): AssetRow => {
      const { seq } = nextSeq.get(company) as { seq: number };
      const id = newId();
      insertAsset.run({
        id,
        asset_no: formatAssetNo(company, seq),
        company,
        seq,
        asset_name: fields.assetName,
        created_at: now,
        // An asset with no first holder starts in stock, which the register
        // could not represent before the employee dropdown existed.
        ...(allot ? holderColumns(allot) : IN_STOCK_COLUMNS),
      });
      if (allot) {
        insertHolding.run({
          id: newId(),
          asset_id: id,
          company,
          created_at: now,
          ...holdingColumns(allot),
        });
      }
      return handle.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToAsset(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign an asset number after several attempts");
  },

  async getAsset(id) {
    const row = connect().prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as
      | AssetRow
      | undefined;
    return row ? rowToAsset(row) : null;
  },

  async updateAsset(id, fields: AssetFields, holder: AllotFields | null) {
    const handle = connect();
    const now = new Date().toISOString();

    const apply = handle.transaction((): AssetRow => {
      const current = handle.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as
        | AssetRow
        | undefined;
      if (!current) throw new Error("Asset not found");

      // Only the open holding is editable, and only when there is one. A
      // correction to who has it now must not rewrite a closed period.
      const open = holder
        ? (handle
            .prepare(`SELECT id FROM asset_holdings WHERE asset_id = ? AND returned_on IS NULL`)
            .get(id) as { id: string } | undefined)
        : undefined;

      handle
        .prepare(
          `UPDATE assets SET
              asset_name = @asset_name, updated_at = @updated_at,
              holder_name = @holder_name, holder_no = @holder_no,
              holder_id = @holder_id, held_since = @held_since
            WHERE id = @id`,
        )
        .run({
          id,
          asset_name: fields.assetName,
          updated_at: now,
          ...(open && holder
            ? holderColumns(holder)
            : {
                holder_name: current.holder_name,
                holder_no: current.holder_no,
                holder_id: current.holder_id,
                held_since: current.held_since,
              }),
        });

      if (open && holder) {
        handle
          .prepare(
            `UPDATE asset_holdings SET
                employee_name = @employee_name, employee_no = @employee_no,
                employee_id = @employee_id, allotted_on = @allotted_on,
                updated_at = @updated_at
              WHERE id = @id`,
          )
          .run({ id: open.id, updated_at: now, ...holdingColumns(holder) });
      }

      return handle.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow;
    });

    return rowToAsset(apply());
  },

  async returnAsset(id, fields: ReturnFields) {
    const handle = connect();
    const now = new Date().toISOString();

    const apply = handle.transaction((): AssetRow => {
      const open = handle
        .prepare(`SELECT id FROM asset_holdings WHERE asset_id = ? AND returned_on IS NULL`)
        .get(id) as { id: string } | undefined;
      if (!open) throw new Error("That asset is already in stock — nobody has it to return.");

      handle
        .prepare(
          `UPDATE asset_holdings SET
              returned_on = @returned_on, condition = @condition, note = @note,
              updated_at = @updated_at
            WHERE id = @id`,
        )
        .run({
          id: open.id,
          // Stored rather than left null so a closed holding always has an end.
          returned_on: fields.returnedOn || todayIso(),
          condition: fields.condition,
          note: fields.note,
          updated_at: now,
        });

      handle
        .prepare(
          `UPDATE assets SET
              holder_name = '', holder_no = '', holder_id = NULL, held_since = NULL,
              condition = @condition, updated_at = @updated_at
            WHERE id = @id`,
        )
        .run({ id, condition: fields.condition, updated_at: now });

      return handle.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow;
    });

    return rowToAsset(apply());
  },

  async allotAsset(id, allot: AllotFields) {
    const handle = connect();
    const now = new Date().toISOString();

    const apply = handle.transaction((): AssetRow => {
      const current = handle.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as
        | AssetRow
        | undefined;
      if (!current) throw new Error("Asset not found");
      if (current.holder_name) {
        throw new Error(
          `${current.asset_no} is with ${current.holder_name}. Record its return first.`,
        );
      }

      handle
        .prepare(
          `INSERT INTO asset_holdings (
              id, asset_id, company, employee_name, employee_no, employee_id, allotted_on,
              returned_on, condition, note, created_at, updated_at
            ) VALUES (
              @id, @asset_id, @company, @employee_name, @employee_no, @employee_id, @allotted_on,
              NULL, 'good', '', @created_at, @created_at
            )`,
        )
        .run({
          id: newId(),
          asset_id: id,
          company: current.company,
          created_at: now,
          ...holdingColumns(allot),
        });

      handle
        .prepare(
          `UPDATE assets SET
              holder_name = @holder_name, holder_no = @holder_no,
              holder_id = @holder_id, held_since = @held_since,
              updated_at = @updated_at
            WHERE id = @id`,
        )
        .run({ id, updated_at: now, ...holderColumns(allot) });

      return handle.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow;
    });

    return rowToAsset(apply());
  },

  async softDeleteAsset(id) {
    connect()
      .prepare(`UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(new Date().toISOString(), id);
  },

  async restoreAsset(id) {
    connect().prepare(`UPDATE assets SET deleted_at = NULL WHERE id = ?`).run(id);
  },

  async searchAssets(query: AssetQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    if (query.view === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.view === "out") where.push("holder_name <> ''");
      else if (query.view === "stock") where.push("holder_name = ''");
    }

    if (query.q?.trim()) {
      where.push(`(
        asset_no    LIKE @q COLLATE NOCASE OR
        asset_name  LIKE @q COLLATE NOCASE OR
        holder_name LIKE @q COLLATE NOCASE OR
        holder_no   LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM assets WHERE ${clause}`)
      .get(params) as { total: number };

    // Assets out first, then by how long they have been out; then stock. The
    // register is read to find something, and what is out is what moves.
    const rows = handle
      .prepare(
        `SELECT * FROM assets WHERE ${clause}
          ORDER BY (holder_name = '') ASC, held_since DESC, created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as AssetRow[];

    return { rows: rows.map(rowToAsset), total };
  },

  async assetCounts(company: CompanySlug): Promise<AssetCounts> {
    const handle = connect();
    const rows = handle
      .prepare(
        `SELECT holder_name, holder_no, condition FROM assets
          WHERE company = ? AND deleted_at IS NULL`,
      )
      .all(company) as Array<{ holder_name: string; holder_no: string; condition: string }>;

    // Reduced in the app rather than with COUNT(DISTINCT …) so both backends
    // agree on what "the same employee" means — see employeeKey.
    const people = new Set<string>();
    let out = 0;
    let flagged = 0;
    for (const r of rows) {
      if (r.holder_name) {
        out += 1;
        people.add(employeeKey(r.holder_name, r.holder_no));
      }
      if (r.condition !== "good") flagged += 1;
    }

    return {
      total: rows.length,
      out,
      stock: rows.length - out,
      employees: people.size,
      flagged,
    };
  },

  async listHoldings(assetId: string): Promise<AssetHolding[]> {
    const rows = connect()
      .prepare(
        `SELECT * FROM asset_holdings WHERE asset_id = ?
          ORDER BY (returned_on IS NULL) DESC, allotted_on DESC, created_at DESC`,
      )
      .all(assetId) as HoldingRow[];
    return rows.map(rowToHolding);
  },

  async searchHoldings(query: HoldingQuery) {
    const handle = connect();
    const where: string[] = ["h.company = @company", "a.deleted_at IS NULL"];
    const params: Record<string, unknown> = { company: query.company };

    if (query.view === "open") where.push("h.returned_on IS NULL");
    else if (query.view === "closed") where.push("h.returned_on IS NOT NULL");

    // Matched on the link, never the name: an employee's record must show what
    // was genuinely allotted to that register entry and not somebody else who
    // happens to share a spelling.
    if (query.employeeId) {
      where.push("h.employee_id = @employeeId");
      params.employeeId = query.employeeId;
    }

    if (query.q?.trim()) {
      where.push(`(
        h.employee_name LIKE @q COLLATE NOCASE OR
        h.employee_no   LIKE @q COLLATE NOCASE OR
        a.asset_no      LIKE @q COLLATE NOCASE OR
        a.asset_name    LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }

    // Overlap, not containment: a holding that started in July and is still open
    // is part of "who had something in August". Two periods overlap when each
    // starts before the other ends, which the generated span columns make a
    // plain comparison — no NULL cases to spell out.
    if (query.from) {
      where.push("date(h.span_end) >= date(@from)");
      params.from = query.from;
    }
    if (query.to) {
      where.push("date(h.span_start) <= date(@to)");
      params.to = query.to;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(
        `SELECT COUNT(*) AS total FROM asset_holdings h
           JOIN assets a ON a.id = h.asset_id
          WHERE ${clause}`,
      )
      .get(params) as { total: number };

    const rows = handle
      .prepare(
        `SELECT h.*, a.asset_no, a.asset_name FROM asset_holdings h
           JOIN assets a ON a.id = h.asset_id
          WHERE ${clause}
          ORDER BY h.allotted_on DESC, h.created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }) as HoldingWithAssetRow[];

    return { rows: rows.map(rowToHoldingWithAsset), total };
  },

  async attachEmployeeDoc(
    id: string,
    kind: DocKind,
    doc: { key: string; name: string },
  ): Promise<{ previousKey: string | null }> {
    const handle = connect();
    const column = docKeyColumn(kind);

    const row = handle
      .prepare(`SELECT ${column} AS previous FROM employees WHERE id = ?`)
      .get(id) as { previous: string | null } | undefined;
    if (!row) throw new Error("Employee not found");

    const now = new Date().toISOString();
    const columns = docColumns(kind, doc, now);
    const sets = Object.keys(columns)
      .map((c) => `${c} = @${c}`)
      .join(", ");
    handle
      .prepare(`UPDATE employees SET ${sets}, updated_at = @updated_at WHERE id = @id`)
      .run({ id, updated_at: now, ...columns });

    // Returned rather than deleted here: the store does not touch storage, so the
    // caller removes the file it has just replaced.
    return { previousKey: row.previous ?? null };
  },

  async detachEmployeeDoc(id: string, kind: DocKind): Promise<{ key: string | null }> {
    const handle = connect();
    const column = docKeyColumn(kind);

    const row = handle
      .prepare(`SELECT ${column} AS key FROM employees WHERE id = ?`)
      .get(id) as { key: string | null } | undefined;
    if (!row) throw new Error("Employee not found");

    const now = new Date().toISOString();
    const columns = docColumns(kind, null, null);
    const sets = Object.keys(columns)
      .map((c) => `${c} = @${c}`)
      .join(", ");
    handle
      .prepare(`UPDATE employees SET ${sets}, updated_at = @updated_at WHERE id = @id`)
      .run({ id, updated_at: now, ...columns });

    return { key: row.key ?? null };
  },

  async employeeDirectory(company: CompanySlug): Promise<EmployeeSummary[]> {
    const handle = connect();

    const employees = handle
      .prepare(
        `SELECT id, employee_no, name, status FROM employees
          WHERE company = ? AND deleted_at IS NULL
          ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(company) as Array<{
      id: string;
      employee_no: string;
      name: string;
      status: string;
    }>;

    // One grouped count rather than a query per person: the dropdown draws the
    // whole list on every asset form, and a register of forty people would
    // otherwise be forty round trips to render one select.
    const held = handle
      .prepare(
        `SELECT holder_id, COUNT(*) AS n FROM assets
          WHERE company = ? AND deleted_at IS NULL AND holder_id IS NOT NULL
          GROUP BY holder_id`,
      )
      .all(company) as Array<{ holder_id: string; n: number }>;
    const counts = new Map(held.map((h) => [h.holder_id, h.n]));

    return employees.map((e) => ({
      id: e.id,
      employeeNo: e.employee_no ?? "",
      name: e.name ?? "",
      status: isEmployeeStatus(e.status) ? e.status : "active",
      holding: counts.get(e.id) ?? 0,
    }));
  },


  /* ---- asset photographs -------------------------------------------------- */

  async addAssetPhoto(
    assetId: string,
    photo: PhotoFields & { key: string; name: string },
  ): Promise<AssetPhoto> {
    const handle = connect();
    const now = new Date().toISOString();

    const asset = handle
      .prepare(`SELECT company FROM assets WHERE id = ?`)
      .get(assetId) as { company: string } | undefined;
    if (!asset) throw new Error("Asset not found");

    const id = newId();
    handle
      .prepare(
        `INSERT INTO asset_photos (id, asset_id, company, key, name, taken_on, info, created_at)
         VALUES (@id, @asset_id, @company, @key, @name, @taken_on, @info, @created_at)`,
      )
      .run({
        id,
        asset_id: assetId,
        company: asset.company,
        key: photo.key,
        name: photo.name,
        // Defaulted rather than left null: a picture with no date cannot take its
        // place in a sequence, and the sequence is the whole point of the log.
        taken_on: photo.takenOn || todayIso(),
        info: photo.info,
        created_at: now,
      });

    return rowToPhoto(
      handle.prepare(`SELECT * FROM asset_photos WHERE id = ?`).get(id) as PhotoRow,
    );
  },

  async listAssetPhotos(assetId: string): Promise<AssetPhoto[]> {
    return (
      connect()
        .prepare(
          `SELECT * FROM asset_photos WHERE asset_id = ?
            ORDER BY taken_on DESC, created_at DESC`,
        )
        .all(assetId) as PhotoRow[]
    ).map(rowToPhoto);
  },

  async removeAssetPhoto(id: string): Promise<{ key: string } | null> {
    const handle = connect();
    const row = handle
      .prepare(`SELECT key FROM asset_photos WHERE id = ?`)
      .get(id) as { key: string } | undefined;
    if (!row) return null;

    // Hard delete, and the file goes with it. A photograph carries no number and
    // is nobody's record — a picture filed by mistake should leave no trace.
    handle.prepare(`DELETE FROM asset_photos WHERE id = ?`).run(id);
    return { key: row.key };
  },

  async latestAssetPhotos(company: CompanySlug): Promise<AssetThumb[]> {
    // Every photo for the company in one query, reduced in the app. A window
    // function would do it in SQL, but the same reduction has to exist for the
    // Supabase backend anyway, and one shared helper cannot disagree with itself.
    const rows = connect()
      .prepare(`SELECT * FROM asset_photos WHERE company = ?`)
      .all(company) as PhotoRow[];
    return newestPerAsset(rows);
  },

  /* ---- employees --------------------------------------------------------- */

  async createEmployee({ company, fields }: NewEmployee): Promise<Employee> {
    const handle = connect();
    const now = new Date().toISOString();
    const columns = employeeColumns(fields);

    const write = handle.transaction((): EmployeeRow => {
      const clash = findEmployeeByNo(handle, company, columns.employee_no, null);
      if (clash) throw duplicateNumber(columns.employee_no, clash.name);

      const id = newId();
      handle
        .prepare(
          `INSERT INTO employees (
             id, company, employee_no, name, status, left_on, cnic, passport,
             address, phone, kin_name, kin_phone, notes, created_at, updated_at
           ) VALUES (
             @id, @company, @employee_no, @name, @status, @left_on, @cnic, @passport,
             @address, @phone, @kin_name, @kin_phone, @notes, @created_at, @created_at
           )`,
        )
        .run({ id, company, created_at: now, ...columns });

      return handle.prepare(`SELECT * FROM employees WHERE id = ?`).get(id) as EmployeeRow;
    });

    return rowToEmployee(write());
  },

  async getEmployee(id: string): Promise<Employee | null> {
    const row = connect()
      .prepare(`SELECT * FROM employees WHERE id = ?`)
      .get(id) as EmployeeRow | undefined;
    return row ? rowToEmployee(row) : null;
  },

  async updateEmployee(id: string, fields: EmployeeFields): Promise<Employee> {
    const handle = connect();
    const columns = employeeColumns(fields);

    const write = handle.transaction((): EmployeeRow => {
      const current = handle
        .prepare(`SELECT company FROM employees WHERE id = ?`)
        .get(id) as { company: string } | undefined;
      if (!current) throw new Error("Employee not found");

      // Ignoring this row, or renumbering somebody to the number they already
      // have would be refused as a clash with themselves.
      const clash = findEmployeeByNo(
        handle,
        current.company as CompanySlug,
        columns.employee_no,
        id,
      );
      if (clash) throw duplicateNumber(columns.employee_no, clash.name);

      handle
        .prepare(
          `UPDATE employees
              SET employee_no = @employee_no, name = @name, status = @status,
                  left_on = @left_on, cnic = @cnic, passport = @passport,
                  address = @address, phone = @phone, kin_name = @kin_name,
                  kin_phone = @kin_phone, notes = @notes, updated_at = @updated_at
            WHERE id = @id`,
        )
        .run({ id, updated_at: new Date().toISOString(), ...columns });

      return handle.prepare(`SELECT * FROM employees WHERE id = ?`).get(id) as EmployeeRow;
    });

    return rowToEmployee(write());
  },

  async setEmployeeStatus(
    id: string,
    status: EmployeeStatus,
    leftOn: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    connect()
      .prepare(`UPDATE employees SET status = ?, left_on = ?, updated_at = ? WHERE id = ?`)
      // Cleared on the way back to active: a returning employee still carrying a
      // leaving date reads as though they were gone.
      .run(status, status === "active" ? null : leftOn || null, now, id);
  },

  async softDeleteEmployee(id: string): Promise<void> {
    const now = new Date().toISOString();
    connect()
      .prepare(`UPDATE employees SET deleted_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, id);
  },

  async restoreEmployee(id: string): Promise<void> {
    const handle = connect();

    // The number was freed when they were deleted, so somebody else may be using
    // it by now. Restoring into a clash would break the unique index, so it is
    // refused with the same message as a duplicate — the operator renumbers one
    // of the two and tries again.
    const row = handle
      .prepare(`SELECT company, employee_no FROM employees WHERE id = ?`)
      .get(id) as { company: string; employee_no: string } | undefined;
    if (!row) throw new Error("Employee not found");

    const clash = findEmployeeByNo(handle, row.company as CompanySlug, row.employee_no, id);
    if (clash) throw duplicateNumber(row.employee_no, clash.name);

    handle
      .prepare(`UPDATE employees SET deleted_at = NULL, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  },

  async searchEmployees(query: EmployeeQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    if (query.view === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.view === "active") where.push("status = 'active'");
      else if (query.view === "left") where.push("status = 'left'");
    }

    if (query.q?.trim()) {
      where.push(`(
        name        LIKE @q COLLATE NOCASE OR
        employee_no LIKE @q COLLATE NOCASE OR
        cnic        LIKE @q COLLATE NOCASE OR
        phone       LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM employees WHERE ${clause}`)
      .get(params) as { total: number };

    // Active first, then by name. A register is read to find a person, and
    // alphabetical is how you look somebody up — unlike the asset register,
    // which is read to find what is moving and so leads with what is out.
    const rows = handle
      .prepare(
        `SELECT * FROM employees WHERE ${clause}
          ORDER BY (status = 'left') ASC, name COLLATE NOCASE ASC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as EmployeeRow[];

    return { rows: rows.map(rowToEmployee), total };
  },

  async employeeCounts(company: CompanySlug): Promise<EmployeeCounts> {
    const rows = connect()
      .prepare(
        `SELECT status FROM employees WHERE company = ? AND deleted_at IS NULL`,
      )
      .all(company) as Array<{ status: string }>;

    return {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      left: rows.filter((r) => r.status === "left").length,
    };
  },

  /* ---- food ------------------------------------------------------------- */

  async createFood(fields: FoodFields): Promise<FoodExpense> {
    const handle = connect();
    const now = new Date().toISOString();
    const period = periodOf();

    const insert = handle.prepare(`
      INSERT INTO food_expenses (
        id, entry_no, seq, period, date, ordered_for, vendor, details,
        amount, currency, payment_type, paid_by, status, paid_at,
        reference, notes, created_at, updated_at
      ) VALUES (
        @id, @entry_no, @seq, @period, @date, @ordered_for, @vendor, @details,
        @amount, @currency, @payment_type, @paid_by, @status, @paid_at,
        @reference, @notes, @created_at, @created_at
      )
    `);

    // Deleted rows are deliberately counted, as everywhere else: a number that
    // has been quoted to a café is spent even if the row was binned.
    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM food_expenses WHERE period = ?`,
    );

    // UNIQUE (period, seq) is the real guard; the retry loop just picks up the
    // next free number if we lost a race.
    const claim = handle.transaction((): FoodRow => {
      const { seq } = nextSeq.get(period) as { seq: number };
      const id = newId();
      insert.run({
        id,
        entry_no: formatFoodNo(period, seq),
        seq,
        period,
        created_at: now,
        ...foodColumns(fields),
      });
      return handle.prepare(`SELECT * FROM food_expenses WHERE id = ?`).get(id) as FoodRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToFood(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a food entry number after several attempts");
  },

  async getFood(id) {
    const row = connect().prepare(`SELECT * FROM food_expenses WHERE id = ?`).get(id) as
      | FoodRow
      | undefined;
    return row ? rowToFood(row) : null;
  },

  async updateFood(id, fields: FoodFields): Promise<FoodExpense> {
    const handle = connect();
    handle
      .prepare(
        `UPDATE food_expenses SET
            date = @date, ordered_for = @ordered_for, vendor = @vendor,
            details = @details, amount = @amount, currency = @currency,
            payment_type = @payment_type, paid_by = @paid_by, status = @status,
            paid_at = @paid_at, reference = @reference, notes = @notes,
            updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({ id, updated_at: new Date().toISOString(), ...foodColumns(fields) });

    const row = handle.prepare(`SELECT * FROM food_expenses WHERE id = ?`).get(id) as
      | FoodRow
      | undefined;
    if (!row) throw new Error("Food entry not found");
    return rowToFood(row);
  },

  async searchFood(query: FoodQuery) {
    const handle = connect();
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.view === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.view === "pending") where.push("status = 'pending'");
      else if (query.view === "paid") where.push("status = 'paid'");
    }

    if (query.q?.trim()) {
      where.push(`(
        entry_no    LIKE @q COLLATE NOCASE OR
        vendor      LIKE @q COLLATE NOCASE OR
        details     LIKE @q COLLATE NOCASE OR
        ordered_for LIKE @q COLLATE NOCASE OR
        paid_by     LIKE @q COLLATE NOCASE OR
        reference   LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }

    // Both bounds inclusive, matching the SUMIFS the report replaces.
    if (query.from) {
      where.push("date >= @from");
      params.from = query.from;
    }
    if (query.to) {
      where.push("date <= @to");
      params.to = query.to;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM food_expenses WHERE ${clause}`)
      .get(params) as { total: number };

    // By order date, not by when it was typed: the log is read as a diary, and
    // catching up on Monday should not bury Friday's lunch under it.
    const rows = handle
      .prepare(
        `SELECT * FROM food_expenses WHERE ${clause}
          ORDER BY date DESC, seq DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as FoodRow[];

    return { rows: rows.map(rowToFood), total };
  },

  async foodCounts(): Promise<FoodCounts> {
    const rows = connect()
      .prepare(`SELECT * FROM food_expenses WHERE deleted_at IS NULL`)
      .all() as FoodRow[];
    // Summed in the app, not with SUMIFS-in-SQL, so both backends agree on what
    // each figure means. See summariseFood.
    return summariseFood(rows.map(rowToFood));
  },

  async pendingFood(): Promise<FoodExpense[]> {
    const rows = connect()
      .prepare(
        `SELECT * FROM food_expenses
          WHERE deleted_at IS NULL AND status = 'pending'
          ORDER BY date ASC, seq ASC`,
      )
      .all() as FoodRow[];
    return rows.map(rowToFood);
  },

  async foodInRange(from: string | null, to: string | null): Promise<FoodExpense[]> {
    const where = ["deleted_at IS NULL"];
    const params: Record<string, unknown> = {};
    if (from) {
      where.push("date >= @from");
      params.from = from;
    }
    if (to) {
      where.push("date <= @to");
      params.to = to;
    }

    const rows = connect()
      .prepare(
        `SELECT * FROM food_expenses WHERE ${where.join(" AND ")} ORDER BY date ASC, seq ASC`,
      )
      .all(params) as FoodRow[];
    return rows.map(rowToFood);
  },

  async settleFood(
    ids: string[],
    paidAt: string,
    reference: string | null,
    receipt: { key: string; name: string } | null,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const handle = connect();
    const placeholders = ids.map(() => "?").join(", ");
    const now = new Date().toISOString();

    // The status and deleted_at conditions are what make this idempotent: a
    // resubmitted settle form touches nothing, rather than stamping today's date
    // over a payment made last week.
    //
    // COALESCE on the receipt columns for the same reason as `reference`:
    // settling without attaching anything must not wipe proof already on file.
    const result = handle
      .prepare(
        `UPDATE food_expenses SET
            status = 'paid', paid_at = ?, reference = COALESCE(?, reference),
            receipt_key = COALESCE(?, receipt_key),
            receipt_name = COALESCE(?, receipt_name),
            receipt_at = CASE WHEN ? IS NULL THEN receipt_at ELSE ? END,
            updated_at = ?
          WHERE id IN (${placeholders}) AND status = 'pending' AND deleted_at IS NULL`,
      )
      .run(
        paidAt,
        reference,
        receipt?.key ?? null,
        receipt?.name ?? null,
        receipt?.key ?? null,
        now,
        now,
        ...ids,
      );

    return result.changes;
  },

  async attachFoodReceipt(id: string, receipt: { key: string; name: string }) {
    const handle = connect();
    handle
      .prepare(
        `UPDATE food_expenses SET
            receipt_key = ?, receipt_name = ?, receipt_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(receipt.key, receipt.name, new Date().toISOString(), new Date().toISOString(), id);

    const row = handle.prepare(`SELECT * FROM food_expenses WHERE id = ?`).get(id) as
      | FoodRow
      | undefined;
    if (!row) throw new Error("Food entry not found");
    return rowToFood(row);
  },

  async detachFoodReceipt(id: string) {
    const handle = connect();
    const current = handle
      .prepare(`SELECT receipt_key FROM food_expenses WHERE id = ?`)
      .get(id) as { receipt_key: string | null } | undefined;
    const key = current?.receipt_key ?? null;
    if (!key) return { key: null, stillReferenced: false };

    handle
      .prepare(
        `UPDATE food_expenses SET
            receipt_key = NULL, receipt_name = NULL, receipt_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);

    // Counted after the unlink, so this entry cannot count itself.
    const { n } = handle
      .prepare(
        `SELECT COUNT(*) AS n FROM food_expenses WHERE receipt_key = ? AND deleted_at IS NULL`,
      )
      .get(key) as { n: number };

    return { key, stillReferenced: n > 0 };
  },

  async unsettleFood(id: string): Promise<FoodExpense> {
    const handle = connect();
    // The receipt goes with the payment it was proof of. The stored file is left
    // alone — the rest of the settlement may still be pointing at it.
    handle
      .prepare(
        `UPDATE food_expenses SET
            status = 'pending', paid_at = NULL,
            receipt_key = NULL, receipt_name = NULL, receipt_at = NULL,
            updated_at = ?
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);

    const row = handle.prepare(`SELECT * FROM food_expenses WHERE id = ?`).get(id) as
      | FoodRow
      | undefined;
    if (!row) throw new Error("Food entry not found");
    return rowToFood(row);
  },

  async softDeleteFood(id) {
    connect()
      .prepare(`UPDATE food_expenses SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(new Date().toISOString(), id);
  },

  async restoreFood(id) {
    connect().prepare(`UPDATE food_expenses SET deleted_at = NULL WHERE id = ?`).run(id);
  },

  async foodNames() {
    // Newest first, because the most recent spelling of a name wins.
    const rows = connect()
      .prepare(
        `SELECT * FROM food_expenses WHERE deleted_at IS NULL
          ORDER BY date DESC, seq DESC LIMIT 400`,
      )
      .all() as FoodRow[];
    return foodNamesFrom(rows);
  },

  async foodSpendRows(): Promise<SpendRow[]> {
    const rows = connect()
      .prepare(
        `SELECT status, currency, amount, date FROM food_expenses WHERE deleted_at IS NULL`,
      )
      .all() as Array<{ status: string; currency: string; amount: number; date: string }>;

    return rows.map((r) => ({
      kind: "food" as const,
      // No company: the expenditure report shows food as one combined figure
      // rather than attributing a shared lunch to one workspace or the other.
      company: null,
      status: r.status,
      currency: r.currency || "PKR",
      amount: r.amount,
      date: r.date,
    }));
  },

  /* ---- miscellaneous payments -------------------------------------------- */

  async createMisc({ company, fields }: NewMiscPayment): Promise<MiscPayment> {
    const handle = connect();
    const now = new Date().toISOString();
    const period = periodOf();

    const insert = handle.prepare(`
      INSERT INTO misc_payments (
        id, payment_no, company, seq, period, date, amount, currency, notes,
        created_at, updated_at
      ) VALUES (
        @id, @payment_no, @company, @seq, @period, @date, @amount, @currency,
        @notes, @created_at, @created_at
      )
    `);

    // Deleted rows are counted, as everywhere else: a number written on a
    // receipt is spent even if the row was later binned.
    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM misc_payments WHERE company = ? AND period = ?`,
    );

    // UNIQUE (company, period, seq) is the real guard; the retry loop just picks
    // up the next free number if we lost a race.
    const claim = handle.transaction((): MiscRow => {
      const { seq } = nextSeq.get(company, period) as { seq: number };
      const id = newId();
      insert.run({
        id,
        payment_no: formatMiscNo(company, period, seq),
        company,
        seq,
        period,
        created_at: now,
        ...miscColumns(fields),
      });
      return handle.prepare(`SELECT * FROM misc_payments WHERE id = ?`).get(id) as MiscRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToMisc(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a payment number after several attempts");
  },

  async getMisc(id) {
    const row = connect().prepare(`SELECT * FROM misc_payments WHERE id = ?`).get(id) as
      | MiscRow
      | undefined;
    return row ? rowToMisc(row) : null;
  },

  async updateMisc(id, fields: MiscFields): Promise<MiscPayment> {
    const handle = connect();
    handle
      .prepare(
        `UPDATE misc_payments SET
            date = @date, amount = @amount, currency = @currency, notes = @notes,
            updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({ id, updated_at: new Date().toISOString(), ...miscColumns(fields) });

    const row = handle.prepare(`SELECT * FROM misc_payments WHERE id = ?`).get(id) as
      | MiscRow
      | undefined;
    if (!row) throw new Error("Payment not found");
    return rowToMisc(row);
  },

  async attachMiscProof(id: string, proof: { key: string; name: string }) {
    const handle = connect();
    // Read before the write, so the caller is handed the file it is now
    // responsible for deleting. Nothing else can be pointing at it.
    const current = handle.prepare(`SELECT proof_key FROM misc_payments WHERE id = ?`).get(id) as
      | { proof_key: string | null }
      | undefined;
    if (!current) throw new Error("Payment not found");

    const now = new Date().toISOString();
    handle
      .prepare(
        `UPDATE misc_payments SET
            proof_key = ?, proof_name = ?, proof_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(proof.key, proof.name, now, now, id);

    return { previousKey: current.proof_key ?? null };
  },

  async detachMiscProof(id: string) {
    const handle = connect();
    const current = handle.prepare(`SELECT proof_key FROM misc_payments WHERE id = ?`).get(id) as
      | { proof_key: string | null }
      | undefined;
    const key = current?.proof_key ?? null;
    if (!key) return { key: null };

    handle
      .prepare(
        `UPDATE misc_payments SET
            proof_key = NULL, proof_name = NULL, proof_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);

    return { key };
  },

  async softDeleteMisc(id) {
    connect()
      .prepare(`UPDATE misc_payments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(new Date().toISOString(), id);
  },

  async restoreMisc(id) {
    connect().prepare(`UPDATE misc_payments SET deleted_at = NULL WHERE id = ?`).run(id);
  },

  async searchMisc(query: MiscQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    if (query.view === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
      if (query.view === "with-proof") where.push("proof_key IS NOT NULL");
      else if (query.view === "no-proof") where.push("proof_key IS NULL");
    }

    if (query.q?.trim()) {
      where.push(`(
        payment_no LIKE @q COLLATE NOCASE OR
        notes      LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }
    if (query.from) {
      where.push("date >= @from");
      params.from = query.from;
    }
    if (query.to) {
      where.push("date <= @to");
      params.to = query.to;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM misc_payments WHERE ${clause}`)
      .get(params) as { total: number };

    // By the payment date, then by number within a day — the same ordering the
    // food log uses, and for the same reason: this is read as a diary and is
    // often caught up on late, so sorting by creation would bury Friday's
    // parking fee under Monday's catch-up.
    const rows = handle
      .prepare(
        `SELECT * FROM misc_payments WHERE ${clause}
          ORDER BY date DESC, seq DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as MiscRow[];

    return { rows: rows.map(rowToMisc), total };
  },

  async miscCounts(company: CompanySlug): Promise<MiscCounts> {
    const rows = connect()
      .prepare(`SELECT * FROM misc_payments WHERE company = ? AND deleted_at IS NULL`)
      .all(company) as MiscRow[];
    return summariseMisc(rows.map(rowToMisc));
  },

  /* ---- expenditure ------------------------------------------------------ */

  async spendRows(company: CompanySlug): Promise<SpendRow[]> {
    const handle = connect();

    // Vouchers are PKR by construction — the template prints "AMOUNT PAID (PKR)"
    // and amount-words.ts speaks Rupees — so the currency is stated rather than
    // stored. `amount` is NULL when the operator left it blank to write by hand.
    const vouchers = handle
      .prepare(
        `SELECT status, amount, COALESCE(voucher_date, date(created_at)) AS date
           FROM vouchers
          WHERE company = ? AND deleted_at IS NULL`,
      )
      .all(company) as Array<{ status: string; amount: number | null; date: string }>;

    const orders = handle
      .prepare(
        `SELECT status, currency, total, COALESCE(po_date, date(created_at)) AS date
           FROM purchase_orders
          WHERE company = ? AND deleted_at IS NULL`,
      )
      .all(company) as Array<{
      status: string;
      currency: string;
      total: number | null;
      date: string;
    }>;

    // A misc payment has no lifecycle, so `status` carries the one thing left
    // worth reporting about it: whether there is a receipt behind it. It changes
    // no total — see `CurrencyTotal.misc` — it is the caveat beside them.
    const misc = handle
      .prepare(
        `SELECT currency, amount, date, proof_key FROM misc_payments
          WHERE company = ? AND deleted_at IS NULL`,
      )
      .all(company) as Array<{
      currency: string;
      amount: number;
      date: string;
      proof_key: string | null;
    }>;

    return [
      ...vouchers.map((v) => ({
        kind: "voucher" as const,
        company,
        status: v.status,
        currency: "PKR",
        amount: v.amount,
        date: v.date,
      })),
      ...orders.map((o) => ({
        kind: "po" as const,
        company,
        status: o.status,
        currency: o.currency || "PKR",
        amount: o.total,
        date: o.date,
      })),
      ...misc.map((m) => ({
        kind: "misc" as const,
        company,
        status: m.proof_key ? "proof" : "no-proof",
        currency: m.currency || "PKR",
        amount: m.amount,
        date: m.date,
      })),
    ];
  },

  /* ---- investor funding -------------------------------------------------- */

  async createTranche(fields: TrancheFields): Promise<Tranche> {
    const handle = connect();
    const now = new Date().toISOString();

    const insert = handle.prepare(`
      INSERT INTO funding_tranches (
        id, tranche_no, seq, label, funder, sent_amount, sent_currency, sent_date,
        recv_amount, recv_currency, recv_date, account, reference, notes,
        created_at, updated_at
      ) VALUES (
        @id, @tranche_no, @seq, @label, @funder, @sent_amount, @sent_currency, @sent_date,
        @recv_amount, @recv_currency, @recv_date, @account, @reference, @notes,
        @created_at, @created_at
      )
    `);

    // Deleted rows are counted, as everywhere else: a number already quoted in a
    // statement to the investor is spent even if the row was later binned.
    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM funding_tranches`,
    );

    // UNIQUE(seq) is the real guard; the retry loop just picks up the next free
    // number if we lost a race.
    const claim = handle.transaction((): TrancheRow => {
      const { seq } = nextSeq.get() as { seq: number };
      const id = newId();
      insert.run({
        id,
        tranche_no: formatTrancheNo(seq),
        seq,
        created_at: now,
        ...trancheColumns(fields),
      });
      return handle.prepare(`SELECT * FROM funding_tranches WHERE id = ?`).get(id) as TrancheRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToTranche(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a tranche number after several attempts");
  },

  async getTranche(id: string): Promise<Tranche | null> {
    const row = connect()
      .prepare(`SELECT * FROM funding_tranches WHERE id = ?`)
      .get(id) as TrancheRow | undefined;
    return row ? rowToTranche(row) : null;
  },

  async updateTranche(id: string, fields: TrancheFields): Promise<Tranche> {
    const handle = connect();
    handle
      .prepare(
        `UPDATE funding_tranches
            SET label = @label, funder = @funder,
                sent_amount = @sent_amount, sent_currency = @sent_currency,
                sent_date = @sent_date,
                recv_amount = @recv_amount, recv_currency = @recv_currency,
                recv_date = @recv_date,
                account = @account, reference = @reference, notes = @notes,
                updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({ id, updated_at: new Date().toISOString(), ...trancheColumns(fields) });

    const row = handle
      .prepare(`SELECT * FROM funding_tranches WHERE id = ?`)
      .get(id) as TrancheRow | undefined;
    if (!row) throw new Error("Tranche not found");
    return rowToTranche(row);
  },

  async setTrancheClosed(id: string, closed: boolean): Promise<void> {
    connect()
      .prepare(
        `UPDATE funding_tranches SET closed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(closed ? new Date().toISOString() : null, new Date().toISOString(), id);
  },

  async softDeleteTranche(id: string): Promise<void> {
    const now = new Date().toISOString();
    connect()
      .prepare(`UPDATE funding_tranches SET deleted_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, id);
  },

  async restoreTranche(id: string): Promise<void> {
    connect()
      .prepare(`UPDATE funding_tranches SET deleted_at = NULL, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  },

  async fundingLedger(): Promise<Array<{ tranche: Tranche; debits: Debit[] }>> {
    const handle = connect();

    const tranches = handle
      .prepare(
        `SELECT * FROM funding_tranches
          WHERE deleted_at IS NULL
          ORDER BY recv_date DESC, seq DESC`,
      )
      .all() as TrancheRow[];

    // One query for every debit rather than one per bucket. Two round trips
    // whatever the number of tranches, and the grouping below costs nothing at
    // this scale.
    const debits = handle
      .prepare(`SELECT tranche_id, amount, source_kind FROM tranche_allocations`)
      .all() as Array<{ tranche_id: string; amount: number; source_kind: string }>;

    const byTranche = new Map<string, Debit[]>();
    for (const d of debits) {
      const list = byTranche.get(d.tranche_id) ?? [];
      list.push({
        amount: Number(d.amount) || 0,
        sourceKind: isSourceKind(d.source_kind) ? d.source_kind : "direct",
      });
      byTranche.set(d.tranche_id, list);
    }

    return tranches.map((row) => ({
      tranche: rowToTranche(row),
      debits: byTranche.get(row.id) ?? [],
    }));
  },

  async listAllocations(trancheId: string): Promise<Allocation[]> {
    return (
      connect()
        .prepare(
          `SELECT * FROM tranche_allocations
            WHERE tranche_id = ?
            ORDER BY source_date DESC, created_at DESC`,
        )
        .all(trancheId) as AllocationRow[]
    ).map(rowToAllocation);
  },

  async allocate(rows: NewAllocation[]): Promise<void> {
    if (rows.length === 0) return;

    const handle = connect();
    const now = new Date().toISOString();

    const insert = handle.prepare(`
      INSERT INTO tranche_allocations (
        id, tranche_id, source_kind, source_id, amount, source_amount, source_total,
        source_currency, rate, source_ref, source_label, source_company, source_date,
        note, created_at, updated_at
      ) VALUES (
        @id, @tranche_id, @source_kind, @source_id, @amount, @source_amount, @source_total,
        @source_currency, @rate, @source_ref, @source_label, @source_company, @source_date,
        @note, @created_at, @created_at
      )
    `);

    const bucketOf = handle.prepare(
      `SELECT tranche_no, recv_amount, recv_currency FROM funding_tranches
        WHERE id = ? AND deleted_at IS NULL`,
    );
    const drawnFrom = handle.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM tranche_allocations WHERE tranche_id = ?`,
    );
    const againstSource = handle.prepare(
      `SELECT COALESCE(SUM(source_amount), 0) AS total FROM tranche_allocations
        WHERE source_kind = ? AND source_id = ?`,
    );

    // The whole batch is checked before any of it is written, and the requested
    // rows are totalled per bucket and per expense first: a split of one voucher
    // across two tranches has to be judged as one act, or each half passes on
    // its own and the pair overdraws.
    const write = handle.transaction(() => {
      const perTranche = new Map<string, number>();
      const perSource = new Map<string, { requested: number; row: NewAllocation }>();

      for (const r of rows) {
        perTranche.set(r.trancheId, paisa(r.amount) + (perTranche.get(r.trancheId) ?? 0));
        const key = `${r.sourceKind}:${r.sourceId}`;
        const seen = perSource.get(key);
        perSource.set(key, {
          requested: paisa(r.sourceAmount) + (seen?.requested ?? 0),
          row: r,
        });
      }

      for (const [trancheId, requested] of perTranche) {
        const bucket = bucketOf.get(trancheId) as
          | { tranche_no: string; recv_amount: number; recv_currency: string }
          | undefined;
        if (!bucket) throw new Error("That tranche no longer exists.");

        const { total } = drawnFrom.get(trancheId) as { total: number };
        const remaining = paisa(Number(bucket.recv_amount) || 0) - paisa(Number(total) || 0);
        if (requested > remaining) {
          throw new Error(
            overdrawMessage(
              bucket.tranche_no,
              bucket.recv_currency || "PKR",
              remaining / 100,
              requested / 100,
            ),
          );
        }
      }

      for (const { requested, row } of perSource.values()) {
        // A document with no recorded total has no ceiling to check against —
        // that is the whole point of allowing a blank-amount voucher to be
        // attributed on the operator's word.
        if (row.sourceTotal == null) continue;
        const { total: already } = againstSource.get(row.sourceKind, row.sourceId) as {
          total: number;
        };
        const ceiling = paisa(row.sourceTotal);
        if (paisa(Number(already) || 0) + requested > ceiling) {
          throw new Error(
            overAllocateMessage(
              row.sourceRef,
              row.sourceCurrency || "PKR",
              row.sourceTotal,
              (Number(already) || 0),
              requested / 100,
            ),
          );
        }
      }

      for (const r of rows) {
        insert.run({ id: newId(), created_at: now, ...allocationColumns(r) });
      }
    });

    write();
  },

  async updateAllocation(
    id: string,
    amount: number,
    sourceAmount: number,
    note: string | null,
  ): Promise<void> {
    const handle = connect();

    const write = handle.transaction(() => {
      const current = handle
        .prepare(`SELECT * FROM tranche_allocations WHERE id = ?`)
        .get(id) as AllocationRow | undefined;
      if (!current) throw new Error("That allocation no longer exists.");

      const bucket = handle
        .prepare(
          `SELECT tranche_no, recv_amount, recv_currency FROM funding_tranches WHERE id = ?`,
        )
        .get(current.tranche_id) as
        | { tranche_no: string; recv_amount: number; recv_currency: string }
        | undefined;
      if (!bucket) throw new Error("That tranche no longer exists.");

      // Both guards again, with this row's own current figures taken out of the
      // running totals first — otherwise correcting a row downwards is refused
      // for exceeding a balance it is itself the reason for.
      const { total: drawn } = handle
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM tranche_allocations
            WHERE tranche_id = ? AND id != ?`,
        )
        .get(current.tranche_id, id) as { total: number };

      const remaining = paisa(Number(bucket.recv_amount) || 0) - paisa(Number(drawn) || 0);
      if (paisa(amount) > remaining) {
        throw new Error(
          overdrawMessage(
            bucket.tranche_no,
            bucket.recv_currency || "PKR",
            remaining / 100,
            amount,
          ),
        );
      }

      if (current.source_total != null) {
        const { total: already } = handle
          .prepare(
            `SELECT COALESCE(SUM(source_amount), 0) AS total FROM tranche_allocations
              WHERE source_kind = ? AND source_id = ? AND id != ?`,
          )
          .get(current.source_kind, current.source_id, id) as { total: number };

        const ceiling = paisa(Number(current.source_total));
        if (paisa(Number(already) || 0) + paisa(sourceAmount) > ceiling) {
          throw new Error(
            overAllocateMessage(
              current.source_ref ?? "",
              current.source_currency || "PKR",
              Number(current.source_total),
              Number(already) || 0,
              sourceAmount,
            ),
          );
        }
      }

      handle
        .prepare(
          `UPDATE tranche_allocations
              SET amount = ?, source_amount = ?,
                  rate = ?, note = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          amount,
          sourceAmount,
          // Kept consistent with the two amounts rather than left at whatever it
          // was: a corrected pair with a stale rate is three numbers that no
          // longer multiply together.
          sourceAmount > 0 ? amount / sourceAmount : 1,
          note?.trim() || null,
          new Date().toISOString(),
          id,
        );
    });

    write();
  },

  async removeAllocation(id: string): Promise<void> {
    // Hard delete, unlike everything else in the portal. An allocation carries
    // no number of its own and is nobody's record — it is a statement about
    // where money came from, and an incorrect one should leave no trace.
    connect().prepare(`DELETE FROM tranche_allocations WHERE id = ?`).run(id);
  },

  async releaseSource(sourceKind: SourceKind, sourceId: string): Promise<string[]> {
    const handle = connect();

    // The affected tranches are read before the delete, not after, so the caller
    // can revalidate the pages whose balances just changed.
    const release = handle.transaction((): string[] => {
      const rows = handle
        .prepare(
          `SELECT DISTINCT tranche_id FROM tranche_allocations
            WHERE source_kind = ? AND source_id = ?`,
        )
        .all(sourceKind, sourceId) as Array<{ tranche_id: string }>;

      handle
        .prepare(`DELETE FROM tranche_allocations WHERE source_kind = ? AND source_id = ?`)
        .run(sourceKind, sourceId);

      return rows.map((r) => r.tranche_id);
    });

    return release();
  },

  async allocatable(): Promise<AllocatableItem[]> {
    const handle = connect();

    // Vouchers are PKR by construction — the template prints "AMOUNT PAID (PKR)"
    // — so the currency is stated rather than stored, the same as in spendRows.
    // `amount` is NULL when the operator left it blank to write in by hand.
    const vouchers = handle
      .prepare(
        `SELECT id, voucher_no AS ref, company, status, recipient_name, description, amount,
                COALESCE(voucher_date, date(created_at)) AS date
           FROM vouchers
          WHERE deleted_at IS NULL`,
      )
      .all() as Array<{
      id: string;
      ref: string;
      company: string;
      status: string;
      recipient_name: string | null;
      description: string | null;
      amount: number | null;
      date: string;
    }>;

    // Cancelled orders are excluded: nothing was ever spent on one, so offering
    // it for allocation would invite attributing money that never moved. Drafts
    // are offered — a draft that was in fact paid is exactly the kind of thing
    // this ledger is for catching.
    const orders = handle
      .prepare(
        `SELECT id, po_no AS ref, company, status, currency, total, vendor_name, subject,
                COALESCE(po_date, date(created_at)) AS date
           FROM purchase_orders
          WHERE deleted_at IS NULL AND status != 'cancelled'`,
      )
      .all() as Array<{
      id: string;
      ref: string;
      company: string;
      status: string;
      currency: string;
      total: number | null;
      vendor_name: string | null;
      subject: string | null;
      date: string;
    }>;

    const food = handle
      .prepare(
        `SELECT id, entry_no AS ref, status, currency, amount, vendor, details, date
           FROM food_expenses
          WHERE deleted_at IS NULL`,
      )
      .all() as Array<{
      id: string;
      ref: string;
      status: string;
      currency: string;
      amount: number | null;
      vendor: string | null;
      details: string | null;
      date: string;
    }>;

    // Every live payment. There is no status to filter on and nothing to
    // exclude: unlike a cancelled order, a miscellaneous payment only exists
    // because the money already went out.
    const misc = handle
      .prepare(
        `SELECT id, payment_no AS ref, company, currency, amount, notes, date
           FROM misc_payments
          WHERE deleted_at IS NULL`,
      )
      .all() as Array<{
      id: string;
      ref: string;
      company: string;
      currency: string;
      amount: number | null;
      notes: string | null;
      date: string;
    }>;

    const direct = handle
      .prepare(
        `SELECT id, entry_no AS ref, company, currency, amount, payee, details, date
           FROM tranche_expenses
          WHERE deleted_at IS NULL`,
      )
      .all() as Array<{
      id: string;
      ref: string;
      company: string | null;
      currency: string;
      amount: number | null;
      payee: string | null;
      details: string | null;
      date: string;
    }>;

    const placed = handle
      .prepare(
        `SELECT a.source_kind, a.source_id, a.source_amount, a.amount,
                a.tranche_id, t.tranche_no
           FROM tranche_allocations a
           JOIN funding_tranches t ON t.id = a.tranche_id
          WHERE t.deleted_at IS NULL`,
      )
      .all() as Array<{
      source_kind: string;
      source_id: string;
      source_amount: number;
      amount: number;
      tranche_id: string;
      tranche_no: string;
    }>;

    return assembleAllocatable({ vouchers, orders, food, misc, direct, placed });
  },

  async createDirect(fields: DirectFields, allocateTo: string | null): Promise<DirectExpense> {
    const handle = connect();
    const now = new Date().toISOString();
    const period = periodOf();

    const insert = handle.prepare(`
      INSERT INTO tranche_expenses (
        id, entry_no, seq, period, date, payee, details, amount, currency,
        company, notes, created_at, updated_at
      ) VALUES (
        @id, @entry_no, @seq, @period, @date, @payee, @details, @amount, @currency,
        @company, @notes, @created_at, @created_at
      )
    `);

    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM tranche_expenses WHERE period = ?`,
    );

    const allocation = handle.prepare(`
      INSERT INTO tranche_allocations (
        id, tranche_id, source_kind, source_id, amount, source_amount, source_total,
        source_currency, rate, source_ref, source_label, source_company, source_date,
        note, created_at, updated_at
      ) VALUES (
        @id, @tranche_id, 'direct', @source_id, @amount, @amount, @amount,
        @currency, 1, @ref, @label, @company, @date, NULL, @created_at, @created_at
      )
    `);

    // The expense and its allocation in one transaction, the way createAsset
    // writes an asset and its first holding: an expense typed into a bucket is
    // already attributed by the act of typing it there, and asking twice is
    // asking to be forgotten once.
    const claim = handle.transaction((): DirectRow => {
      const { seq } = nextSeq.get(period) as { seq: number };
      const id = newId();
      insert.run({
        id,
        entry_no: formatDirectNo(period, seq),
        seq,
        period,
        created_at: now,
        ...directColumns(fields),
      });

      if (allocateTo) {
        const bucket = handle
          .prepare(
            `SELECT tranche_no, recv_amount, recv_currency FROM funding_tranches
              WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(allocateTo) as
          | { tranche_no: string; recv_amount: number; recv_currency: string }
          | undefined;

        // Silently skipping is deliberate for a currency mismatch — there is no
        // rate to convert at, and inventing one is worse than leaving the entry
        // in the queue for somebody to allocate with a rate they chose. The
        // action tells the operator which happened.
        if (bucket && (bucket.recv_currency || "PKR") === (fields.currency || "PKR")) {
          const { total } = handle
            .prepare(
              `SELECT COALESCE(SUM(amount), 0) AS total FROM tranche_allocations
                WHERE tranche_id = ?`,
            )
            .get(allocateTo) as { total: number };

          const remaining =
            paisa(Number(bucket.recv_amount) || 0) - paisa(Number(total) || 0);
          if (paisa(fields.amount) > remaining) {
            throw new Error(
              overdrawMessage(
                bucket.tranche_no,
                bucket.recv_currency || "PKR",
                remaining / 100,
                fields.amount,
              ),
            );
          }

          allocation.run({
            id: newId(),
            tranche_id: allocateTo,
            source_id: id,
            amount: fields.amount,
            currency: fields.currency || "PKR",
            ref: formatDirectNo(period, seq),
            label: fields.details.trim() || fields.payee.trim(),
            company: fields.company,
            date: fields.date,
            created_at: now,
          });
        }
      }

      return handle
        .prepare(`SELECT * FROM tranche_expenses WHERE id = ?`)
        .get(id) as DirectRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToDirect(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a direct entry number after several attempts");
  },

  async getDirect(id: string): Promise<DirectExpense | null> {
    const row = connect()
      .prepare(`SELECT * FROM tranche_expenses WHERE id = ?`)
      .get(id) as DirectRow | undefined;
    return row ? rowToDirect(row) : null;
  },

  async updateDirect(id: string, fields: DirectFields): Promise<DirectExpense> {
    const handle = connect();
    handle
      .prepare(
        `UPDATE tranche_expenses
            SET date = @date, payee = @payee, details = @details, amount = @amount,
                currency = @currency, company = @company, notes = @notes,
                updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({ id, updated_at: new Date().toISOString(), ...directColumns(fields) });

    const row = handle
      .prepare(`SELECT * FROM tranche_expenses WHERE id = ?`)
      .get(id) as DirectRow | undefined;
    if (!row) throw new Error("Entry not found");
    return rowToDirect(row);
  },

  async softDeleteDirect(id: string): Promise<void> {
    const now = new Date().toISOString();
    connect()
      .prepare(`UPDATE tranche_expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, id);
  },

  async restoreDirect(id: string): Promise<void> {
    connect()
      .prepare(`UPDATE tranche_expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  },

  async listDirect(): Promise<DirectExpense[]> {
    return (
      connect()
        .prepare(
          `SELECT * FROM tranche_expenses
            WHERE deleted_at IS NULL
            ORDER BY date DESC, created_at DESC`,
        )
        .all() as DirectRow[]
    ).map(rowToDirect);
  },

  async directPayees(): Promise<string[]> {
    return directPayeesFrom(
      connect()
        .prepare(
          `SELECT * FROM tranche_expenses
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 400`,
        )
        .all() as DirectRow[],
    );
  },

  /* ---- settings -------------------------------------------------------- */

  async getSettings(company): Promise<CompanySettings> {
    const row = connect()
      .prepare(`SELECT data FROM company_settings WHERE company = ?`)
      .get(company) as { data: string } | undefined;
    if (!row) return mergeSettings(null);
    try {
      return mergeSettings(JSON.parse(row.data));
    } catch {
      // Corrupt JSON should give the operator working defaults, not a 500.
      return mergeSettings(null);
    }
  },

  async saveSettings(company, patch) {
    const current = await sqliteStore.getSettings(company);
    const next = mergeSettings({ ...current, ...patch, po: { ...current.po, ...patch.po } });
    connect()
      .prepare(
        `INSERT INTO company_settings (company, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (company) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(company, JSON.stringify(next), new Date().toISOString());
    return next;
  },

  /* ---- notifications ----------------------------------------------------- */

  async createNotification({ company, fields }: NewNotification): Promise<Notification> {
    const handle = connect();
    const period = periodOf();
    const now = new Date().toISOString();

    const insert = handle.prepare(`
      INSERT INTO notifications (
        id, notif_no, company, seq, period, headline, body, tag, sender,
        notify_date, created_at
      ) VALUES (
        @id, @notif_no, @company, @seq, @period, @headline, @body, @tag, @sender,
        @notify_date, @created_at
      )
    `);

    const nextSeq = handle.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM notifications WHERE company = ? AND period = ?`,
    );

    // The UNIQUE(company, period, seq) constraint is the real guard; the retry
    // loop just picks up the next free number if we lost a race.
    const claim = handle.transaction((): NotificationRow => {
      const { seq } = nextSeq.get(company, period) as { seq: number };
      const id = newId();
      insert.run({
        id,
        notif_no: formatNotifNo(company, period, seq),
        company,
        seq,
        period,
        headline: fields.headline,
        body: fields.body,
        tag: fields.tag,
        sender: fields.sender,
        notify_date: fields.notifyDate || null,
        created_at: now,
      });
      return handle.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id) as NotificationRow;
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return rowToNotification(claim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    throw new Error("Could not assign a notification number after several attempts");
  },

  async getNotification(id) {
    const row = connect().prepare(`SELECT * FROM notifications WHERE id = ?`).get(id) as
      | NotificationRow
      | undefined;
    return row ? rowToNotification(row) : null;
  },

  async attachNotificationImage(id, pngKey) {
    connect()
      .prepare(`UPDATE notifications SET png_key = ?, png_at = ? WHERE id = ?`)
      .run(pngKey, new Date().toISOString(), id);
  },

  async attachNotificationPdf(id, pdfKey) {
    connect()
      .prepare(`UPDATE notifications SET pdf_key = ?, pdf_at = ? WHERE id = ?`)
      .run(pdfKey, new Date().toISOString(), id);
  },

  async softDeleteNotification(id) {
    connect()
      .prepare(`UPDATE notifications SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(new Date().toISOString(), id);
  },

  async restoreNotification(id) {
    connect().prepare(`UPDATE notifications SET deleted_at = NULL WHERE id = ?`).run(id);
  },

  async searchNotifications(query: NotificationQuery) {
    const handle = connect();
    const where: string[] = ["company = @company"];
    const params: Record<string, unknown> = { company: query.company };

    // "deleted" is the recycle-bin view; every other view hides deleted rows.
    if (query.status === "deleted") {
      where.push("deleted_at IS NOT NULL");
    } else {
      where.push("deleted_at IS NULL");
    }
    if (query.tag && query.tag !== "all") {
      where.push("tag = @tag");
      params.tag = query.tag;
    }
    if (query.q?.trim()) {
      where.push(`(
        notif_no LIKE @q COLLATE NOCASE OR
        headline LIKE @q COLLATE NOCASE OR
        body     LIKE @q COLLATE NOCASE OR
        sender   LIKE @q COLLATE NOCASE
      )`);
      params.q = `%${query.q.trim()}%`;
    }
    if (query.from) {
      where.push("date(created_at) >= date(@from)");
      params.from = query.from;
    }
    if (query.to) {
      where.push("date(created_at) <= date(@to)");
      params.to = query.to;
    }

    const clause = where.join(" AND ");
    const { total } = handle
      .prepare(`SELECT COUNT(*) AS total FROM notifications WHERE ${clause}`)
      .get(params) as { total: number };

    const rows = handle
      .prepare(
        `SELECT * FROM notifications WHERE ${clause}
          ORDER BY created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit ?? 50, offset: query.offset ?? 0 }) as NotificationRow[];

    return { rows: rows.map(rowToNotification), total };
  },

  async notificationCounts(company: CompanySlug): Promise<NotificationCounts> {
    const { total } = connect()
      .prepare(`SELECT COUNT(*) AS total FROM notifications WHERE company = ? AND deleted_at IS NULL`)
      .get(company) as { total: number };
    return { total };
  },
};
