import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Single password gate. There are no users, roles or permissions — the plan
 * calls for one operator, so a correct password mints a signed cookie and
 * that's the whole auth story.
 */

const COOKIE = "pvp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days — long enough to not re-login on the phone.

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // Falling back to the password keeps dev friction at zero. It still signs the
  // cookie; it just means changing the password invalidates existing sessions.
  return `dev-secret:${password()}`;
}

function password(): string {
  return process.env.PORTAL_PASSWORD ?? "change-me";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Constant-time string compare that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn a comparison so timing doesn't leak length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): boolean {
  return safeEqual(candidate, password());
}

/** True when the request carries a valid, unexpired session cookie. */
export async function isAuthenticated(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  return verifyToken(raw);
}

export function verifyToken(raw: string | undefined): boolean {
  if (!raw) return false;
  const [issuedAt, mac] = raw.split(".");
  if (!issuedAt || !mac) return false;
  if (!safeEqual(mac, sign(issuedAt))) return false;

  const age = (Date.now() - Number(issuedAt)) / 1000;
  return Number.isFinite(age) && age >= 0 && age < MAX_AGE;
}

export async function startSession(): Promise<void> {
  const issuedAt = String(Date.now());
  (await cookies()).set(COOKIE, `${issuedAt}.${sign(issuedAt)}`, {
    httpOnly: true,
    sameSite: "lax",
    // Set automatically on HTTPS deployments; left off for local http.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** True when the operator is still running the shipped default password. */
export const usingDefaultPassword = () =>
  !process.env.PORTAL_PASSWORD || process.env.PORTAL_PASSWORD === "change-me";

export const SESSION_COOKIE = COOKIE;
