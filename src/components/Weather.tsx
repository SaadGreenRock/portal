"use client";

import { useCallback, useEffect, useState } from "react";
import { isCoord, roundCoord, type Condition, type Reading } from "@/lib/weather";

/**
 * The temperature where this machine is, and a glyph for the sky.
 *
 * Off until it is asked for. The portal cannot know where a laptop is and has no
 * business guessing, so the widget starts as a single quiet control: press it,
 * the browser asks whether to share the location, and from then on the header
 * carries the weather. Nothing is requested on load and no prompt appears
 * uninvited — a permission dialog that opens by itself on a password-gated
 * portal is the kind of thing people say no to on principle.
 *
 * The answer is remembered in this browser, so it is asked once rather than once
 * a day. Pressing it again re-asks, which is also the way to correct it: a laptop
 * without GPS is located by Wi-Fi and by address, and that is usually right to the
 * city and occasionally somewhere else entirely.
 *
 * Coordinates live in this browser's own storage and go no further than the
 * portal's weather route, rounded, on the way to a temperature. Nothing about
 * where anybody was sitting is written to the database.
 */

/** Where the granted coordinates are remembered. Rounded before they are stored. */
const KEY = "portal-weather-at";

type Place = { lat: number; lon: number };

type State =
  | { kind: "off" }
  | { kind: "asking" }
  | { kind: "loading"; place: Place }
  | { kind: "on"; place: Place; reading: Reading }
  | { kind: "failed"; why: string };

function readPlace(): Place | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Place>;
    const { lat, lon } = parsed;
    if (typeof lat !== "number" || typeof lon !== "number" || !isCoord(lat, lon)) return null;
    return { lat, lon };
  } catch {
    // Storage off, or something else wrote nonsense to the key. Start from off.
    return null;
  }
}

export default function Weather() {
  const [state, setState] = useState<State>({ kind: "off" });
  // The server cannot know whether this browser has been asked, so nothing is
  // rendered until that is known. It arrives to the *left* of the clock, so the
  // clock and the buttons beside it do not move when it does.
  const [ready, setReady] = useState(false);

  const load = useCallback(async (place: Place) => {
    setState({ kind: "loading", place });
    try {
      const res = await fetch(`/api/weather?lat=${place.lat}&lon=${place.lon}`);
      if (!res.ok) throw new Error(String(res.status));
      setState({ kind: "on", place, reading: (await res.json()) as Reading });
    } catch {
      setState({ kind: "failed", why: "The weather service could not be reached." });
    }
  }, []);

  useEffect(() => {
    const place = readPlace();
    setReady(true);
    if (place) void load(place);
  }, [load]);

  /**
   * Ask the browser where we are.
   *
   * Always re-asks rather than short-circuiting on a stored answer, because this
   * is the only correction available: if the location is wrong, or the laptop has
   * moved, pressing the widget is what fixes it.
   */
  const ask = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ kind: "failed", why: "This browser cannot report a location." });
      return;
    }

    setState({ kind: "asking" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const place = {
          lat: roundCoord(position.coords.latitude),
          lon: roundCoord(position.coords.longitude),
        };
        try {
          localStorage.setItem(KEY, JSON.stringify(place));
        } catch {
          // Not remembering is survivable; it will ask again next time.
        }
        void load(place);
      },
      () => {
        // Declined, or the machine has no idea where it is. Either way it falls
        // back to the control it started as, so it can be tried again.
        setState({ kind: "failed", why: "This machine did not share a location." });
      },
      // A stored fix up to an hour old is fine for a temperature and avoids
      // waking the radio; the timeout keeps a silent failure from hanging on
      // "asking" for ever.
      { timeout: 8000, maximumAge: 3_600_000 },
    );
  }, [load]);

  if (!ready) return null;

  const title =
    state.kind === "on"
      ? `${state.reading.tempC}°C · ${state.reading.label}` +
        (state.reading.timezone ? ` · ${state.reading.timezone}` : "") +
        ` · ${state.place.lat}, ${state.place.lon} — press to update`
      : state.kind === "asking"
        ? "Asking this machine where it is…"
        : state.kind === "failed"
          ? `${state.why} Press to try again.`
          : "Show the weather where this machine is";

  return (
    <button
      type="button"
      onClick={ask}
      title={title}
      aria-label={title}
      // Sized and coloured like the clock beside it rather than like a button:
      // it is a reading that happens to be pressable, and a bordered control here
      // would outweigh both the temperature and the time.
      className="hidden shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-ink-soft transition-colors hover:bg-wash-strong hover:text-ink sm:flex"
    >
      <Mark condition={state.kind === "on" ? state.reading.condition : null} />
      {state.kind === "on" ? (
        <span className="mono text-[13.5px] font-semibold text-ink">{state.reading.tempC}°C</span>
      ) : null}
    </button>
  );
}

/**
 * The sky, at the same line weight as the padlock and the theme marks — see the
 * note on those. A pin stands in before the widget has been asked: it is the one
 * state where the subject is the location rather than the weather.
 */
function Mark({ condition }: { condition: Condition | null }) {
  const strokes = {
    viewBox: "0 0 24 24",
    className: "h-[17px] w-[17px]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;

  if (condition === null) {
    return (
      <svg {...strokes}>
        <path d="M20 10c0 4.4-5.3 9.6-7.4 11.5a1 1 0 0 1-1.3 0C9.3 19.6 4 14.4 4 10a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="2.6" />
      </svg>
    );
  }

  if (condition === "clear") {
    return (
      <svg {...strokes}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
        <path d="m6.34 17.66-1.41 1.41" />
      </svg>
    );
  }

  if (condition === "partly") {
    return (
      <svg {...strokes}>
        <path d="M12 2v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="M20 12h2" />
        <path d="m19.07 4.93-1.41 1.41" />
        <path d="M15.95 12.65a4 4 0 0 0-5.93-4.13" />
        <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
      </svg>
    );
  }

  if (condition === "fog") {
    return (
      <svg {...strokes}>
        <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" />
        <path d="M16 17H7" />
        <path d="M17 21H9" />
      </svg>
    );
  }

  if (condition === "rain") {
    return (
      <svg {...strokes}>
        <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" />
        <path d="M16 14v6" />
        <path d="M8 14v6" />
        <path d="M12 16v6" />
      </svg>
    );
  }

  if (condition === "snow") {
    return (
      <svg {...strokes}>
        <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" />
        <path d="M8 15h.01" />
        <path d="M8 19h.01" />
        <path d="M12 17h.01" />
        <path d="M12 21h.01" />
        <path d="M16 15h.01" />
        <path d="M16 19h.01" />
      </svg>
    );
  }

  if (condition === "storm") {
    return (
      <svg {...strokes}>
        <path d="M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.97" />
        <path d="m13 12-3 5h4l-3 5" />
      </svg>
    );
  }

  return (
    <svg {...strokes}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}
