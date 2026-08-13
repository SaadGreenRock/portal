"use client";

import { useId, useState } from "react";

/**
 * A password input with a show/hide toggle.
 *
 * Stroke-only icons, no fill — the same convention as the Lock control: a
 * glyph at the interface's own line weight rather than an icon-font
 * character sitting at a different weight beside it.
 */
export default function PasswordField({
  id,
  name,
  autoComplete,
  autoFocus,
  required,
  placeholder,
}: {
  id?: string;
  name: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className="relative">
      <input
        id={inputId}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        placeholder={placeholder}
        className="input pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-soft transition-colors hover:text-ink"
      >
        {visible ? <EyeOffMark /> : <EyeMark />}
      </button>
    </div>
  );
}

const strokes = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Shown while the password is masked — click to reveal it. */
function EyeMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...strokes} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/** Shown while the password is revealed — click to mask it again. */
function EyeOffMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...strokes} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M4.5 4.5l15 15" />
    </svg>
  );
}
