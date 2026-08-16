import { getCatalog, getSettings } from "@/lib/booking/settings";
import { supabaseAdmin } from "@/lib/booking/supabase";
import {
  formatLongDate,
  formatTimeLabel,
  isCutoffPassed,
  maxBookableDateStr,
  todayInTz,
} from "@/lib/booking/dates";
import CancelConfirm from "./CancelConfirm";
import RescheduleForm from "./RescheduleForm";

/**
 * The /book/cancel/[token] page (appointments variant) — where the "change or
 * cancel" link in confirmation emails lands: pick a new time (RescheduleForm)
 * or cancel (CancelConfirm). Installed by the Klaudius booking skill as
 * `src/app/book/cancel/[token]/page.tsx`.
 *
 * booking-restyle: match the site's design system; keep the four states and
 * the server-side cutoff check (the API re-enforces it regardless).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Manage appointment",
  robots: { index: false, follow: false },
};

interface ApptRow {
  booking_ref: string;
  appointment_date: string;
  start_time: string;
  customer_name: string;
  status: string;
  service_id: string;
  staff_id: string;
  service: { name: string } | null;
  staff: { name: string } | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-xl border border-neutral-200 bg-white p-8">{children}</div>
    </main>
  );
}

export default async function CancelPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.length < 16 || token.length > 128) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Invalid link</h1>
        <p className="mt-2 text-neutral-600">
          This cancellation link isn't valid. Please use the link from your confirmation email.
        </p>
      </Shell>
    );
  }

  const { data: raw } = await supabaseAdmin()
    .from("biz_appointments")
    .select(
      "booking_ref, appointment_date, start_time, customer_name, status, service_id, staff_id, service:service_id(name), staff:staff_id(name)"
    )
    .eq("cancel_token", token)
    .maybeSingle();
  const appt = raw as unknown as ApptRow | null;

  if (!appt) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Appointment not found</h1>
        <p className="mt-2 text-neutral-600">
          We couldn't find an appointment for this link. It may have been removed.
        </p>
      </Shell>
    );
  }

  const s = await getSettings();
  const startHHMM = appt.start_time.slice(0, 5);
  const longDate = formatLongDate(appt.appointment_date, s.locale);
  const timeLabel = formatTimeLabel(startHHMM, s.locale);
  const summary = `${appt.service?.name ?? ""}${appt.staff?.name ? ` with ${appt.staff.name}` : ""} · ${longDate}, ${timeLabel}`;

  if (appt.status === "cancelled") {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Already cancelled</h1>
        <p className="mt-2 text-neutral-600">
          Appointment <strong>{appt.booking_ref}</strong> ({summary}) has already been cancelled.
        </p>
      </Shell>
    );
  }

  if (isCutoffPassed(appt.appointment_date, startHHMM, s.cutoffHours, s.timezone)) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Online cancellation closed</h1>
        <p className="mt-2 text-neutral-600">
          Online cancellation closes {s.cutoffHours} hours before your appointment.
          {s.businessPhone ? (
            <>
              {" "}
              If you can't make it, please call us on{" "}
              <a href={`tel:${s.businessPhone.replace(/\s+/g, "")}`} className="font-semibold">
                {s.businessPhone}
              </a>{" "}
              so we can offer your time to someone else.
            </>
          ) : (
            " Please contact us directly if you can't make it."
          )}
        </p>
      </Shell>
    );
  }

  // Reschedule needs the service to still be bookable online; if it was
  // deactivated, fall back to cancel-only.
  const { services } = await getCatalog();
  const service = services.find((sv) => sv.id === appt.service_id);

  return (
    <Shell>
      <h1 className="text-xl font-bold text-neutral-900">Your appointment</h1>
      <p className="mt-2 text-neutral-600">
        {appt.customer_name}, here's appointment <strong>{appt.booking_ref}</strong>:
      </p>
      <p className="mt-3 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">{summary}</p>
      {service ? (
        <RescheduleForm
          cfg={{
            token,
            serviceId: appt.service_id,
            serviceName: service.name,
            staffChoices: service.staff,
            currentStaffId: appt.staff_id,
            todayStr: todayInTz(s.timezone),
            maxDateStr: maxBookableDateStr(s.advanceDays, s.timezone),
            locale: s.locale,
            businessPhone: s.businessPhone,
          }}
        />
      ) : (
        // Service no longer bookable online — reschedule needs a phone call.
        <p className="mt-6 text-sm text-neutral-500">
          To change the time, please call us
          {s.businessPhone ? ` on ${s.businessPhone}` : ""}.
        </p>
      )}
      <div className="mt-6 border-t border-neutral-200 pt-5">
        <p className="text-sm text-neutral-600">Can't make it at all?</p>
        <CancelConfirm token={token} />
      </div>
    </Shell>
  );
}
