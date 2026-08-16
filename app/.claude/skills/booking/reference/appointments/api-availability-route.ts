import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import {
  dayOfWeekForDateStr,
  formatTimeLabel,
  isValidDateStr,
  isWithinAdvanceWindow,
} from "@/lib/booking/dates";
import { clientIp, rateLimit } from "@/lib/booking/security";
import { hashIp, logDemandSignal, type DemandOutcome } from "@/lib/booking/demand";

/**
 * GET /api/booking/availability?date=YYYY-MM-DD&service=<uuid>[&staff=<uuid>][&exclude=<cancel_token>]
 * Installed by the Klaudius booking skill as
 * `src/app/api/booking/availability/route.ts` (appointments variant).
 * Generic plumbing — do not edit per site.
 *
 * Public, read-only. Returns the bookable start times for that date +
 * service (optionally narrowed to one staff member), each with the staff who
 * can take it. Every call also logs a demand signal.
 *
 * `exclude` is the reschedule picker's cancel token: the matching
 * appointment's block is ignored when computing free times, so a customer's
 * own 14:00 appointment can't hide the 14:30 they want to move to. The token
 * is resolved to an id server-side (never trust a raw appointment id from
 * the client); an unknown token is simply ignored — availability is then
 * merely conservative.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RpcRow {
  slot_start: string; // 'HH:MM:SS' from Postgres time
  slot_staff_id: string;
  slot_staff_name: string;
  slot_cutoff: boolean;
}

export async function GET(request: NextRequest) {
  const ip = clientIp(request.headers);
  const rl = rateLimit("booking-availability", ip, 60, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  const serviceId = params.get("service") ?? "";
  const staffId = params.get("staff");
  const excludeToken = params.get("exclude");

  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (!UUID.test(serviceId)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }
  if (staffId !== null && !UUID.test(staffId)) {
    return NextResponse.json({ error: "Invalid staff" }, { status: 400 });
  }

  const s = await getSettings();
  const base = { bookingDate: date, serviceId, ipHash: hashIp(ip) } as const;

  if (!isWithinAdvanceWindow(date, s.advanceDays, s.timezone)) {
    await logDemandSignal({ ...base, outcome: "outside_window", source: "availability_check" });
    return NextResponse.json({ date, times: [], reason: "outside_window" });
  }

  // Resolve the reschedule token (if any) to the appointment it moves.
  let excludeId: string | null = null;
  if (excludeToken && excludeToken.length >= 16 && excludeToken.length <= 128) {
    const { data: excludeRow } = await supabaseAdmin()
      .from("biz_appointments")
      .select("id")
      .eq("cancel_token", excludeToken)
      .eq("status", "confirmed")
      .maybeSingle();
    excludeId = (excludeRow as { id: string } | null)?.id ?? null;
  }

  const { data, error } = await supabaseAdmin().rpc("biz_get_appointment_availability", {
    p_date: date,
    p_service_id: serviceId,
    p_staff_id: staffId,
    p_exclude_appointment_id: excludeId,
  });

  if (error) {
    if (error.message?.includes("Invalid service")) {
      return NextResponse.json({ error: "Invalid service" }, { status: 400 });
    }
    console.error("Availability RPC error:", error);
    return NextResponse.json({ error: "Failed to check availability" }, { status: 500 });
  }

  const rows = (data ?? []) as RpcRow[];

  // Group by start time; a time is bookable when at least one staff member is
  // free for it and it isn't behind the cutoff.
  const byStart = new Map<string, { staff: { id: string; name: string }[]; cutoff: boolean }>();
  for (const r of rows) {
    const hhmm = r.slot_start.slice(0, 5);
    const entry = byStart.get(hhmm) ?? { staff: [], cutoff: r.slot_cutoff };
    entry.staff.push({ id: r.slot_staff_id, name: r.slot_staff_name });
    byStart.set(hhmm, entry);
  }
  const times = [...byStart.entries()]
    .filter(([, v]) => !v.cutoff)
    .map(([startTime, v]) => ({
      startTime,
      label: formatTimeLabel(startTime, s.locale),
      staff: v.staff,
    }));

  // Reason + demand signal when nothing is bookable. The probes must mirror
  // the RPC's eligibility filters — qualification for THIS service, active
  // staff, the requested staff member, per-staff closures — or the customer
  // gets told "fully booked" for a day nobody qualified even works, and a
  // false no_capacity row corrupts the unmet-demand numbers.
  let reason: string | null = null;
  let outcome: DemandOutcome = "fits";
  if (times.length === 0) {
    if (rows.length > 0) {
      // Free slots existed but all sit behind the cutoff.
      reason = "cutoff_passed";
      outcome = "cutoff_passed";
    } else {
      const dow = dayOfWeekForDateStr(date);
      const [dayClosureRes, qualifiedRes] = await Promise.all([
        supabaseAdmin()
          .from("biz_closures")
          .select("id")
          .eq("closure_date", date)
          .is("staff_id", null)
          .maybeSingle(),
        supabaseAdmin()
          .from("biz_staff_services")
          .select("staff_id, staff:staff_id(is_active)")
          .eq("service_id", serviceId),
      ]);

      const qualifiedIds = ((qualifiedRes.data ?? []) as unknown as {
        staff_id: string;
        staff: { is_active: boolean } | null;
      }[])
        .filter((r) => r.staff?.is_active)
        .map((r) => r.staff_id)
        .filter((id) => !staffId || id === staffId);

      if (dayClosureRes.data) {
        reason = "date_closed";
        outcome = "date_closed";
      } else if (qualifiedIds.length === 0) {
        reason = "off_service";
        outcome = "no_staff_day";
      } else {
        const [hoursRes, staffClosuresRes] = await Promise.all([
          supabaseAdmin()
            .from("biz_staff_hours")
            .select("staff_id")
            .eq("day_of_week", dow)
            .in("staff_id", qualifiedIds),
          supabaseAdmin()
            .from("biz_closures")
            .select("staff_id")
            .eq("closure_date", date)
            .in("staff_id", qualifiedIds),
        ]);
        const workingIds = new Set(
          ((hoursRes.data ?? []) as { staff_id: string }[]).map((r) => r.staff_id)
        );
        const closedIds = new Set(
          ((staffClosuresRes.data ?? []) as { staff_id: string | null }[]).map((r) => r.staff_id)
        );
        const availableStaff = [...workingIds].filter((id) => !closedIds.has(id));
        if (workingIds.size === 0) {
          reason = "off_service"; // no qualified staff works this weekday
          outcome = "no_staff_day";
        } else if (availableStaff.length === 0) {
          reason = "date_closed"; // qualified staff exist but are all off that date
          outcome = "date_closed";
        } else {
          reason = "fully_booked";
          outcome = "no_capacity";
        }
      }
    }
  }
  await logDemandSignal({
    ...base,
    outcome,
    source: "availability_check",
    timesAvailable: times.length,
  });

  return NextResponse.json({ date, serviceId, times, reason });
}
