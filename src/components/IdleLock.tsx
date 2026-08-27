"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/session-actions";

/**
 * Locks the portal when nobody has been there for a while.
 *
 * The server is what actually enforces the window — the cookie simply stops
 * verifying, with or without JavaScript, and every page and route already
 * refuses an unverified one. This is the half that makes it *lock itself*: left
 * to the server alone, an unattended laptop sits on a screenful of figures
 * looking perfectly signed-in until somebody clicks, which is both the wrong
 * thing to leave on a desk and a nasty surprise for whoever comes back.
 *
 * So this counts down to the same instant the cookie expires, warns a minute
 * before, and takes the screen to the lock when it arrives.
 *
 * What counts as being there is deliberately generous. Clicks and keystrokes are
 * the obvious ones, but scrolling and moving the pointer count too: fifteen
 * minutes is short enough that reading a long expenditure report without
 * touching anything is an ordinary thing to be doing, and locking somebody out
 * mid-page would teach them to hate this. What does *not* count is anything the
 * machine does on its own — there is no polling in the portal, the header clock
 * ticks in the browser and the weather is fetched once, so silence really does
 * mean nobody is home.
 *
 * Mounted inside `HeaderControls`, which puts it on every authenticated screen
 * and on none of the unauthenticated ones. The lock screen has no business
 * counting down to itself.
 */

/** How long the warning stands before the lock. Long enough to reach the mouse. */
const WARN_MS = 60_000;

/**
 * How often the timestamp is compared against the window.
 *
 * A second, because the warning shows a countdown and a countdown that moves in
 * fifteen-second steps reads as broken. The work per tick is one subtraction;
 * React is only asked to re-render while the warning is up.
 */
const TICK_MS = 1_000;

export default function IdleLock({ idleMs }: { idleMs: number }) {
  /** Seconds left, while the warning is up. null the rest of the time. */
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** Set by the Stay button so its own press can extend the session at once. */
  const stayRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    /** The last moment there was evidence of a person. */
    let lastActivity = Date.now();
    /** The last moment the cookie was re-issued. */
    let lastTouch = 0;
    let locking = false;

    const lock = () => {
      if (locking) return;
      locking = true;
      // `signOut` deletes the cookie and redirects, which is exactly what the
      // padlock button does — locking by timer and locking by hand should not be
      // two different states to reason about. If the action cannot be reached at
      // all, the screen still has to change, so fall back to going there.
      void Promise.resolve(signOut()).catch(() => {
        window.location.assign("/login");
      });
    };

    const touch = async () => {
      lastTouch = Date.now();
      try {
        const res = await fetch("/api/session", { method: "POST" });
        // The window had already closed. Nothing was renewed, so lock rather
        // than carrying on with a cookie the next click will be refused for.
        if (res.status === 401 && !cancelled) lock();
      } catch {
        // Offline, or the server is restarting. Not evidence of anything; the
        // next tick tries again, and the countdown is unaffected.
      }
    };

    // Every arrival on a screen is somebody having navigated to it, so the
    // window starts again here. This is also what keeps the cookie ahead of the
    // clock on a long session: the timestamp inside it was written whenever it
    // was last issued, which may be most of a window ago.
    void touch();

    const seen = () => {
      lastActivity = Date.now();
    };

    /**
     * The same, throttled to once a second.
     *
     * A pointer crossing the screen fires hundreds of these and all any of them
     * has to do is write a timestamp, so all but the first per second are
     * dropped before they touch anything.
     */
    let lastCheap = 0;
    const seenCheaply = () => {
      const now = Date.now();
      if (now - lastCheap < 1_000) return;
      lastCheap = now;
      lastActivity = now;
    };

    const listeners: Array<[keyof WindowEventMap, EventListener]> = [
      ["pointerdown", seen],
      ["keydown", seen],
      ["touchstart", seen],
      ["pointermove", seenCheaply],
      ["wheel", seenCheaply],
      ["scroll", seenCheaply],
    ];
    for (const [name, fn] of listeners) {
      window.addEventListener(name, fn, { passive: true });
    }

    const tick = () => {
      if (cancelled) return;
      const idle = Date.now() - lastActivity;

      if (idle >= idleMs) {
        lock();
        return;
      }

      const left = idleMs - idle;
      setSecondsLeft(left <= WARN_MS ? Math.ceil(left / 1000) : null);

      // Renewed at a third of the window, so the cookie is never within two
      // thirds of expiring while somebody is here — and only when there has been
      // activity since the last renewal, which is what stops an idle stretch
      // from extending the session on the server past the point this screen
      // locks. Without that condition a tab going quiet would still buy itself
      // one more renewal, and the two halves would disagree about when the
      // window closed.
      if (lastActivity > lastTouch && Date.now() - lastTouch >= idleMs / 3) {
        void touch();
      }
    };

    const timer = window.setInterval(tick, TICK_MS);

    /**
     * A tab coming back to the front is checked at once rather than up to a
     * second later — and, more to the point, a machine that was asleep for three
     * hours locks the moment the lid opens instead of appearing usable first.
     */
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    stayRef.current = () => {
      lastActivity = Date.now();
      setSecondsLeft(null);
      void touch();
    };

    return () => {
      cancelled = true;
      stayRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const [name, fn] of listeners) window.removeEventListener(name, fn);
    };
  }, [idleMs]);

  if (secondsLeft == null) return null;

  return (
    // Bottom centre, over everything, and not a modal: it must be impossible to
    // miss and must not be the thing standing between somebody and the Save
    // button they were reaching for. Any click, keypress or scroll dismisses it
    // anyway — the button is only there for somebody who has read it and has
    // nothing else to press.
    <div
      role="alert"
      aria-live="assertive"
      className="pop-in fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <div className="card flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-5 py-3.5 shadow-lg">
        <p className="text-[13.5px] leading-snug">
          <span className="font-semibold">Locking in </span>
          <span className="mono font-semibold" style={{ color: "var(--danger)" }}>
            {secondsLeft}s
          </span>
          <span className="text-ink-soft"> — nothing has happened here for a while.</span>
        </p>
        <button
          type="button"
          onClick={() => stayRef.current?.()}
          className="btn btn-primary shrink-0 px-3.5 py-2 text-[13px]"
        >
          Stay unlocked
        </button>
      </div>
    </div>
  );
}
