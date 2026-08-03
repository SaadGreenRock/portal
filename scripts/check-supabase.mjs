/**
 * Preflight check for the Supabase backend.
 *
 *   npm run check:supabase
 *
 * Verifies, in order: the credentials are present and of the right kind, the
 * project is reachable, every table exists, the storage bucket exists and is
 * private, and that a file can actually be written and read back. Every failure
 * says what to do about it.
 *
 * Reads .env via node --env-file, so it checks exactly what the app will use.
 */

import { createClient } from "@supabase/supabase-js";

const BUCKET = process.env.SUPABASE_BUCKET ?? "vouchers";

let failed = false;
/** Set when the credentials themselves are wrong, so we skip the network checks
 *  rather than emitting a confusing "fetch failed" on top of the real cause. */
let credentialsBad = false;

const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m, fix) => {
  failed = true;
  console.log(`  FAIL  ${m}`);
  if (fix) console.log(`        → ${fix}`);
};
const failCredentials = (m, fix) => {
  credentialsBad = true;
  fail(m, fix);
};

/** "sb_secret_abc…wxyz", without ever printing enough to be useful. */
const preview = (k) =>
  k.length > 24 ? `${k.slice(0, 12)}…${k.slice(-4)}` : `${k.slice(0, 6)}…`;

console.log("\nChecking Supabase configuration\n");

// ---- credentials ----------------------------------------------------------
const url = process.env.SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY)?.trim();

if (!url) {
  fail("SUPABASE_URL is not set", "Add SUPABASE_URL=https://<project>.supabase.co to .env");
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url)) {
  failCredentials(
    `SUPABASE_URL looks wrong: ${url}`,
    "Expected https://<project-ref>.supabase.co",
  );
} else {
  pass(`URL ${url}`);
}

if (!key) {
  fail(
    "No key set",
    "Add SUPABASE_SECRET_KEY=… to .env (Dashboard → Settings → API keys)",
  );
} else if (key.startsWith("sb_publishable_")) {
  failCredentials(
    "That is a publishable key, which cannot read these tables",
    "Use the secret key (sb_secret_…) instead — RLS is on with no policies",
  );
} else {
  let role = "";
  try {
    role = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role ?? "";
  } catch {
    /* new-format keys are not JWTs; nothing to inspect */
  }
  if (role === "anon") {
    failCredentials(
      "That is the anon key, which cannot read these tables",
      "Use the service_role key, or a new-format sb_secret_… key",
    );
  } else {
    pass(`Key ${preview(key)} (${role || "secret key"})`);
  }
}

if (process.env.BACKEND !== "supabase") {
  fail(
    `BACKEND is "${process.env.BACKEND ?? "unset"}" — the app is still using local SQLite`,
    "Set BACKEND=supabase in .env once the checks below pass",
  );
}

if (!url || !key || credentialsBad) {
  console.log("\nFix the credentials above, then run this again.\n");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// ---- tables --------------------------------------------------------------
// Each table is probed on a column it is guaranteed to have — company_settings
// is keyed by `company`, not by an id.
const TABLES = [
  ["vouchers", "id"],
  ["signatories", "id"],
  ["purchase_orders", "id"],
  ["requests_for_quotation", "id"],
  ["company_settings", "company"],
];

let tablesExist = true;
for (const [table, column] of TABLES) {
  // A real GET, not { head: true } — a HEAD request against a missing table
  // comes back with no body and no error, which reads as a false pass.
  const { error } = await db.from(table).select(column).limit(1);
  if (error) {
    // PostgREST reports a missing table as a schema-cache miss (PGRST205),
    // which is a migration problem, not a credentials problem.
    const missing = error.code === "42P01" || /schema cache/i.test(error.message);
    tablesExist = false;
    fail(
      missing ? `Table "${table}" does not exist` : `Table "${table}" is not readable: ${error.message}`,
      missing
        ? "Run supabase/migration.sql in the Supabase SQL editor"
        : "Check the key is the secret/service_role key",
    );
  } else {
    pass(`Table "${table}" readable`);
  }
}

// Columns added after the first release. A project migrated earlier may lack
// them, and the failure would otherwise look like a code bug. Pointless to
// report separately when the table itself is absent.
if (tablesExist) {
  for (const [table, column] of [
    ["vouchers", "deleted_at"],
    ["purchase_orders", "pdf_at"],
  ]) {
    const { error } = await db.from(table).select(column).limit(1);
    if (error) {
      fail(
        `Column "${table}.${column}" missing: ${error.message}`,
        "Re-run supabase/migration.sql — it is safe to re-run and adds what is absent",
      );
    } else {
      pass(`Column "${table}.${column}" present`);
    }
  }
}

// ---- storage -------------------------------------------------------------
{
  const { data: buckets, error } = await db.storage.listBuckets();
  if (error) {
    fail(`Cannot list storage buckets: ${error.message}`);
  } else {
    const bucket = buckets.find((b) => b.name === BUCKET);
    if (!bucket) {
      fail(
        `Storage bucket "${BUCKET}" does not exist`,
        "Run supabase/migration.sql, or create it manually and leave it private",
      );
    } else {
      pass(`Storage bucket "${BUCKET}" exists`);
      if (bucket.public) {
        fail(
          `Bucket "${BUCKET}" is PUBLIC — anyone with a URL could read signed vouchers and purchase orders`,
          "Dashboard → Storage → vouchers → Settings → make it private",
        );
      } else {
        pass(`Bucket "${BUCKET}" is private`);
      }
    }
  }
}

// ---- round-trip a real file ---------------------------------------------
{
  const probe = `_healthcheck/${Date.now()}.txt`;
  const body = new Blob(["ok"], { type: "text/plain" });
  const up = await db.storage.from(BUCKET).upload(probe, body, { upsert: true });
  if (up.error) {
    fail(`Cannot upload to "${BUCKET}": ${up.error.message}`);
  } else {
    const down = await db.storage.from(BUCKET).download(probe);
    if (down.error) fail(`Cannot read back from "${BUCKET}": ${down.error.message}`);
    else pass("Uploaded and read back a test file");
    await db.storage.from(BUCKET).remove([probe]);
  }
}

console.log(
  failed
    ? "\nSome checks failed — fix the items above, then run this again.\n"
    : "\nAll checks passed. Set BACKEND=supabase and restart to use it.\n",
);
process.exit(failed ? 1 : 0);
