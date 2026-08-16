import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getCatalog, getSettings } from "@/lib/booking/settings";
import {
  isCutoffPassed,
  isValidDateStr,
  isWithinAdvanceWindow,
  shiftDateStr,
} from "@/lib/booking/dates";
import { generateBookingRef, generateCancelToken } from "@/lib/booking/tokens";
import { clientIp, honeypotOk, isAllowedOrigin, rateLimit } from "@/lib/booking/security";
import { isAdminAuthenticated } from "@/lib/booking/admin-session";
import { hashIp, logDemandSignal } from "@/lib/booking/demand";
import {
  sendCustomerConfirmation,
  sendOwnerNotification,
  type EmailAppointment,
} from "@/lib/booking/emails";

/**
 * POST /api/booking — create an appointment (auto-confirms).
 * GET  /api/booking?date=… | ?from=…&to=… — admin-only list for the dashboard.
 * Installed by the Klaudius booking skill as `src/app/api/booking/route.ts`
 * (appointments variant). Generic plumbing — do not edit per site.
 *
 * Two flows share the POST handler:
 *   1. Public web flow — honeypot + rate limit + origin check + strict
 *      validation; the RPC enforces hours/overlaps/cutoff/window and assigns
 *      "any staff" requests. Sends owner notification + customer confirmation.
 *   2. Front-desk flow — requires a valid admin session cookie. Bypasses
 *      honeypot/rate-limit/origin, the cutoff and grid alignment (the RPC's
 *      admin_override); phone/email optional; customer confirmation opt-in;
 *      owner notification skipped.
 */

const BOOK_MAX = 5;
const BOOK_WINDOW_MS = 60 * 60 * 1000;
// Loose international shape, but at least 5 digits somewhere.
const PHONE_REGEX = /^(?=(?:[^0-9]*[0-9]){5})[+()0-9][()0-9\s.\-]{4,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const common = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .refine(isValidDateStr, "Invalid date"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time"),
  serviceId: z.string().regex(UUID, "Invalid service"),
  staffId: z.string().regex(UUID, "Invalid staff").nullable().default(null),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Name is too long"),
  notes: z.string().trim().max(500, "Notes must be under 500 characters").default(""),
};

const publicSchema = z.object({
  ...common,
  phone: z.string().trim().regex(PHONE_REGEX, "Please enter a valid phone number"),
  email: z.string().trim().email("Please enter a valid email address").max(254),
  website: z.string().max(0).default(""), // honeypot — must be empty
});

const adminSchema = z.object({
  ...common,
  phone: z.string().trim().max(60).default(""),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Invalid email")
    .default(""),
  sendConfirmationEmail: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const isAdmin = await isAdminAuthenticated();
  const ip = clientIp(request.headers);

  if (!isAdmin) {
    if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rl = rateLimit("booking-create", ip, BOOK_MAX, BOOK_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many booking attempts. Please try again later." },
        { status: 429 }
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isAdmin && !honeypotOk(body)) {
    console.warn("Booking honeypot triggered:", { ip, ua: request.headers.get("user-agent") });
    return NextResponse.json(
      { error: "Please try again. If this keeps happening, call us." },
      { status: 400 }
    );
  }

  const s = await getSettings();

  let data: {
    date: string;
    startTime: string;
    serviceId: string;
    staffId: string | null;
    name: string;
    phone: string;
    email: string;
    notes: string;
  };
  let sendConfirmationEmail: boolean;
  let sendOwnerEmail: boolean;

  if (isAdmin) {
    const parsed = adminSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    data = parsed.data;
    sendConfirmationEmail = parsed.data.sendConfirmationEmail && parsed.data.email !== "";
    sendOwnerEmail = false;
  } else {
    const parsed = publicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    data = parsed.data;
    sendConfirmationEmail = true;
    sendOwnerEmail = true;

    // Friendly pre-checks against live settings. The RPC re-enforces all of
    // these transactionally — these exist only for better error copy.
    if (!isWithinAdvanceWindow(data.date, s.advanceDays, s.timezone)) {
      return NextResponse.json({ error: "That date is outside the booking window." }, { status: 400 });
    }
    if (isCutoffPassed(data.date, data.startTime, s.cutoffHours, s.timezone)) {
      return NextResponse.json(
        { error: "This time has closed for online bookings. Please pick another." },
        { status: 409 }
      );
    }
  }

  // The service name for emails (also validates the id is a real service).
  const { services } = await getCatalog();
  const service = services.find((sv) => sv.id === data.serviceId);
  if (!service) {
    return NextResponse.json({ error: "That service isn't available." }, { status: 400 });
  }
  // A staff request must be one of the staff who perform this service —
  // otherwise a stale/bogus staff id would surface as a misleading "just got
  // taken" AND log a false top-strength demand signal.
  if (data.staffId && !service.staff.some((st) => st.id === data.staffId)) {
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
      p_date: data.date,
      p_start_time: data.startTime,
      p_service_id: data.serviceId,
      p_staff_id: data.staffId,
      p_name: data.name,
      p_phone: data.phone,
      p_email: data.email,
      p_notes: data.notes || "",
      p_admin_override: isAdmin,
      p_reschedule_of: null,
    });

    if (!error) {
      const result = created as { staff_name?: string; end_time?: string; visit_number?: number | null } | null;
      const staffName = result?.staff_name ?? "";
      const payload: EmailAppointment = {
        bookingRef,
        date: data.date,
        startTime: data.startTime,
        endTime: result?.end_time,
        serviceName: service.name,
        staffName,
        customerName: data.name,
        customerPhone: data.phone,
        customerEmail: data.email,
        notes: data.notes || "",
      };
      const cancelUrl = `${request.nextUrl.origin}/book/cancel/${cancelToken}`;

      const mailJobs: Promise<unknown>[] = [];
      if (sendOwnerEmail) {
        mailJobs.push(
          sendOwnerNotification(s, payload, result?.visit_number ?? null).catch((e) => {
            console.error("[EMAIL_FAILED] type=owner_notification ref=" + bookingRef, e);
          })
        );
      }
      if (sendConfirmationEmail) {
        mailJobs.push(
          sendCustomerConfirmation(s, payload, cancelUrl).catch((e) => {
            console.error("[EMAIL_FAILED] type=customer_confirmation ref=" + bookingRef, e);
          })
        );
      }
      // Await with allSettled: fire-and-forget sends get killed when a Vercel
      // serverless function returns. Never fail the booking on email flakes.
      if (mailJobs.length > 0) {
        await Promise.allSettled(mailJobs);
      }

      return NextResponse.json({
        success: true,
        bookingRef,
        cancelUrl,
        booking: {
          date: data.date,
          startTime: data.startTime,
          serviceName: service.name,
          staffName,
          name: data.name,
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
    if (msg.includes("Time unavailable")) {
      // Strongest unmet-demand signal: the customer completed the form and
      // lost the race for the last free time. Skip for admin.
      if (!isAdmin) {
        await logDemandSignal({
          bookingDate: data.date,
          serviceId: data.serviceId,
          outcome: "no_capacity",
          source: "booking_attempt",
          ipHash: hashIp(ip),
        });
      }
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
      // Friendly copy, never the raw DB message (it could grow internal detail).
      return NextResponse.json({ error: "That service isn't available." }, { status: 400 });
    }
    if (msg.includes("Invalid time")) {
      return NextResponse.json({ error: "That time isn't available to book online." }, { status: 400 });
    }

    break;
  }

  console.error("Appointment creation error:", lastError);
  return NextResponse.json({ error: "Failed to create appointment" }, { status: 500 });
}

// ─── Admin list ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const dateParam = params.get("date");
  const fromParam = params.get("from");
  const toParam = params.get("to");

  let query = supabaseAdmin()
    .from("biz_appointments")
    .select(
      "id, booking_ref, appointment_date, start_time, end_time, customer_name, customer_phone, customer_email, notes, visit_number, status, cancellation_reason, cancelled_by, created_at, service:service_id(name), staff:staff_id(id, name)"
    );

  if (fromParam || toParam) {
    if (!fromParam || !toParam || !ISO_DATE.test(fromParam) || !ISO_DATE.test(toParam)) {
      return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
    }
    if (fromParam > toParam) {
      return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
    }
    // Bound the span — beyond PostgREST's silent 1000-row cap a huge range
    // would just truncate confusingly anyway.
    if (shiftDateStr(fromParam, 366) < toParam) {
      return NextResponse.json({ error: "Range too large (max 1 year)" }, { status: 400 });
    }
    query = query.gte("appointment_date", fromParam).lte("appointment_date", toParam);
  } else if (dateParam) {
    if (!ISO_DATE.test(dateParam)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    query = query.eq("appointment_date", dateParam);
  } else {
    return NextResponse.json({ error: "date or from+to required" }, { status: 400 });
  }

  const { data, error } = await query
    .order("appointment_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("Appointments query error:", error);
    return NextResponse.json({ error: "Failed to fetch appointments" }, { status: 500 });
  }

  return NextResponse.json({ appointments: data });
}
