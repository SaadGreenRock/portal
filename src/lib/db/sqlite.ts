import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { COMPANIES, type CompanySlug } from "../companies";
import type { HistoryQuery, Signatory, Voucher } from "../types";
import type { NewVoucher, Store } from "./types";
import {
  denormalize,
  formatVoucherNo,
  newId,
  periodOf,
  rowToVoucher,
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
  `);

  migrate(handle);
  db = handle;
  seedSignatories(handle);
  return handle;
}

/**
 * Brings a database created by an earlier version up to date. CREATE TABLE IF
 * NOT EXISTS won't add columns to a table that already exists, so new columns
 * have to be applied explicitly.
 */
function migrate(handle: Database.Database) {
  const columns = new Set(
    (handle.prepare(`PRAGMA table_info(vouchers)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (!columns.has("deleted_at")) {
    handle.exec(`ALTER TABLE vouchers ADD COLUMN deleted_at TEXT`);
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
};
