/**
 * One-off import of the food log from the spreadsheet it replaces.
 *
 *   BACKEND=local node scripts/import-food.mjs
 *   node --env-file=.env scripts/import-food.mjs        (whatever .env says)
 *   node --env-file=.env scripts/import-food.mjs --force
 *
 * Reads scripts/food-seed.json — a plain, reviewable extract of the workbook's
 * Lunch_Log table — and writes it into whichever backend BACKEND names. The
 * .xlsx is not read here on purpose: parsing it would mean a permanent xlsx
 * dependency for a script that runs once, and a committed JSON extract is
 * something a reviewer can actually read in a diff.
 *
 * The SQL is written out rather than imported from src/lib/db, which is
 * TypeScript the app compiles and a plain node script cannot load. That is a
 * deliberate, contained duplication: this file touches one table, runs once, and
 * checks its own arithmetic against the workbook's totals at the end. If those
 * do not match, nothing was left half-imported to reason about — the run fails
 * loudly and the table can be emptied and tried again.
 *
 * Refuses to run against a table that already has rows, unless --force.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const force = process.argv.includes("--force");
const backend = (process.env.BACKEND ?? "local").toLowerCase() === "supabase" ? "supabase" : "local";

const die = (message, fix) => {
  console.error(`\n  FAIL  ${message}`);
  if (fix) console.error(`        → ${fix}`);
  console.error("");
  process.exit(1);
};

// ---- the extract ----------------------------------------------------------
const seedPath = path.join(here, "food-seed.json");
if (!fs.existsSync(seedPath)) die(`${seedPath} is missing`);
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const entries = seed.entries ?? [];
if (entries.length === 0) die("food-seed.json has no entries");

console.log(`\nImporting ${entries.length} food entries into the ${backend} backend\n`);

/**
 * `F-202608-001`. Numbered from the entry's own month, not the month of the
 * import: a July lunch reading F-202608-xxx would make the log's own numbers
 * disagree with its dates for every historical row at once.
 *
 * Sequences restart per month, which is exactly what the app does for anything
 * logged from now on — so the next new entry picks up after the highest seq in
 * its own period and no number is ever issued twice.
 */
const periodOf = (isoDate) => isoDate.slice(0, 4) + isoDate.slice(5, 7);
const formatFoodNo = (period, seq) => `F-${period}-${String(seq).padStart(3, "0")}`;

const bySeq = new Map();
const rows = entries
  // Oldest first, so the numbers within a month run in the order the food was
  // actually ordered.
  .slice()
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((e) => {
    const period = periodOf(e.date);
    const seq = (bySeq.get(period) ?? 0) + 1;
    bySeq.set(period, seq);
    const now = new Date().toISOString();

    const deferred = e.paymentType === "deferred";
    return {
      id: randomUUID(),
      entry_no: formatFoodNo(period, seq),
      seq,
      period,
      date: e.date,
      ordered_for: e.orderedFor ?? "",
      vendor: e.vendor ?? "",
      details: e.details ?? "",
      amount: e.amount,
      currency: e.currency || "PKR",
      payment_type: e.paymentType,
      // Nobody paid out of pocket on a deferred order, so there is nobody to
      // reimburse and a name here would put a phantom debt on the outstanding
      // screen. Same normalisation the app's foodColumns applies.
      paid_by: deferred ? null : (e.paidBy ?? null),
      status: e.status,
      // Left null on the 28 rows the sheet recorded as paid without a date.
      // Absence means unknown; inventing a date would be a lie in a record of
      // when money moved.
      paid_at: e.status === "paid" ? (e.paidAt ?? null) : null,
      reference: e.reference ?? null,
      notes: e.notes ?? null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  });

// ---- write ----------------------------------------------------------------
let live;

if (backend === "supabase") {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY)?.trim();
  if (!url || !key) {
    die("SUPABASE_URL / SUPABASE_SECRET_KEY are not set", "Check .env, or run with BACKEND=local");
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const existing = await db.from("food_expenses").select("id", { count: "exact", head: false }).limit(1);
  if (existing.error) {
    die(
      `Cannot read food_expenses: ${existing.error.message}`,
      "Run supabase/migration.sql in the Supabase SQL editor first",
    );
  }
  if ((existing.data ?? []).length > 0 && !force) {
    die("food_expenses already has rows", "Pass --force only if you mean to add to them");
  }

  const { error } = await db.from("food_expenses").insert(rows);
  if (error) die(`Insert failed: ${error.message}`);

  const check = await db.from("food_expenses").select("amount, status, payment_type").is("deleted_at", null);
  if (check.error) die(`Cannot read back: ${check.error.message}`);
  live = check.data.map((r) => ({ ...r, amount: Number(r.amount) }));
} else {
  const { default: Database } = await import("better-sqlite3");
  const dataDir = process.env.DATA_DIR ?? path.join(root, ".data");
  const file = path.join(dataDir, "vouchers.db");
  if (!fs.existsSync(file)) {
    die(
      `No database at ${file}`,
      "Start the app once (npm run dev) so it creates the schema, then run this again",
    );
  }

  const handle = new Database(file);
  handle.pragma("foreign_keys = ON");

  const table = handle
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'food_expenses'`)
    .get();
  if (!table) {
    die("Table food_expenses does not exist", "Start the app once so it creates the schema");
  }

  const { count } = handle.prepare(`SELECT COUNT(*) AS count FROM food_expenses`).get();
  if (count > 0 && !force) {
    die(`food_expenses already has ${count} rows`, "Pass --force only if you mean to add to them");
  }

  const insert = handle.prepare(`
    INSERT INTO food_expenses (
      id, entry_no, seq, period, date, ordered_for, vendor, details,
      amount, currency, payment_type, paid_by, status, paid_at,
      reference, notes, created_at, updated_at, deleted_at
    ) VALUES (
      @id, @entry_no, @seq, @period, @date, @ordered_for, @vendor, @details,
      @amount, @currency, @payment_type, @paid_by, @status, @paid_at,
      @reference, @notes, @created_at, @updated_at, @deleted_at
    )
  `);

  // All or nothing: a half-imported log would have to be told apart from a
  // correctly imported one by hand.
  handle.transaction(() => rows.forEach((r) => insert.run(r)))();

  live = handle
    .prepare(`SELECT amount, status, payment_type FROM food_expenses WHERE deleted_at IS NULL`)
    .all();
}

// ---- check the arithmetic against the workbook ----------------------------
const round = (n) => Math.round(n * 100) / 100;
const sum = (pick) => round(live.filter(pick).reduce((t, r) => t + r.amount, 0));

const actual = {
  entries: live.length,
  spentAllTime: sum(() => true),
  totalOutstanding: sum((r) => r.status === "pending"),
  owedToVendors: sum((r) => r.status === "pending" && r.payment_type === "deferred"),
  owedToEmployees: sum((r) => r.status === "pending" && r.payment_type === "employee-paid"),
};

let failed = false;
for (const [key, want] of Object.entries(seed._expected ?? {})) {
  const got = actual[key];
  const ok = round(want) === round(got);
  if (!ok) failed = true;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${key.padEnd(18)} ${got}${ok ? "" : `  (workbook says ${want})`}`);
}

console.log(
  failed
    ? "\nThe imported figures do not match the workbook. Empty food_expenses and investigate before using the portal.\n"
    : `\nImported ${rows.length} entries, ${rows[0].entry_no} to ${rows[rows.length - 1].entry_no}. Figures match the workbook.\n`,
);
process.exit(failed ? 1 : 0);
