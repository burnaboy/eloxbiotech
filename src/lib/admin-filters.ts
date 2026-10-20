/*
 * Date-range and paging helpers shared by admin lists, reports and CSV exports.
 * Dates are calendar days in Lagos time (UTC+1, no daylight saving); "to" includes the whole day.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DateRange = { from?: string; to?: string; gte?: Date; lt?: Date };

export function parseRange(from?: string | null, to?: string | null, defaultDays?: number): DateRange {
  const f = from && DAY.test(from) ? from : undefined;
  const t = to && DAY.test(to) ? to : undefined;
  const r: DateRange = {};
  if (f) { r.from = f; r.gte = new Date(`${f}T00:00:00+01:00`); }
  if (t) { r.to = t; r.lt = new Date(new Date(`${t}T00:00:00+01:00`).getTime() + 86400e3); }
  if (!f && !t && defaultDays) {
    const today = lagosDay(new Date());
    const start = lagosDay(new Date(Date.now() - (defaultDays - 1) * 86400e3));
    return parseRange(start, today);
  }
  if (r.gte && r.lt && r.gte >= r.lt) return {};
  return r;
}

/** Prisma `where` fragment for a date column, or undefined when no range is set. */
export function dateWhere(r: DateRange) {
  return r.gte || r.lt ? { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } : undefined;
}

export function lagosDay(d: Date) {
  return new Date(d.getTime() + 3600e3).toISOString().slice(0, 10);
}

export function pageOf(raw?: string) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
}

/** Search text trimmed and capped, so a huge query string can't be sent to the database. */
export function searchText(raw?: string) {
  const s = (raw ?? "").trim().slice(0, 100);
  return s || undefined;
}
