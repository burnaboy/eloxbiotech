"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
const ICON = { system: Monitor, light: Sun, dark: Moon };

/** One button that steps through System, Light and Dark. The choice is remembered on this device for a year. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [theme]);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const Icon = ICON[theme];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Colour mode: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
      title={`Colour mode: ${LABEL[theme]}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
      data-theme-choice={theme}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
