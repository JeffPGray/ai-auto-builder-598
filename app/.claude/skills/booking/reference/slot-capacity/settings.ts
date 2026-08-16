import { supabaseAdmin } from "./supabase";

/**
 * Loader for the single booking-settings row — the single source of truth for
 * every business rule. Installed by the Klaudius booking skill as
 * `src/lib/booking/settings.ts` (slot-capacity variant). Generic plumbing —
 * do not edit per site: per-site values live in the DATABASE ROW, not here.
 */

export interface BookingSettings {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  timezone: string;
  locale: string;
  serviceDays: number[]; // 0=Sunday … 6=Saturday
  slotTimes: string[]; // 'HH:MM'
  slotDurationMinutes: number;
  maxCoversPerSlot: number;
  tablesPerSlot: number | null;
  coversPerTable: number | null;
  minParty: number;
  maxParty: number;
  advanceDays: number;
  cutoffHours: number;
  refPrefix: string;
}

// Row shape as stored (snake_case).
interface SettingsRow {
  business_name: string;
  business_email: string;
  business_phone: string;
  business_address: string;
  timezone: string;
  locale: string;
  service_days: number[];
  slot_times: string[];
  slot_duration_minutes: number;
  max_covers_per_slot: number;
  tables_per_slot: number | null;
  covers_per_table: number | null;
  min_party: number;
  max_party: number;
  advance_days: number;
  cutoff_hours: number;
  ref_prefix: string;
}

// Short in-memory cache: settings change rarely (owner rule tweaks), but a
// change must show up without a redeploy. 30s staleness is invisible to
// customers and saves a query on hot paths. The create RPC re-reads the row
// transactionally regardless, so a stale cache can never over-book.
const TTL_MS = 30_000;
let cache: { value: BookingSettings; at: number } | null = null;

// A bad timezone would silently corrupt every cutoff; fail loud instead.
// A bad locale (e.g. 'en_GB' with an underscore) would make Intl throw on
// every availability call; locale is display-only, so fall back quietly.
function validateTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`Booking settings: invalid IANA timezone "${tz}" — fix the settings row`);
  }
}

function validateLocale(locale: string): string {
  try {
    new Intl.DateTimeFormat(locale);
    return locale;
  } catch {
    console.error(`Booking settings: invalid locale "${locale}" — falling back to en-GB`);
    return "en-GB";
  }
}

export async function getSettings(): Promise<BookingSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const { data, error } = await supabaseAdmin()
    .from("biz_booking_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load booking settings: ${error.message}`);
  if (!data) throw new Error("Booking settings row missing — apply schema.sql seed");

  const r = data as SettingsRow;
  const value: BookingSettings = {
    businessName: r.business_name,
    businessEmail: r.business_email,
    businessPhone: r.business_phone,
    businessAddress: r.business_address,
    timezone: validateTimezone(r.timezone),
    locale: validateLocale(r.locale),
    serviceDays: r.service_days,
    slotTimes: r.slot_times,
    slotDurationMinutes: r.slot_duration_minutes,
    maxCoversPerSlot: r.max_covers_per_slot,
    tablesPerSlot: r.tables_per_slot,
    coversPerTable: r.covers_per_table,
    minParty: r.min_party,
    maxParty: r.max_party,
    advanceDays: r.advance_days,
    cutoffHours: r.cutoff_hours,
    refPrefix: r.ref_prefix,
  };
  cache = { value, at: Date.now() };
  return value;
}

/** Tables a party consumes, or null when capacity is headcount-only. */
export function tablesForParty(
  partySize: number,
  coversPerTable: number | null
): number | null {
  if (coversPerTable === null) return null;
  return Math.ceil(partySize / coversPerTable);
}
