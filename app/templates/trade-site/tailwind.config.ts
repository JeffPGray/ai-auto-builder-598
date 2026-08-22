// ⚠️ shadcn/ui REQUIRES darkMode, keyframes, animation, AND tailwindcss-animate.
// Opus mirrors derive-palette colours into theme.extend.colors — EXTEND, never replace.
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        /* Opus overwrites these hexes to match derive-palette output */
        accent: "#288000",
        "accent-fill": "#288000",
        "accent-text": "#216f00",
        "accent-text-dark": "#78d65f",
        "on-accent-fill": "#eef9ec",
        secondary: "#005b46",
        "secondary-text": "#006d54",
        "secondary-fill": "#007f62",
        "on-secondary-fill": "#e9faf3",
        surface: "#fafdf8",
        "surface-alt": "#f1f5ee",
        "surface-dark": "#191c16",
        "surface-1": "#fafdf8",
        "surface-2": "#f1f5ee",
        "surface-3": "#e7ebe2",
        "surface-4": "#d9ded5",
        "surface-5": "#4a4f47",
        "surface-6": "#191c16",
        ink: "#1c1f19",
        "ink-muted": "#5e615a",
        "on-dark": "#f2f5ef",
        "on-dark-muted": "#bec1ba",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
};
export default config;
