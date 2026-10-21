/** The member's colour mode. "system" follows the device setting. Kept in a cookie so the server can render the right colours first time, with no flash. */
export const THEME_COOKIE = "theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
}
