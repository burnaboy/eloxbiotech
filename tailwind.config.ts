import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        background: v("background"),
        foreground: v("foreground"),
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        card: { DEFAULT: v("card"), foreground: v("foreground") },
        border: v("border"),
        input: v("border"),
        ring: v("primary"),
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        destructive: { DEFAULT: v("destructive"), foreground: "rgb(255 255 255 / <alpha-value>)" },
        success: v("success"),
        warning: v("warning"),
      },
      borderRadius: { lg: "0.75rem", md: "0.5rem", sm: "0.375rem" },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
