import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import { isCutoffPassed } from "@/lib/booking/dates";
import { clientIp, isAllowedOrigin, rateLimit } from "@/lib/booking/security";
import {
  sendCustomerCancellation,
  sendOwnerCancellation,
  type EmailBooking,
} from "@/lib/booking/emails";

/**
 * POST /api/booking/cancel — customer self-cancel via the tokenised link in
 * their confirmation email. Installed by the Klaudius booking skill as
 * `src/app/api/booking/cancel/route.ts` (slot-capacity variant). Generic
 * plumbing — do not edit per site.
 *
 * Idempotent: cancelling an already-cancelled booking returns success with
 * `alreadyCancelled: true` (so refreshing the cancel page never errors), and
 * the conditional UPDATE means a race with a staff-side cancel can never send
 * duplicate emails.
 */

const CANCEL_MAX = 10;
const CANCEL_WINDOW_MS = 10 * 60 * 1000;

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
  status: string;
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

  const { data: existing, error: fetchErr } = await supabaseAdmin()
    .from("biz_bookings")
    .select(
      "id, booking_ref, booking_date, slot_time, party_size, customer_name, customer_phone, customer_email, special_requests, status"
    )
    .eq("cancel_token", token)
    .maybeSingle<BookingRow>();

  if (fetchErr) {
    console.error("Cancel lookup error:", fetchErr);
    return NextResponse.json({ error: "Failed to look up booking" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (existing.status === "cancelled") {
    return NextResponse.json({ success: true, alreadyCancelled: true, bookingRef: existing.booking_ref });
  }

  const s = await getSettings();

  // Online cancellation shares the booking cutoff: once the business is
  // committed to a time, an automated cancel would drop them with no chance
  // to adjust — force the phone conversation instead. The cancel page checks
  // this before showing the button, but we re-enforce server-side.
  if (isCutoffPassed(existing.booking_date, existing.slot_time, s.cutoffHours, s.timezone)) {
    return NextResponse.json(
      {
        error: `Online cancellation closes ${s.cutoffHours} hours before your booking. ${s.businessPhone ? `Please call us on ${s.businessPhone} if you can't make it.` : "Please contact us directly if you can't make it."}`,
        cutoffPassed: true,
      },
      { status: 409 }
    );
  }

  // Conditional update — only flips status while it's still 'confirmed'. If
  // a staff-side cancel raced us and won, zero rows come back and we skip the
  // emails (they were already sent by the winner).
  const { data: updatedRows, error: updateErr } = await supabaseAdmin()
    .from("biz_bookings")
    .update({ status: "cancelled", cancelled_by: "customer" })
    .eq("id", existing.id)
    .eq("status", "confirmed")
    .select("id");

  if (updateErr) {
    console.error("Cancel update error:", updateErr);
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ success: true, alreadyCancelled: true, bookingRef: existing.booking_ref });
  }

  const payload: EmailBooking = {
    bookingRef: existing.booking_ref,
    date: existing.booking_date,
    slotTime: existing.slot_time,
    partySize: existing.party_size,
    customerName: existing.customer_name,
    customerPhone: existing.customer_phone,
    customerEmail: existing.customer_email,
    specialRequests: existing.special_requests ?? "",
  };

  // Await both sends with allSettled — pure fire-and-forget gets killed when
  // the serverless function returns, dropping the second email.
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
