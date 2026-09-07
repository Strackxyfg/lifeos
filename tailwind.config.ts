import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1.5rem", lg: "2rem" },
      screens: { "2xl": "1200px" },
    },
    extend: {
      colors: {
        background: "hsl(var(--background))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          2: "hsl(var(--surface-2))",
        },
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: {
          DEFAULT: "hsl(var(--border))",
          strong: "hsl(var(--border-strong))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          soft: "hsl(var(--accent) / 0.12)",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        ring: "hsl(var(--ring))",
      },
      borderColor: { DEFAULT: "hsl(var(--border))" },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
        xl: "calc(var(--radius) + 4px)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Tightened, editorial scale
        "display": ["clamp(2.75rem, 6vw, 5rem)", { lineHeight: "1.02", letterSpacing: "-0.03em", fontWeight: "560" }],
        "h1": ["clamp(2rem, 4vw, 3.25rem)", { lineHeight: "1.05", letterSpacing: "-0.025em", fontWeight: "560" }],
        "h2": ["clamp(1.5rem, 3vw, 2.25rem)", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "540" }],
        "lead": ["1.1875rem", { lineHeight: "1.6", letterSpacing: "-0.01em" }],
        "eyebrow": ["0.8125rem", { lineHeight: "1", letterSpacing: "0.08em", fontWeight: "500" }],
      },
      maxWidth: { content: "1200px", prose: "68ch" },
      boxShadow: {
        // Soft shadows only
        subtle: "0 1px 2px 0 rgb(0 0 0 / 0.30)",
        card: "0 1px 0 0 hsl(var(--border)), 0 12px 40px -12px rgb(0 0 0 / 0.55)",
        lift: "0 24px 70px -20px rgb(0 0 0 / 0.65)",
        glow: "0 0 0 1px hsl(var(--accent) / 0.35), 0 8px 40px -8px hsl(var(--accent) / 0.35)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--accent) / 0.35)" },
          "70%": { boxShadow: "0 0 0 10px hsl(var(--accent) / 0)" },
          "100%": { boxShadow: "0 0 0 0 hsl(var(--accent) / 0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s var(--ease-premium) both",
        shimmer: "shimmer 1.6s infinite",
        "pulse-ring": "pulse-ring 2s var(--ease-premium) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
