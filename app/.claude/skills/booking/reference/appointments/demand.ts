import { createHash } from "crypto";
import { supabaseAdmin } from "./supabase";

/**
 * Demand-signal logging (appointments variant) — fire-and-forget telemetry.
 * Installed by the Klaudius booking skill as `src/lib/booking/demand.ts`.
 * Generic plumbing — do not edit per site.
 *
 * Captures interest in a date+service even when the customer can't (or
 * doesn't) book, so the operator can show the owner unmet-demand numbers
 * later ("N people looked for a Saturday cut you couldn't take — worth
 * another chair?"). Never blocks the customer's response. IPs are stored
 * only as salted hashes.
 */

export type DemandOutcome =
  | "fits"
  | "no_capacity"
  | "cutoff_passed"
  | "date_closed"
  | "no_staff_day"
  | "outside_window";

export type DemandSource = "availability_check" | "booking_attempt";

export interface DemandSignal {
  bookingDate: string; // YYYY-MM-DD
  serviceId: string | null;
  outcome: DemandOutcome;
  source: DemandSource;
  timesAvailable?: number | null;
  ipHash?: string | null;
}

// Salt from SESSION_SECRET, which the booking install already requires — no
// extra env var. Not a security boundary; just avoids storing raw IPs.
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.SESSION_SECRET ?? "booking-demand-fallback-salt";
  return createHash("sha256").update(ip + salt).digest("hex");
}

/**
 * Callers must AWAIT this before returning their response — a fire-and-forget
 * insert gets killed when the Vercel serverless function returns (the same
 * reason the email sends are awaited), silently dropping the telemetry this
 * feature exists to collect. It never throws and never fails the request:
 * all errors are swallowed into a console.error.
 */
export async function logDemandSignal(signal: DemandSignal): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("biz_demand_signals")
      .insert({
        booking_date: signal.bookingDate,
        service_id: signal.serviceId,
        outcome: signal.outcome,
        source: signal.source,
        times_available: signal.timesAvailable ?? null,
        ip_hash: signal.ipHash ?? null,
      });
    if (error) console.error("Demand signal insert failed:", error.message);
  } catch (e) {
    console.error("Demand signal insert failed:", e);
  }
}
