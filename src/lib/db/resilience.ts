/**
 * Surviving a module whose tables haven't been created yet.
 *
 * Adding purchase orders added two tables. On a deployment where the migration
 * hasn't been run, every query against them fails — and because the workspace
 * shell draws a purchase-order count on *every* page, that failure took the
 * whole portal down, vouchers included. A module that isn't set up should be
 * unavailable; it should not be able to break a module that is.
 *
 * So reads that only feed a badge tolerate a missing table, and the module's
 * own screens detect it and say what to run.
 */

/**
 * True when the error is "that table doesn't exist" rather than a real fault.
 *
 * Deliberately narrow. A connection failure, a permissions problem or a bad
 * query must still surface as an error — swallowing those would turn a broken
 * deployment into one that quietly shows zeroes, which is worse than a crash.
 */
export function isMissingTable(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: unknown; message?: unknown };

  // Postgres: undefined_table. PostgREST: the table is absent from its cache.
  if (e.code === "42P01" || e.code === "PGRST205") return true;

  const message = String(e.message ?? err);
  return (
    /could not find the table/i.test(message) ||
    /relation ".*" does not exist/i.test(message) ||
    // SQLite, for a local database created before the module existed.
    /no such table/i.test(message)
  );
}

export type TableResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs a query, reporting a missing table as unavailability rather than failure.
 *
 * Callers that need the data render an explanation; callers that only wanted a
 * badge carry on without one.
 */
export async function tryTable<T>(work: () => Promise<T>): Promise<TableResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false };
    throw err;
  }
}
