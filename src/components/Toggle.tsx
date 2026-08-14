"use client";

/**
 * The printed/handwritten switch.
 *
 * ON  → the typed value is printed onto the voucher.
 * OFF → the voucher prints a blank line, filled in by hand at signing time.
 *
 * Rendered as role="switch" so it announces its state to a screen reader and
 * responds to Space/Enter like a native control.
 */
export default function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={`${label} — ${checked ? "printed on the voucher" : "left blank for handwriting"}`}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
        checked ? "bg-[var(--accent)]" : "bg-ink-rule"
      }`}
    >
      <span
        aria-hidden
        // left-0 is load-bearing: without it the knob falls back to its static
        // position, which the button's centred text alignment puts mid-track, and
        // the ON transform then pushes it out over the label text.
        //
        // White in both themes and ringed rather than merely shadowed. The knob
        // has to be found against four different tracks — a pale grey, a dark
        // one, a deep teal and Sportech's acid yellow — and a shadow alone loses
        // it on the last of those. A hairline of the track's own darkness holds
        // its edge on all four.
        className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}
