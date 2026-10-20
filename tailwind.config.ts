import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { brand: { 50: "#eef7f3", 100: "#d5ece2", 500: "#1f8a5f", 600: "#18714d", 700: "#135a3e", 900: "#0b3324" } } } },
  plugins: [],
} satisfies Config;
