import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#1E6286", light: "#2E6F9E", dark: "#164a66", sand: "#F6EFE3" },
      },
      fontFamily: { sans: ["var(--font-maven)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
