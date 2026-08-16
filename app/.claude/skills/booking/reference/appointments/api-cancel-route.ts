import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import { isCutoffPassed } from "@/lib/booking/dates";
import { clientIp, isAllowedOrigin, rateLimit } from "@/lib/booking/security";
import {
  sendCustomerCancellation,
  sendOwnerCancellation,
  type EmailAppointment,
} from "@/lib/booking/emails";

/**
 * POST /api/booking/cancel — customer self-cancel via the tokenised link in
 * their confirmation email. Installed by the Klaudius booking skill as
 * `src/app/api/booking/cancel/route.ts` (appointments variant). Generic
 * plumbing — do not edit per site.
 *
 * Idempotent, with the same conditional-update race guard as the
 * slot-capacity variant: a race with a staff-side cancel can never send
 * duplicate emails.
 */

const CANCEL_MAX = 10;
const CANCEL_WINDOW_MS = 10 * 60 * 1000;

interface ApptRow {
  id: string;
  booking_ref: string;
  appointment_date: string;
  start_time: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  notes: string | null;
  status: string;
  service: { name: string } | null;
  staff: { name: string } | null;
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = clientIp(request.headers);
  const rl = rateLimit("booking-cancel", ip, CANCEL_MAX, CANCEL_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token =
    body && typeof body === "object" && "token" in body && typeof (body as { token: unknown }).token === "string"
      ? (body as { token: string }).token
      : null;

  if (!token || token.length < 16 || token.length > 128) {
    return NextResponse.json({ error: "Invalid cancellation link" }, { status: 400 });
  }

  const { data: rawExisting, error: fetchErr } = await supabaseAdmin()
    .from("biz_appointments")
    .select(
      "id, booking_ref, appointment_date, start_time, customer_name, customer_phone, customer_email, notes, status, service:service_id(name), staff:staff_id(name)"
    )
    .eq("cancel_token", token)
    .maybeSingle();
  const existing = rawExisting as unknown as ApptRow | null;

  if (fetchErr) {
    console.error("Cancel lookup error:", fetchErr);
    return NextResponse.json({ error: "Failed to look up appointment" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  if (existing.status === "cancelled") {
    return NextResponse.json({ success: true, alreadyCancelled: true, bookingRef: existing.booking_ref });
  }

  const s = await getSettings();
  const startHHMM = existing.start_time.slice(0, 5);

  if (isCutoffPassed(existing.appointment_date, startHHMM, s.cutoffHours, s.timezone)) {
    return NextResponse.json(
      {
        error: `Online cancellation closes ${s.cutoffHours} hours before your appointment. ${s.businessPhone ? `Please call us on ${s.businessPhone} if you can't make it.` : "Please contact us directly if you can't make it."}`,
        cutoffPassed: true,
      },
      { status: 409 }
    );
  }

  const { data: updatedRows, error: updateErr } = await supabaseAdmin()
    .from("biz_appointments")
    .update({ status: "cancelled", cancelled_by: "customer" })
    .eq("id", existing.id)
    .eq("status", "confirmed")
    .select("id");

  if (updateErr) {
    console.error("Cancel update error:", updateErr);
    return NextResponse.json({ error: "Failed to cancel appointment" }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ success: true, alreadyCancelled: true, bookingRef: existing.booking_ref });
  }

  const payload: EmailAppointment = {
    bookingRef: existing.booking_ref,
    date: existing.appointment_date,
    startTime: startHHMM,
    serviceName: existing.service?.name ?? "",
    staffName: existing.staff?.name ?? "",
    customerName: existing.customer_name,
    customerPhone: existing.customer_phone,
    customerEmail: existing.customer_email,
    notes: existing.notes ?? "",
  };

  // Await with allSettled — fire-and-forget gets killed when the serverless
  // function returns, dropping the second email.
  await Promise.allSettled([
    sendOwnerCancellation(s, payload, "customer").catch((err) => {
      console.error("[EMAIL_FAILED] type=owner_cancellation ref=" + existing.booking_ref, err);
    }),
    sendCustomerCancellation(s, payload, "customer").catch((err) => {
      console.error("[EMAIL_FAILED] type=customer_cancellation ref=" + existing.booking_ref, err);
    }),
  ]);

  return NextResponse.json({ success: true, bookingRef: existing.booking_ref });
}
