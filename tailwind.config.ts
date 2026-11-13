import type { Config } from "tailwindcss";

// Colors and fonts match portaboatrentals.com (WordPress/Elementor theme).
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Navy used for headings and the header bar
        brand: { DEFAULT: "#0B2E4F", light: "#1E6286", dark: "#0B2A3D", sand: "#F4F8FA" },
        // "Reserve Now" red
        cta: { DEFAULT: "#C62828", dark: "#A61F1F" },
        // Nav highlight teal
        teal: { DEFAULT: "#3EC7D3" },
        ink: "#272C30",
      },
      fontFamily: {
        sans: ["var(--font-body)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        display: ["var(--font-display)", "Inter", "sans-serif"],
        button: ["var(--font-button)", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
