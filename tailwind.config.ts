import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: "#1a1a1a", soft: "#6b6b6b", line: "#e4e4e4" },
        gr: { DEFAULT: "#104751", tint: "#ecffd9", sand: "#dab99b", mint: "#b6ddbd" },
        spt: { DEFAULT: "#1a1a1a", accent: "#ecf800" },
      },
    },
  },
  plugins: [],
} satisfies Config;
