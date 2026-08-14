"use client";

import { useEffect, useState } from "react";
import { applyTheme, readChoice, storeChoice, type ThemeChoice } from "@/lib/theme";

/**
 * The one theme control, sitting wherever Lock sits — same corner, same size,
 * same icon-only shape — because they are the two settings the portal has and
 * splitting them across two idioms would make the pair look accidental.
 *
 * One button that steps through the three states rather than three controls
 * side by side. On a phone the header already carries a logo, a company name
 * and Lock; a segmented control is three times the width for a setting that is
 * changed roughly never, and the state it would be showing is the colour of the
 * entire screen behind it.
 *
 * The mark shows the state, not the action: a monitor while the portal is
 * following the device, a sun while it is held light, a moon while it is held
 * dark. Which one is visible is decided in CSS from the attribute the pre-paint
 * script sets — see globals.css — so the button is never briefly wrong on load.
 */

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

/** Read out to a screen reader, so the state is not carried by the glyph alone. */
const SAYS: Record<ThemeChoice, string> = {
  system: "matching this device",
  light: "light",
  dark: "dark",
};

export default function ThemeToggle({
  className = "btn btn-quiet p-2.5",
}: {
  className?: string;
}) {
  // Starts unknown, because the server has no way to know: the choice is in the
  // browser's storage. Only the label depends on it — the glyph is CSS's job —
  // so there is nothing here for hydration to disagree about.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => setChoice(readChoice()), []);

  // While the choice is "system", the operating system is still in charge: a
  // laptop that turns dark at sunset should take the portal with it, in the tab
  // that is already open, rather than at the next reload.
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [choice]);

  function step() {
    // Read the live attribute rather than trusting state. The script in the
    // head is the thing that actually set the theme, and this is the value it
    // wrote — so a click that lands before the effect above has run still
    // advances from the right place instead of restarting at "system".
    const current = (document.documentElement.dataset.theme ?? "system") as ThemeChoice;
    const next = NEXT[current] ?? "light";

    // Every surface, rule and figure changes at once. Turning it over across a
    // fifth of a second reads as one deliberate act; cut hard, the same change
    // reads as a glitch. The class is removed again so it cannot leave a lag on
    // every hover in the portal.
    const root = document.documentElement;
    root.classList.add("theme-turning");
    window.setTimeout(() => root.classList.remove("theme-turning"), 240);

    applyTheme(next);
    storeChoice(next);
    setChoice(next);
  }

  const label =
    choice === null
      ? "Change the colour theme"
      : `Colour theme: ${SAYS[choice]}. Switch to ${SAYS[NEXT[choice]]}.`;

  return (
    <button
      type="button"
      onClick={step}
      title={label}
      // The state in words as well as in the glyph, and the next step with it,
      // so the one control the portal has that cycles never has to be pressed
      // three times to find out where it is.
      aria-label={label}
      className={className}
    >
      <MonitorMark />
      <SunMark />
      <MoonMark />
    </button>
  );
}

/**
 * All three marks are always rendered and CSS shows exactly one — see the
 * .theme-mark rules in globals.css. Stroke only, at the interface's own line
 * weight, the same convention as the padlock beside them and the Food and
 * Expenditure marks on the landing page.
 */
const strokes = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const size = "h-[18px] w-[18px]";

/** Following the device: the device. Clearer at this size than a half-filled
 *  circle, which reads as a contrast setting rather than as "ask the machine". */
function MonitorMark() {
  return (
    <svg {...strokes} className={`theme-mark theme-mark-system ${size}`}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2.2" />
      <path d="M12 16.5V21" />
      <path d="M8 21h8" />
    </svg>
  );
}

function SunMark() {
  return (
    <svg {...strokes} className={`theme-mark theme-mark-light ${size}`}>
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

function MoonMark() {
  return (
    <svg {...strokes} className={`theme-mark theme-mark-dark ${size}`}>
      <path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

/**
 * The same control for the screens with no furniture to hang it on — the lock
 * screen, and the trouble page.
 *
 * A bare glyph in the corner rather than a bar across the top: on a screen
 * whose whole job is one sentence and one field, a strip of chrome to hold a
 * setting would outweigh the thing it sits above. Wants a `relative` parent.
 */
export function ThemeToggleCorner() {
  return (
    <div className="absolute right-3 top-3 sm:right-4 sm:top-4">
      <ThemeToggle className="btn btn-quiet p-2" />
    </div>
  );
}
