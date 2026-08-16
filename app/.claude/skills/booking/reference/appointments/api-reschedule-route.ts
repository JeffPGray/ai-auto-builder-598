import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getCatalog, getSettings } from "@/lib/booking/settings";
import {
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
  type EmailAppointment,
} from "@/lib/booking/emails";

/**
 * POST /api/booking/reschedule — customer self-reschedule via the tokenised
 * link in their confirmation email. Installed by the Klaudius booking skill
 * as `src/app/api/booking/reschedule/route.ts` (appointments variant).
 * Generic plumbing — do not edit per site.
 *
 * The heavy lifting is the create RPC's `p_reschedule_of` argument: it
 * cancels the old appointment and books the new time in ONE transaction
 * under the advisory lock, so the customer can never lose their old time
 * without gaining the new one, their own old appointment never blocks a
 * nearby new time, and same-day moves never trip the per-day cap. Never
 * reimplement this as client-side create-then-cancel.
 */

const RESCHEDULE_MAX = 10;
const RESCHEDULE_WINDOW_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  token: z.string().min(16).max(128),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .refine(isValidDateStr, "Invalid date"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time"),
  staffId: z.string().regex(UUID, "Invalid staff").nullable().default(null),
});

interface ApptRow {
  id: string;
  booking_ref: string;
  appointment_date: string;
  start_time: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  notes: string | null;
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
  const { token, date, startTime, staffId } = parsed.data;

  const { data: rawExisting, error: fetchErr } = await supabaseAdmin()
    .from("biz_appointments")
    .select(
      "id, booking_ref, appointment_date, start_time, service_id, customer_name, customer_phone, customer_email, notes, status"
    )
    .eq("cancel_token", token)
    .maybeSingle();
  const existing = rawExisting as unknown as ApptRow | null;

  if (fetchErr) {
    console.error("Reschedule lookup error:", fetchErr);
    return NextResponse.json({ error: "Failed to look up appointment" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }
  if (existing.status === "cancelled") {
    return NextResponse.json(
      { error: "This appointment has already been cancelled. Please book a new one." },
      { status: 409 }
    );
  }

  const s = await getSettings();
  const oldStartHHMM = existing.start_time.slice(0, 5);

  // Same rule as online cancellation: once inside the cutoff the business is
  // committed to the old time — changes go through a phone call. Like the
  // cancel route, this old-side cutoff is route-enforced only (the RPC
  // enforces the NEW time transactionally); the sub-second TOCTOU window on
  // a courtesy rule is accepted, matching the cancel design.
  if (isCutoffPassed(existing.appointment_date, oldStartHHMM, s.cutoffHours, s.timezone)) {
    return NextResponse.json(
      {
        error: `Online changes close ${s.cutoffHours} hours before your appointment. ${s.businessPhone ? `Please call us on ${s.businessPhone} to rearrange.` : "Please contact us directly to rearrange."}`,
        cutoffPassed: true,
      },
      { status: 409 }
    );
  }

  if (date === existing.appointment_date && startTime === oldStartHHMM) {
    return NextResponse.json(
      { error: "That's the same time as your current appointment." },
      { status: 400 }
    );
  }

  // Friendly pre-checks on the NEW time. The RPC re-enforces all of these
  // transactionally — these exist only for better error copy.
  if (!isWithinAdvanceWindow(date, s.advanceDays, s.timezone)) {
    return NextResponse.json({ error: "That date is outside the booking window." }, { status: 400 });
  }
  if (isCutoffPassed(date, startTime, s.cutoffHours, s.timezone)) {
    return NextResponse.json(
      { error: "This time has closed for online bookings. Please pick another." },
      { status: 409 }
    );
  }

  // Service comes from the existing appointment — a reschedule moves the
  // time, never the treatment. (Catalog lookup also supplies the name for
  // emails and confirms the service is still active/bookable.)
  const { services } = await getCatalog();
  const service = services.find((sv) => sv.id === existing.service_id);
  if (!service) {
    return NextResponse.json(
      { error: "This service can no longer be booked online. Please contact us to rearrange." },
      { status: 409 }
    );
  }
  if (staffId && !service.staff.some((st) => st.id === staffId)) {
    return NextResponse.json(
      { error: "That staff member isn't available for this service." },
      { status: 400 }
    );
  }

  // Retry on the (rare) booking_ref / cancel_token unique collision.
  const MAX_REF_ATTEMPTS = 3;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 0; attempt < MAX_REF_ATTEMPTS; attempt++) {
    const bookingRef = generateBookingRef(s.refPrefix);
    const cancelToken = generateCancelToken();

    const { data: created, error } = await supabaseAdmin().rpc("biz_create_appointment", {
      p_booking_ref: bookingRef,
      p_cancel_token: cancelToken,
      p_date: date,
      p_start_time: startTime,
      p_service_id: existing.service_id,
      p_staff_id: staffId,
      p_name: existing.customer_name,
      p_phone: existing.customer_phone,
      p_email: existing.customer_email,
      p_notes: existing.notes ?? "",
      p_admin_override: false,
      p_reschedule_of: existing.id,
    });

    if (!error) {
      const result = created as {
        staff_name?: string;
        end_time?: string;
        visit_number?: number | null;
      } | null;
      const payload: EmailAppointment = {
        bookingRef,
        date,
        startTime,
        endTime: result?.end_time,
        serviceName: service.name,
        staffName: result?.staff_name ?? "",
        customerName: existing.customer_name,
        customerPhone: existing.customer_phone,
        customerEmail: existing.customer_email,
        notes: existing.notes ?? "",
      };
      const cancelUrl = `${request.nextUrl.origin}/book/cancel/${cancelToken}`;

      // Await with allSettled — fire-and-forget gets killed when the
      // serverless function returns, dropping the second email.
      await Promise.allSettled([
        sendOwnerReschedule(
          s,
          payload,
          existing.appointment_date,
          oldStartHHMM,
          result?.visit_number ?? null
        ).catch((e) => {
          console.error("[EMAIL_FAILED] type=owner_reschedule ref=" + bookingRef, e);
        }),
        sendCustomerReschedule(
          s,
          payload,
          existing.appointment_date,
          oldStartHHMM,
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
          startTime,
          serviceName: service.name,
          staffName: result?.staff_name ?? "",
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
      // A racing cancel/reschedule won — the old appointment is no longer
      // confirmed, so there's nothing to move.
      return NextResponse.json(
        { error: "This appointment has already been changed or cancelled. Please check your latest email." },
        { status: 409 }
      );
    }
    if (msg.includes("Time unavailable")) {
      // Real unmet demand: the customer wanted a time that's gone.
      await logDemandSignal({
        bookingDate: date,
        serviceId: existing.service_id,
        outcome: "no_capacity",
        source: "booking_attempt",
        ipHash: hashIp(ip),
      });
      return NextResponse.json(
        { error: "Sorry, this time just got taken. Please pick another." },
        { status: 409 }
      );
    }
    if (msg.includes("Too many bookings")) {
      return NextResponse.json(
        { error: "You already have appointments booked that day. Please call us if you need more." },
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
    if (msg.includes("Outside booking window")) {
      return NextResponse.json({ error: "That date is outside the booking window." }, { status: 400 });
    }
    if (msg.includes("Invalid service")) {
      return NextResponse.json(
        { error: "This service can no longer be booked online. Please contact us to rearrange." },
        { status: 409 }
      );
    }
    if (msg.includes("Invalid time")) {
      return NextResponse.json({ error: "That time isn't available to book online." }, { status: 400 });
    }

    break;
  }

  console.error("Appointment reschedule error:", lastError);
  return NextResponse.json({ error: "Failed to reschedule appointment" }, { status: 500 });
}
