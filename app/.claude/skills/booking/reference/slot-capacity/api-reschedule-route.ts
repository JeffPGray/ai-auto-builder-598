import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import {
  dayOfWeekForDateStr,
  isCutoffPassed,
  isValidDateStr,
  isWithinAdvanceWindow,
} from "@/lib/booking/dates";
import { generateBookingRef, generateCancelToken } from "@/lib/booking/tokens";
import { clientIp, isAllowedOrigin, rateLimit } from "@/lib/booking/security";
import { hashIp, logDemandSignal } from "@/lib/booking/demand";
import {
  sendCustomerReschedule,
  sendOwnerReschedule,
  type EmailBooking,
} from "@/lib/booking/emails";

/**
 * POST /api/booking/reschedule — customer self-reschedule via the tokenised
 * link in their confirmation email. Installed by the Klaudius booking skill
 * as `src/app/api/booking/reschedule/route.ts` (slot-capacity variant).
 *
 * A reschedule moves the TIME only — party size stays as booked (changing the
 * party is a different conversation; the form says so). The heavy lifting is
 * the create RPC's `p_reschedule_of` argument: it cancels the old booking and
 * books the new slot in ONE transaction under the advisory lock, so the
 * customer can never lose their old slot without gaining the new one, and
 * same-day moves never trip the per-day cap. Never reimplement this as
 * client-side create-then-cancel.
 */

const RESCHEDULE_MAX = 10;
const RESCHEDULE_WINDOW_MS = 10 * 60 * 1000;

const bodySchema = z.object({
  token: z.string().min(16).max(128),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .refine(isValidDateStr, "Invalid date"),
  slotTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time"),
});

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
  const rl = rateLimit("booking-reschedule", ip, RESCHEDULE_MAX, RESCHEDULE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { token, date, slotTime } = parsed.data;

  const { data: existing, error: fetchErr } = await supabaseAdmin()
    .from("biz_bookings")
    .select(
      "id, booking_ref, booking_date, slot_time, party_size, customer_name, customer_phone, customer_email, special_requests, status"
    )
    .eq("cancel_token", token)
    .maybeSingle<BookingRow>();

  if (fetchErr) {
    console.error("Reschedule lookup error:", fetchErr);
    return NextResponse.json({ error: "Failed to look up booking" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (existing.status === "cancelled") {
    return NextResponse.json(
      { error: "This booking has already been cancelled. Please book a new one." },
      { status: 409 }
    );
  }

  const s = await getSettings();

  // Same rule as online cancellation: once inside the cutoff the business is
  // committed to the old time — changes go through a phone call. Like the
  // cancel route, this old-side cutoff is route-enforced only (the RPC
  // enforces the NEW time transactionally); the sub-second TOCTOU window on
  // a courtesy rule is accepted, matching the cancel design.
  if (isCutoffPassed(existing.booking_date, existing.slot_time, s.cutoffHours, s.timezone)) {
    return NextResponse.json(
      {
        error: `Online changes close ${s.cutoffHours} hours before your booking. ${s.businessPhone ? `Please call us on ${s.businessPhone} to rearrange.` : "Please contact us directly to rearrange."}`,
        cutoffPassed: true,
      },
      { status: 409 }
    );
  }

  if (date === existing.booking_date && slotTime === existing.slot_time) {
    return NextResponse.json(
      { error: "That's the same time as your current booking." },
      { status: 400 }
    );
  }

  // Friendly pre-checks on the NEW time. The RPC re-enforces all of these
  // transactionally — these exist only for better error copy.
  if (!s.slotTimes.includes(slotTime)) {
    return NextResponse.json({ error: "That time isn't available to book online." }, { status: 400 });
  }
  if (!s.serviceDays.includes(dayOfWeekForDateStr(date))) {
    return NextResponse.json({ error: "We don't take bookings on that day." }, { status: 400 });
  }
  if (!isWithinAdvanceWindow(date, s.advanceDays, s.timezone)) {
    return NextResponse.json({ error: "That date is outside the booking window." }, { status: 400 });
  }
  if (isCutoffPassed(date, slotTime, s.cutoffHours, s.timezone)) {
    return NextResponse.json(
      { error: "This time has closed for online bookings. Please pick another." },
      { status: 409 }
    );
  }

  // Retry on the (rare) booking_ref / cancel_token unique collision.
  const MAX_REF_ATTEMPTS = 3;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 0; attempt < MAX_REF_ATTEMPTS; attempt++) {
    const bookingRef = generateBookingRef(s.refPrefix);
    const cancelToken = generateCancelToken();

    const { data: created, error } = await supabaseAdmin().rpc("biz_create_booking", {
      p_booking_ref: bookingRef,
      p_cancel_token: cancelToken,
      p_date: date,
      p_slot_time: slotTime,
      p_party_size: existing.party_size,
      p_name: existing.customer_name,
      p_phone: existing.customer_phone,
      p_email: existing.customer_email,
      p_special_requests: existing.special_requests ?? "",
      p_admin_override: false,
      p_reschedule_of: existing.id,
    });

    if (!error) {
      const result = created as { visit_number?: number | null } | null;
      const payload: EmailBooking = {
        bookingRef,
        date,
        slotTime,
        partySize: existing.party_size,
        customerName: existing.customer_name,
        customerPhone: existing.customer_phone,
        customerEmail: existing.customer_email,
        specialRequests: existing.special_requests ?? "",
      };
      const cancelUrl = `${request.nextUrl.origin}/book/cancel/${cancelToken}`;

      // Await with allSettled — fire-and-forget gets killed when the
      // serverless function returns, dropping the second email.
      await Promise.allSettled([
        sendOwnerReschedule(
          s,
          payload,
          existing.booking_date,
          existing.slot_time,
          result?.visit_number ?? null
        ).catch((e) => {
          console.error("[EMAIL_FAILED] type=owner_reschedule ref=" + bookingRef, e);
        }),
        sendCustomerReschedule(
          s,
          payload,
          existing.booking_date,
          existing.slot_time,
          cancelUrl
        ).catch((e) => {
          console.error("[EMAIL_FAILED] type=customer_reschedule ref=" + bookingRef, e);
        }),
      ]);

      return NextResponse.json({
        success: true,
        bookingRef,
        cancelUrl,
        booking: {
          date,
          slotTime,
          partySize: existing.party_size,
          name: existing.customer_name,
        },
      });
    }

    lastError = error as { message?: string; code?: string };

    // 23505 = unique_violation — retry with a fresh ref/token pair.
    if (
      lastError.code === "23505" &&
      (lastError.message?.includes("booking_ref") || lastError.message?.includes("cancel_token"))
    ) {
      continue;
    }

    const msg = lastError.message ?? "";
    if (msg.includes("Reschedule target gone")) {
      // A racing cancel/reschedule won — the old booking is no longer
      // confirmed, so there's nothing to move.
      return NextResponse.json(
        { error: "This booking has already been changed or cancelled. Please check your latest email." },
        { status: 409 }
      );
    }
    if (msg.includes("Slot full")) {
      // Real unmet demand: the customer wanted a slot that's gone.
      await logDemandSignal({
        bookingDate: date,
        partySize: existing.party_size,
        outcome: "no_capacity",
        source: "booking_attempt",
        ipHash: hashIp(ip),
      });
      return NextResponse.json(
        { error: "Sorry, this time just filled up. Please pick another." },
        { status: 409 }
      );
    }
    if (msg.includes("Too many bookings")) {
      return NextResponse.json(
        { error: "You already have bookings for that day. Please call us if you need more." },
        { status: 409 }
      );
    }
    if (msg.includes("Date closed")) {
      return NextResponse.json({ error: "We're closed on that date. Please pick another." }, { status: 409 });
    }
    if (msg.includes("Cutoff passed")) {
      return NextResponse.json(
        { error: "This time has closed for online bookings. Please pick another." },
        { status: 409 }
      );
    }
    if (msg.includes("Date not in service days")) {
      return NextResponse.json({ error: "We don't take bookings on that day." }, { status: 400 });
    }
    if (msg.includes("Outside booking window")) {
      return NextResponse.json({ error: "That date is outside the booking window." }, { status: 400 });
    }
    if (msg.includes("Invalid slot")) {
      return NextResponse.json({ error: "That time isn't available to book online." }, { status: 400 });
    }
    if (msg.includes("Invalid party size")) {
      return NextResponse.json(
        { error: "That party size can't be booked online. Please call us to rearrange." },
        { status: 409 }
      );
    }

    break;
  }

  console.error("Booking reschedule error:", lastError);
  return NextResponse.json({ error: "Failed to reschedule booking" }, { status: 500 });
}
