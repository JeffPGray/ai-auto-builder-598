import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import { todayInTz } from "@/lib/booking/dates";
import { sendCustomerReminder, type EmailBooking } from "@/lib/booking/emails";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/booking/cron-reminders — Vercel cron, once each morning. Sends one
 * reminder per confirmed booking happening today (business timezone) that
 * hasn't been reminded yet, then stamps reminder_sent_at. Installed by the
 * Klaudius booking skill as
 * `src/app/api/booking/cron-reminders/route.ts` (slot-capacity variant).
 * Generic plumbing — do not edit per site.
 *
 * Gated by CRON_SECRET: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`
 * automatically when that env var exists on the project.
 */

interface BookingRow {
  id: string;
  booking_ref: string;
  booking_date: string;
  slot_time: string;
  party_size: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  special_requests: string | null;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  // Constant-time comparison (hash both sides to fixed length first).
  const authHash = createHash("sha256").update(auth).digest();
  const expectedHash = createHash("sha256").update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(authHash, expectedHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const s = await getSettings();
  const today = todayInTz(s.timezone);

  // Earliest slots first: if a huge day ever brushes the maxDuration limit,
  // the reminders that get cut are the ones latest in the day (least
  // urgent). Small-business volume stays far below either limit.
  const { data, error } = await supabaseAdmin()
    .from("biz_bookings")
    .select(
      "id, booking_ref, booking_date, slot_time, party_size, customer_name, customer_phone, customer_email, special_requests"
    )
    .eq("booking_date", today)
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .order("slot_time", { ascending: true })
    .limit(500);

  if (error) {
    console.error("Reminder query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const bookings = (data ?? []) as BookingRow[];
  let sent = 0;
  let failed = 0;
  let skippedNoEmail = 0;

  for (const b of bookings) {
    // Phone bookings may have no email — stamp anyway so this booking doesn't
    // requeue on every future run.
    if (!b.customer_email || b.customer_email.trim() === "") {
      const { error: stampErr } = await supabaseAdmin()
        .from("biz_bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", b.id);
      if (stampErr) {
        console.error(`Reminder stamp (no-email) failed for ${b.booking_ref}:`, stampErr);
      }
      skippedNoEmail++;
      continue;
    }

    const payload: EmailBooking = {
      bookingRef: b.booking_ref,
      date: b.booking_date,
      slotTime: b.slot_time,
      partySize: b.party_size,
      customerName: b.customer_name,
      customerPhone: b.customer_phone,
      customerEmail: b.customer_email,
      specialRequests: b.special_requests ?? "",
    };

    try {
      await sendCustomerReminder(s, payload);
      const { error: updateErr } = await supabaseAdmin()
        .from("biz_bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", b.id);
      if (updateErr) {
        console.error(`Reminder stamp failed for ${b.booking_ref}:`, updateErr);
      }
      sent++;
    } catch (err) {
      console.error(`Reminder send failed for ${b.booking_ref}:`, err);
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    sent,
    failed,
    skippedNoEmail,
    candidates: bookings.length,
  });
}
