/*
 * CSV export that is safe to open in Excel, Google Sheets or LibreOffice.
 * A text cell starting with = + - @ tab or carriage return could run as a formula ("CSV injection"),
 * so it is prefixed with an apostrophe, which spreadsheets show as plain text. Numbers stay numbers.
 */

const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "bigint") return Number.isFinite(Number(v)) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][], opts: { bom?: boolean } = {}): string {
  // The byte-order mark makes Excel read the file as UTF-8 (so ₦ and accented names show correctly).
  // Bank upload files are sent without it.
  return (opts.bom === false ? "" : "\uFEFF") + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, csv: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Kobo to a plain naira amount for spreadsheets, e.g. 123456 → 1234.56. */
export const nairaCell = (minor: number) => (minor / 100).toFixed(2);

/**
 * Exports are downloads (GET), and a batch export also marks the batch as exported. A link on another site
 * could trigger that with the admin's cookies, so only same-site navigations are accepted. Browsers send
 * Sec-Fetch-Site on every request; "none" means the admin typed the URL or used a bookmark.
 */
export function sameSiteRequest(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
