/**
 * Date-only values ("2026-09-16") mean a calendar day, not an instant.
 *
 * `new Date("2026-09-16")` is midnight UTC, so west of UTC it renders as the
 * day before, and east of UTC a thing due today counts as overdue from 02:00.
 * Moments store their day as a timestamptz at UTC midnight, so their first ten
 * characters are the day too. Everything here reads and compares the day in
 * the viewer's local calendar.
 */
import { todayISO } from "./claims";

const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** YYYY-MM-DD of a Date in local time. */
export { todayISO as localDateISO };

/** The calendar day of a stored date or timestamp, as YYYY-MM-DD. */
export function dayOf(value: string): string {
  return value.slice(0, 10);
}

/**
 * Local midnight of the day a date-only value (or a moment's timestamp) names,
 * for display with toLocaleDateString / date-fns format. Null when unparseable.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DAY_PREFIX.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** True when a due date's day is before today's local day. Due today is not overdue. */
export function isPastDay(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value || !DAY_PREFIX.test(value)) return false;
  return dayOf(value) < todayISO(now);
}
