import type { Store } from "./types";

export type Backend = "local" | "supabase";

export const backend: Backend =
  (process.env.BACKEND ?? "local").toLowerCase() === "supabase" ? "supabase" : "local";

let cached: Store | null = null;

/**
 * The active data store. `BACKEND=local` (the default) uses SQLite on disk;
 * `BACKEND=supabase` uses Supabase Postgres. Both satisfy the same interface,
 * so switching is an env-var change.
 *
 * The implementations are required lazily so the unused one — and its native
 * or network dependencies — never has to load.
 */
export async function store(): Promise<Store> {
  if (cached) return cached;

  if (backend === "supabase") {
    cached = (await import("./supabase")).supabaseStore;
    return cached;
  }

  try {
    cached = (await import("./sqlite")).sqliteStore;
  } catch (cause) {
    // better-sqlite3 is a native module. If its binary did not build for this
    // platform the failure is otherwise an opaque module error, so name the two
    // ways out of it.
    throw new Error(
      "BACKEND=local needs better-sqlite3, which failed to load. Reinstall it " +
        "(`npm rebuild better-sqlite3`), or set BACKEND=supabase to skip it.",
      { cause },
    );
  }
  return cached;
}

export type { Store, NewVoucher } from "./types";
