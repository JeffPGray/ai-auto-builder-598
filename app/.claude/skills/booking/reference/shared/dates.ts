/**
 * Timezone-aware, DST-safe date helpers for the booking system. Installed by
 * the Klaudius booking skill as `src/lib/booking/dates.ts`. Generic plumbing —
 * do not edit per site.
 *
 * Conventions (shared with the SQL layer):
 *   - date-only values are `YYYY-MM-DD` strings
 *   - slot / appointment times are `HH:MM` 24-hour strings
 *   - the business timezone is an IANA name from the settings row
 *
 * There is deliberately no date library. Two techniques keep this DST-stable:
 *   - date arithmetic anchors every date at NOON UTC, so adding/subtracting
 *     whole days can never drift across a DST boundary at midnight
 *   - "is it past X yet?" comparisons happen in WALL-CLOCK components of the
 *     business timezone (via Intl), never in UTC instants
 *
 * The cutoff rule also lives in SQL (the create-booking RPC reads
 * cutoff_hours from the settings table and enforces it transactionally).
 * These helpers exist for UX — hiding closed slots, friendly errors — and
 * both sides read the same settings row, so they cannot drift.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function wallClockParts(tz: string): { dateStr: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    // Intl can emit "24" for midnight in some environments — normalise to 0.
    minutes: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10),
  };
}

/** Today's date in the business timezone as YYYY-MM-DD. */
export function todayInTz(tz: string): string {
  return wallClockParts(tz).dateStr;
}

/**
 * True for a real calendar date in YYYY-MM-DD form. Rejects shapes the
 * regex alone would pass (2026-02-30, 2026-13-01) so garbage 400s at the
 * route instead of 500ing at the Postgres date cast.
 */
export function isValidDateStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/** Day of week for a YYYY-MM-DD string. 0=Sunday … 6=Saturday. */
export function dayOfWeekForDateStr(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** Shift a YYYY-MM-DD by whole days. Noon-UTC anchor avoids DST drift. */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Latest bookable date (inclusive) given the advance window. */
export function maxBookableDateStr(advanceDays: number, tz: string): string {
  return shiftDateStr(todayInTz(tz), advanceDays);
}

/** True when dateStr is between today and today+advanceDays, inclusive. */
export function isWithinAdvanceWindow(
  dateStr: string,
  advanceDays: number,
  tz: string
): boolean {
  const today = todayInTz(tz);
  return dateStr >= today && dateStr <= shiftDateStr(today, advanceDays);
}

/**
 * True once bookings/cancellations for a given date + start time have closed
 * (i.e. now >= start − cutoffHours), measured in business-timezone wall-clock.
 *
 * The cutoff moment is computed by borrowing whole days first and then
 * normalising a negative minute remainder into a further day borrow, so any
 * combination works: 6h before an 18:00 slot (12:00 same day), 12h before an
 * 09:00 slot (21:00 the previous day), 48h before anything, etc.
 */
export function isCutoffPassed(
  dateStr: string,
  timeStr: string,
  cutoffHours: number,
  tz: string
): boolean {
  const [h, m] = timeStr.split(":").map(Number);

  let daysBack = Math.floor(cutoffHours / 24);
  let cutoffMinutes = h * 60 + m - (cutoffHours % 24) * 60;
  if (cutoffMinutes < 0) {
    cutoffMinutes += 24 * 60;
    daysBack += 1;
  }
  const cutoffDateStr = shiftDateStr(dateStr, -daysBack);

  const now = wallClockParts(tz);
  if (now.dateStr > cutoffDateStr) return true;
  if (now.dateStr < cutoffDateStr) return false;
  return now.minutes >= cutoffMinutes;
}

// ─── Display helpers ────────────────────────────────────────────────────────

/** "Friday 19 July 2026" (or the locale's equivalent long form). */
export function formatLongDate(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

/** "Sat 19 Jul" — compact form for date pickers and dashboards. */
export function formatShortDate(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

/**
 * Format an HH:MM time for display. The locale decides 12h vs 24h ("6:00 pm"
 * in en-GB style locales, "18:00" in most others).
 */
export function formatTimeLabel(timeStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`1970-01-01T${timeStr}:00Z`));
}

/** Add whole minutes to an HH:MM string. Caps at 23:59 (same-day model). */
export function addMinutesToTime(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
