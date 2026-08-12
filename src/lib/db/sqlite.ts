import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  AllotFields,
  AssetCounts,
  AssetFields,
  AssetHolding,
  AssetQuery,
  EmployeeProfile,
  HoldingQuery,
  ReturnFields,
} from "../assets/types";
import { COMPANIES, type CompanySlug } from "../companies";
import {
  summariseFood,
  type FoodCounts,
  type FoodExpense,
  type FoodFields,
  type FoodQuery,
} from "../food/types";
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
import type { HistoryQuery, Signatory, Voucher } from "../types";
import type { NewAsset, NewPurchaseOrder, NewRfq, NewVoucher, Store } from "./types";
import {
  denormalize,
  denormalizePo,
  denormalizeRfq,
  employeeKey,
  employeeProfilesFrom,
  foodColumns,
  foodNamesFrom,
  formatAssetNo,
  formatFoodNo,
  formatPoNo,
  formatRfqNo,
  formatVoucherNo,
  holderColumns,
  newId,
  periodOf,
  poStatusPatch,
  rfqStatusPatch,
  rowToAsset,
  rowToFood,
  rowToHolding,
  rowToHoldingWithAsset,
  rowToPo,
  rowToRfq,
  statusChangesDocument,
  rowToVoucher,
  vendorProfilesFrom,
  type AssetRow,
  type FoodRow,
  type HoldingRow,
  type HoldingWithAssetRow,
  type PoRow,
  type RfqRow,
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
        holder_name, holder_no, held_since, created_at, updated_at
      ) VALUES (
        @id, @asset_no, @company, @seq, @asset_name, 'good',
        @holder_name, @holder_no, @held_since, @created_at, @created_at
      )
    `);

    const insertHolding = handle.prepare(`
      INSERT INTO asset_holdings (
        id, asset_id, company, employee_name, employee_no, allotted_on,
        returned_on, condition, note, created_at, updated_at
      ) VALUES (
        @id, @asset_id, @company, @employee_name, @employee_no, @allotted_on,
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
    // the real guard on the number.
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
        ...holderColumns(allot),
      });
      insertHolding.run({
        id: newId(),
        asset_id: id,
        company,
        employee_name: allot.employeeName,
        employee_no: allot.employeeNo,
        allotted_on: allot.allottedOn || null,
        created_at: now,
      });
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
              holder_name = @holder_name, holder_no = @holder_no, held_since = @held_since
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
                held_since: current.held_since,
              }),
        });

      if (open && holder) {
        handle
          .prepare(
            `UPDATE asset_holdings SET
                employee_name = @employee_name, employee_no = @employee_no,
                allotted_on = @allotted_on, updated_at = @updated_at
              WHERE id = @id`,
          )
          .run({
            id: open.id,
            employee_name: holder.employeeName,
            employee_no: holder.employeeNo,
            allotted_on: holder.allottedOn || null,
            updated_at: now,
          });
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
              holder_name = '', holder_no = '', held_since = NULL,
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
              id, asset_id, company, employee_name, employee_no, allotted_on,
              returned_on, condition, note, created_at, updated_at
            ) VALUES (
              @id, @asset_id, @company, @employee_name, @employee_no, @allotted_on,
              NULL, 'good', '', @created_at, @created_at
            )`,
        )
        .run({
          id: newId(),
          asset_id: id,
          company: current.company,
          employee_name: allot.employeeName,
          employee_no: allot.employeeNo,
          allotted_on: allot.allottedOn || null,
          created_at: now,
        });

      handle
        .prepare(
          `UPDATE assets SET
              holder_name = @holder_name, holder_no = @holder_no, held_since = @held_since,
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

  async listEmployees(company: CompanySlug): Promise<EmployeeProfile[]> {
    // Capped like the vendor list. Past this many holdings the suggestions are
    // already more than a person will scroll, and the count beside a name is a
    // hint rather than a figure anyone reports on.
    const rows = connect()
      .prepare(
        `SELECT employee_name, employee_no, returned_on, created_at FROM asset_holdings
          WHERE company = ?
          ORDER BY created_at DESC
          LIMIT 1000`,
      )
      .all(company) as Array<{
      employee_name: string;
      employee_no: string;
      returned_on: string | null;
      created_at: string;
    }>;
    return employeeProfilesFrom(rows);
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

  async settleFood(ids: string[], paidAt: string, reference: string | null): Promise<number> {
    if (ids.length === 0) return 0;
    const handle = connect();
    const placeholders = ids.map(() => "?").join(", ");

    // The status and deleted_at conditions are what make this idempotent: a
    // resubmitted settle form touches nothing, rather than stamping today's date
    // over a payment made last week.
    const result = handle
      .prepare(
        `UPDATE food_expenses SET
            status = 'paid', paid_at = ?, reference = COALESCE(?, reference), updated_at = ?
          WHERE id IN (${placeholders}) AND status = 'pending' AND deleted_at IS NULL`,
      )
      .run(paidAt, reference, new Date().toISOString(), ...ids);

    return result.changes;
  },

  async unsettleFood(id: string): Promise<FoodExpense> {
    const handle = connect();
    handle
      .prepare(
        `UPDATE food_expenses SET
            status = 'pending', paid_at = NULL, updated_at = ?
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
    ];
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
};
