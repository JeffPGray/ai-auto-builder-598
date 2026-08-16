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
import { hashIp, logDemandSignal, type SlotState } from "@/lib/booking/demand";

/**
 * GET /api/booking/availability?date=YYYY-MM-DD&party=N
 * Installed by the Klaudius booking skill as
 * `src/app/api/booking/availability/route.ts` (slot-capacity variant).
 * Generic plumbing — do not edit per site.
 *
 * Public, read-only. Returns one entry per configured slot with a `bookable`
 * flag plus the reason flags the form needs for honest messaging ("fully
 * booked" vs "online booking closed"). Every call also logs a demand signal.
 */

interface RpcRow {
  slot_time: string;
  covers_booked: number;
  tables_booked: number;
  covers_remaining: number;
  tables_remaining: number | null;
  can_fit_party: boolean;
  cutoff_passed: boolean;
  closed: boolean;
}

export async function GET(request: NextRequest) {
  const ip = clientIp(request.headers);
  const rl = rateLimit("booking-availability", ip, 60, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Validate the free parameters before any DB work.
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  const party = parseInt(params.get("party") ?? "", 10);
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (!Number.isInteger(party) || party < 1 || party > 500) {
    return NextResponse.json({ error: "Invalid party size" }, { status: 400 });
  }

  const s = await getSettings();
  if (party < s.minParty || party > s.maxParty) {
    return NextResponse.json({ error: "Invalid party size" }, { status: 400 });
  }

  const base = { bookingDate: date, partySize: party, ipHash: hashIp(ip) } as const;

  if (!isWithinAdvanceWindow(date, s.advanceDays, s.timezone)) {
    await logDemandSignal({ ...base, outcome: "outside_window", source: "availability_check" });
    return NextResponse.json({ date, slots: [], reason: "outside_window" });
  }
  if (!s.serviceDays.includes(dayOfWeekForDateStr(date))) {
    await logDemandSignal({ ...base, outcome: "date_off_service", source: "availability_check" });
    return NextResponse.json({ date, slots: [], reason: "off_service" });
  }

  const { data, error } = await supabaseAdmin().rpc("biz_get_slot_availability", {
    p_date: date,
    p_party_size: party,
  });

  if (error) {
    console.error("Availability RPC error:", error);
    return NextResponse.json({ error: "Failed to check availability" }, { status: 500 });
  }

  const rows = (data ?? []) as RpcRow[];
  const slots = rows.map((r) => ({
    slotTime: r.slot_time,
    label: formatTimeLabel(r.slot_time, s.locale),
    coversRemaining: r.covers_remaining,
    tablesRemaining: r.tables_remaining,
    canFitParty: r.can_fit_party,
    cutoffPassed: r.cutoff_passed,
    closed: r.closed,
    bookable: r.can_fit_party && !r.cutoff_passed && !r.closed,
  }));

  // One demand signal per check, with the per-slot picture attached.
  const slotStates: Record<string, SlotState> = {};
  for (const sl of slots) {
    slotStates[sl.slotTime] = sl.closed
      ? "closed"
      : sl.cutoffPassed
        ? "cutoff_passed"
        : sl.canFitParty
          ? "available"
          : "full";
  }
  const anyBookable = slots.some((sl) => sl.bookable);
  const allClosed = slots.length > 0 && slots.every((sl) => sl.closed);
  const anyFitBehindCutoff = slots.some((sl) => sl.canFitParty && sl.cutoffPassed && !sl.closed);
  await logDemandSignal({
    ...base,
    outcome: anyBookable
      ? "fits"
      : allClosed
        ? "date_closed"
        : anyFitBehindCutoff
          ? "cutoff_passed"
          : "no_capacity",
    source: "availability_check",
    slotStates,
  });

  return NextResponse.json({ date, partySize: party, slots });
}
