import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // PATCHPAY brand: warm off-white, charcoal/deep-ink, restrained orange.
        paper: "#FAF6EF",
        paperdeep: "#F3EEE3",
        ink: "#16130E",
        charcoal: "#2A241C",
        muted: "#6B6257",
        faint: "#8A8175",
        line: "#E3D9C8",
        accent: "#D9541E",
        accentdeep: "#B84314",
        moss: "#3E6B4F",
        clay: "#A34A2A",
      },
      fontFamily: {
        // Editorial developer-tool aesthetic. System stacks only: zero
        // network dependency at build time.
        display: ["Georgia", "'Times New Roman'", "serif"],
        sans: [
          "system-ui",
          "-apple-system",
          "'Segoe UI'",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "'SF Mono'",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "'Liberation Mono'",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(22,19,14,0.06), 0 8px 28px -12px rgba(22,19,14,0.18)",
        lift: "0 2px 4px rgba(22,19,14,0.08), 0 16px 40px -12px rgba(22,19,14,0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
