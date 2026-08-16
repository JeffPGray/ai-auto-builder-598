import { supabaseAdmin } from "./supabase";

/**
 * Loaders for the booking settings row and the service/staff catalogue —
 * the single source of truth for every business rule. Installed by the
 * Klaudius booking skill as `src/lib/booking/settings.ts` (appointments
 * variant). Generic plumbing — do not edit per site: per-site values live in
 * the DATABASE ROWS, not here.
 */

export interface BookingSettings {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  timezone: string;
  locale: string;
  slotGranularityMinutes: number;
  advanceDays: number;
  cutoffHours: number;
  refPrefix: string;
}

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceLabel: string;
  staff: { id: string; name: string }[];
}

export interface StaffInfo {
  id: string;
  name: string;
}

// Short in-memory cache: rules and the catalogue change rarely but must show
// up without a redeploy. The create RPC re-reads everything transactionally
// regardless, so a stale cache can never double-book.
const TTL_MS = 30_000;
let settingsCache: { value: BookingSettings; at: number } | null = null;
let catalogCache: { services: ServiceInfo[]; staff: StaffInfo[]; at: number } | null = null;

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
  if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value;

  const { data, error } = await supabaseAdmin()
    .from("biz_booking_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load booking settings: ${error.message}`);
  if (!data) throw new Error("Booking settings row missing — apply schema.sql seed");

  const value: BookingSettings = {
    businessName: data.business_name,
    businessEmail: data.business_email,
    businessPhone: data.business_phone,
    businessAddress: data.business_address,
    timezone: validateTimezone(data.timezone),
    locale: validateLocale(data.locale),
    slotGranularityMinutes: data.slot_granularity_minutes,
    advanceDays: data.advance_days,
    cutoffHours: data.cutoff_hours,
    refPrefix: data.ref_prefix,
  };
  settingsCache = { value, at: Date.now() };
  return value;
}

/** Active services (with their qualified staff) + active staff, for the form. */
export async function getCatalog(): Promise<{ services: ServiceInfo[]; staff: StaffInfo[] }> {
  if (catalogCache && Date.now() - catalogCache.at < TTL_MS) {
    return { services: catalogCache.services, staff: catalogCache.staff };
  }

  const [svcRes, staffRes, linkRes] = await Promise.all([
    supabaseAdmin()
      .from("biz_services")
      .select("id, name, description, duration_minutes, price_label")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabaseAdmin()
      .from("biz_staff")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabaseAdmin().from("biz_staff_services").select("staff_id, service_id"),
  ]);

  if (svcRes.error) throw new Error(`Failed to load services: ${svcRes.error.message}`);
  if (staffRes.error) throw new Error(`Failed to load staff: ${staffRes.error.message}`);
  if (linkRes.error) throw new Error(`Failed to load staff-services: ${linkRes.error.message}`);

  const staff = (staffRes.data ?? []) as StaffInfo[];
  const staffById = new Map(staff.map((st) => [st.id, st]));
  const links = (linkRes.data ?? []) as { staff_id: string; service_id: string }[];

  const services: ServiceInfo[] = (svcRes.data ?? []).map((sv) => ({
    id: sv.id,
    name: sv.name,
    description: sv.description,
    durationMinutes: sv.duration_minutes,
    priceLabel: sv.price_label,
    staff: links
      .filter((l) => l.service_id === sv.id)
      .map((l) => staffById.get(l.staff_id))
      .filter((st): st is StaffInfo => Boolean(st)),
  }));

  catalogCache = { services, staff, at: Date.now() };
  return { services, staff };
}
