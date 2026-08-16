import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import { todayInTz } from "@/lib/booking/dates";
import { sendCustomerReminder, type EmailAppointment } from "@/lib/booking/emails";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/booking/cron-reminders — Vercel cron, once each morning. Sends one
 * reminder per confirmed appointment happening today (business timezone)
 * that hasn't been reminded yet, then stamps reminder_sent_at. Installed by
 * the Klaudius booking skill as
 * `src/app/api/booking/cron-reminders/route.ts` (appointments variant).
 * Generic plumbing — do not edit per site.
 *
 * Gated by CRON_SECRET: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`
 * automatically when that env var exists on the project.
 */

interface ApptRow {
  id: string;
  booking_ref: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  notes: string | null;
  service: { name: string } | null;
  staff: { name: string } | null;
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

  // Earliest appointments first: if a huge day ever brushes the maxDuration
  // limit, the reminders that get cut are the least urgent ones.
  const { data, error } = await supabaseAdmin()
    .from("biz_appointments")
    .select(
      "id, booking_ref, appointment_date, start_time, end_time, customer_name, customer_phone, customer_email, notes, service:service_id(name), staff:staff_id(name)"
    )
    .eq("appointment_date", today)
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .order("start_time", { ascending: true })
    .limit(500);

  if (error) {
    console.error("Reminder query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const appts = (data ?? []) as unknown as ApptRow[];
  let sent = 0;
  let failed = 0;
  let skippedNoEmail = 0;

  for (const a of appts) {
    // Front-desk bookings may have no email — stamp anyway so this
    // appointment doesn't requeue on every future run.
    if (!a.customer_email || a.customer_email.trim() === "") {
      const { error: stampErr } = await supabaseAdmin()
        .from("biz_appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", a.id);
      if (stampErr) {
        console.error(`Reminder stamp (no-email) failed for ${a.booking_ref}:`, stampErr);
      }
      skippedNoEmail++;
      continue;
    }

    const payload: EmailAppointment = {
      bookingRef: a.booking_ref,
      date: a.appointment_date,
      startTime: a.start_time.slice(0, 5),
      endTime: a.end_time.slice(0, 5),
      serviceName: a.service?.name ?? "",
      staffName: a.staff?.name ?? "",
      customerName: a.customer_name,
      customerPhone: a.customer_phone,
      customerEmail: a.customer_email,
      notes: a.notes ?? "",
    };

    try {
      await sendCustomerReminder(s, payload);
      const { error: updateErr } = await supabaseAdmin()
        .from("biz_appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", a.id);
      if (updateErr) {
        console.error(`Reminder stamp failed for ${a.booking_ref}:`, updateErr);
      }
      sent++;
    } catch (err) {
      console.error(`Reminder send failed for ${a.booking_ref}:`, err);
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    sent,
    failed,
    skippedNoEmail,
    candidates: appts.length,
  });
}
