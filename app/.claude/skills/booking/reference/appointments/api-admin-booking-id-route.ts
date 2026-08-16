import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { getSettings } from "@/lib/booking/settings";
import { isAdminAuthenticated } from "@/lib/booking/admin-session";
import {
  sendCustomerCancellation,
  sendOwnerCancellation,
  type EmailAppointment,
} from "@/lib/booking/emails";

/**
 * PATCH /api/booking/admin/[id] — staff-side cancel from the dashboard.
 * Installed by the Klaudius booking skill as
 * `src/app/api/booking/admin/[id]/route.ts` (appointments variant).
 * Generic plumbing — do not edit per site.
 *
 * Body: { action: "cancel", reason?: string }. No cutoff applies — staff can
 * always cancel. Same conditional-update race guard as the customer path.
 */

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid appointment id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action =
    body && typeof body === "object" && "action" in body ? (body as { action: unknown }).action : null;
  if (action !== "cancel") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  const reason =
    body && typeof body === "object" && "reason" in body && typeof (body as { reason: unknown }).reason === "string"
      ? (body as { reason: string }).reason.trim().slice(0, 300)
      : "";

  const { data: rawExisting, error: fetchErr } = await supabaseAdmin()
    .from("biz_appointments")
    .select(
      "id, booking_ref, appointment_date, start_time, customer_name, customer_phone, customer_email, notes, status, service:service_id(name), staff:staff_id(name)"
    )
    .eq("id", id)
    .maybeSingle();
  const existing = rawExisting as unknown as ApptRow | null;

  if (fetchErr) {
    console.error("Admin cancel lookup error:", fetchErr);
    return NextResponse.json({ error: "Failed to look up appointment" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }
  if (existing.status === "cancelled") {
    return NextResponse.json({ success: true, alreadyCancelled: true });
  }

  const { data: updatedRows, error: updateErr } = await supabaseAdmin()
    .from("biz_appointments")
    .update({ status: "cancelled", cancelled_by: "business", cancellation_reason: reason || null })
    .eq("id", id)
    .eq("status", "confirmed")
    .select("id");

  if (updateErr) {
    console.error("Admin cancel update error:", updateErr);
    return NextResponse.json({ error: "Failed to cancel appointment" }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ success: true, alreadyCancelled: true });
  }

  const s = await getSettings();
  const payload: EmailAppointment = {
    bookingRef: existing.booking_ref,
    date: existing.appointment_date,
    startTime: existing.start_time.slice(0, 5),
    serviceName: existing.service?.name ?? "",
    staffName: existing.staff?.name ?? "",
    customerName: existing.customer_name,
    customerPhone: existing.customer_phone,
    customerEmail: existing.customer_email,
    notes: existing.notes ?? "",
  };

  const mailJobs: Promise<unknown>[] = [
    // Owner always gets the written record — even for their own cancels.
    sendOwnerCancellation(s, payload, "business", reason).catch((err) => {
      console.error("[EMAIL_FAILED] type=owner_cancellation ref=" + existing.booking_ref, err);
    }),
  ];
  if (existing.customer_email.trim()) {
    mailJobs.push(
      sendCustomerCancellation(s, payload, "business").catch((err) => {
        console.error("[EMAIL_FAILED] type=customer_cancellation ref=" + existing.booking_ref, err);
      })
    );
  }
  await Promise.allSettled(mailJobs);

  return NextResponse.json({ success: true });
}
