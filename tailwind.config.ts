import type { Config } from "tailwindcss";

/**
 * Every colour name below resolves to a CSS variable defined twice in
 * globals.css — once light, once dark — so a utility like `bg-card` or
 * `text-ink-soft` is already theme-aware wherever it is written, and no screen
 * needs a `dark:` twin of its own.
 *
 * `rgb(var(…) / <alpha-value>)` rather than a plain `var(…)` is what keeps the
 * opacity modifiers alive: Tailwind substitutes the alpha in, so
 * `text-ink-soft/70` and `text-red-900/80` still work.
 *
 * Class-based rather than media-based dark mode, because the choice is the
 * operator's: the theme switch offers "follow this device" as one of three
 * options, and a media query cannot express the other two.
 */
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        /** Type and rules. `ink-line` is a hairline, `ink-rule` is meant to be seen. */
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
          line: "rgb(var(--ink-line) / <alpha-value>)",
          rule: "rgb(var(--ink-rule) / <alpha-value>)",
        },
        /** The page behind everything, and the card raised off it. */
        page: "rgb(var(--page) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        /** Quiet fills: `soft` is set into a card, `strong` is a hover. */
        wash: {
          DEFAULT: "rgb(var(--wash) / <alpha-value>)",
          soft: "rgb(var(--wash-soft) / <alpha-value>)",
          strong: "rgb(var(--wash-strong) / <alpha-value>)",
        },
        /**
         * Status, on Tailwind's own scale so the existing `bg-amber-100
         * text-amber-900` pairs read unchanged. Only the steps in use are
         * redefined; the rest of each scale keeps its stock value, which is a
         * light-theme value — so a new step needs adding here, in both halves,
         * rather than being reached for straight from the palette.
         */
        amber: {
          50: "rgb(var(--amber-50) / <alpha-value>)",
          100: "rgb(var(--amber-100) / <alpha-value>)",
          300: "rgb(var(--amber-300) / <alpha-value>)",
          700: "rgb(var(--amber-700) / <alpha-value>)",
          800: "rgb(var(--amber-800) / <alpha-value>)",
          900: "rgb(var(--amber-900) / <alpha-value>)",
        },
        red: {
          50: "rgb(var(--red-50) / <alpha-value>)",
          100: "rgb(var(--red-100) / <alpha-value>)",
          200: "rgb(var(--red-200) / <alpha-value>)",
          700: "rgb(var(--red-700) / <alpha-value>)",
          900: "rgb(var(--red-900) / <alpha-value>)",
        },
        emerald: {
          100: "rgb(var(--emerald-100) / <alpha-value>)",
          900: "rgb(var(--emerald-900) / <alpha-value>)",
        },
        /** Brand values from the approved templates, for reference. */
        gr: { DEFAULT: "#104751", tint: "#ecffd9", sand: "#dab99b", mint: "#b6ddbd" },
        spt: { DEFAULT: "#1a1a1a", accent: "#ecf800" },
      },
    },
  },
  plugins: [],
} satisfies Config;
