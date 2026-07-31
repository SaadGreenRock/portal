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
  cached =
    backend === "supabase"
      ? (await import("./supabase")).supabaseStore
      : (await import("./sqlite")).sqliteStore;
  return cached;
}

export type { Store, NewVoucher } from "./types";
