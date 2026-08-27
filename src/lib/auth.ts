import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Single password gate. There are no users, roles or permissions — the plan
 * calls for one operator, so a correct password mints a signed cookie and
 * that's the whole auth story.
 */

const COOKIE = "pvp_session";

/**
 * How long the portal may sit idle before it locks itself.
 *
 * This used to be thirty days, and persistent — "long enough to not re-login on
 * the phone", which it was, and which also meant a laptop opened on a desk was
 * already inside the portal with nobody having proved anything. A password that
 * is asked for once a month is not really a password gate.
 *
 * So the window is now an *idle* one, and it slides: every real navigation and
 * every few minutes of actual use re-issues the cookie with a fresh timestamp
 * (see `touchSession`), so the clock only ever runs down when nobody is there.
 * Fifteen minutes of nothing ends it.
 *
 * Tunable without a deploy, because the right number is a fact about the room
 * the laptop is in and not about this code — set PORTAL_IDLE_MINUTES in the
 * environment. Clamped at both ends: under a minute would lock somebody
 * mid-sentence, and a window longer than a day is the thirty-day cookie again
 * under a new name.
 */
const DEFAULT_IDLE_MINUTES = 15;

function idleMinutes(): number {
  const raw = Number(process.env.PORTAL_IDLE_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IDLE_MINUTES;
  return Math.min(Math.max(Math.round(raw), 1), 60 * 24);
}

/**
 * The idle window, in milliseconds.
 *
 * Exported because the browser needs the same number: the screen that locks
 * itself has to count down to the same instant the cookie stops verifying, and
 * two copies of "fifteen minutes" is how they come to disagree. Read on the
 * server and handed to `IdleLock` as a prop.
 */
export const idleWindowMs = (): number => idleMinutes() * 60_000;

/**
 * The key every session cookie is signed with.
 *
 * The password is always part of it, which is what makes changing the password
 * a real revocation. The portal is used by one person at a time but not always
 * the same person: handing the credentials to somebody covering a holiday and
 * changing the password on your return has to end their access that day, not
 * thirty days later when their cookie happens to expire. Signing with
 * SESSION_SECRET alone left the stand-in logged in across the change.
 *
 * SESSION_SECRET still does its own job on top: without it, a portal running on
 * the shipped default password would have a guessable signing key.
 */
function secret(): string {
  const s = process.env.SESSION_SECRET;
  const base = s && s.length >= 16 ? s : "dev-secret";
  return `${base}:${password()}`;
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

  // Negative means a cookie stamped in the future — a clock that has been
  // moved, or a stamp that was tampered with despite verifying. Neither is a
  // session to honour.
  const age = Date.now() - Number(issuedAt);
  return Number.isFinite(age) && age >= 0 && age < idleWindowMs();
}

/**
 * Writes the cookie, stamped now.
 *
 * One place, called both by unlocking and by extending, so a session that has
 * been kept alive for six hours is holding exactly the cookie a fresh login
 * would have written — rather than one that has quietly kept some attribute of
 * the login it descends from.
 *
 * No `maxAge`, deliberately, which makes this a session cookie: quitting the
 * browser drops it. That is the weaker of the two locks and it is not what the
 * portal relies on — Chrome restores session cookies when it is set to reopen
 * the last tabs, and on a Mac closing the last window does not quit the browser
 * at all. The timestamp inside the value is the one that is actually enforced,
 * on the server, where the browser cannot be talked out of it.
 */
async function issue(): Promise<void> {
  const issuedAt = String(Date.now());
  (await cookies()).set(COOKIE, `${issuedAt}.${sign(issuedAt)}`, {
    httpOnly: true,
    sameSite: "lax",
    // Set automatically on HTTPS deployments; left off for local http.
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function startSession(): Promise<void> {
  await issue();
}

/**
 * Pushes the idle window out, for somebody who is demonstrably still there.
 *
 * Returns false when there was nothing left to extend, and writes nothing in
 * that case. That refusal is the whole reason this is a function and not a
 * cookie write: a tab left open all night must not be able to revive a session
 * that has already lapsed by asking nicely, so an expired cookie stays expired
 * and the caller is told to lock.
 *
 * Deliberately not called from a page. A server component cannot set a cookie,
 * and more to the point most of what reaches the server is not evidence of a
 * person: a prefetch, a poll or a background revalidation would all renew a
 * session nobody is sitting in front of. `/api/session` is posted by the
 * browser, on real activity — see `IdleLock`.
 */
export async function touchSession(): Promise<boolean> {
  if (!(await isAuthenticated())) return false;
  await issue();
  return true;
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** True when the operator is still running the shipped default password. */
export const usingDefaultPassword = () =>
  !process.env.PORTAL_PASSWORD || process.env.PORTAL_PASSWORD === "change-me";

export const SESSION_COOKIE = COOKIE;
