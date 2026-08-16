import { getSettings } from "@/lib/booking/settings";
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
 * The /book/cancel/[token] page (slot-capacity variant) — where the "change
 * or cancel" link in confirmation emails lands: pick a new time
 * (RescheduleForm) or cancel (CancelConfirm). Installed by the Klaudius
 * booking skill as `src/app/book/cancel/[token]/page.tsx`.
 *
 * booking-restyle: match the site's design system; keep the four states and
 * the server-side cutoff check (the API re-enforces it regardless).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Manage booking",
  robots: { index: false, follow: false },
};

// Localized weekday names for the business's open days (2023-01-01 was a
// Sunday; day n of that week has weekday n).
function openDayLabels(serviceDays: number[], locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return [...serviceDays]
    .sort((a, b) => a - b)
    .map((d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d))));
}

interface BookingRow {
  booking_ref: string;
  booking_date: string;
  slot_time: string;
  party_size: number;
  customer_name: string;
  status: string;
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

  const { data: booking } = await supabaseAdmin()
    .from("biz_bookings")
    .select("booking_ref, booking_date, slot_time, party_size, customer_name, status")
    .eq("cancel_token", token)
    .maybeSingle<BookingRow>();

  if (!booking) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Booking not found</h1>
        <p className="mt-2 text-neutral-600">
          We couldn't find a booking for this link. It may have been removed.
        </p>
      </Shell>
    );
  }

  const s = await getSettings();
  const longDate = formatLongDate(booking.booking_date, s.locale);
  const timeLabel = formatTimeLabel(booking.slot_time, s.locale);
  const summary = `${longDate}, ${timeLabel} · ${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`;

  if (booking.status === "cancelled") {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Already cancelled</h1>
        <p className="mt-2 text-neutral-600">
          Booking <strong>{booking.booking_ref}</strong> ({summary}) has already been cancelled.
        </p>
      </Shell>
    );
  }

  if (isCutoffPassed(booking.booking_date, booking.slot_time, s.cutoffHours, s.timezone)) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-neutral-900">Online cancellation closed</h1>
        <p className="mt-2 text-neutral-600">
          Online cancellation closes {s.cutoffHours} hours before your booking.
          {s.businessPhone ? (
            <>
              {" "}
              If you can't make it, please call us on{" "}
              <a href={`tel:${s.businessPhone.replace(/\s+/g, "")}`} className="font-semibold">
                {s.businessPhone}
              </a>{" "}
              so we can offer your place to someone else.
            </>
          ) : (
            " Please contact us directly if you can't make it."
          )}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-neutral-900">Your booking</h1>
      <p className="mt-2 text-neutral-600">
        {booking.customer_name}, here's booking <strong>{booking.booking_ref}</strong>:
      </p>
      <p className="mt-3 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">{summary}</p>
      <RescheduleForm
        cfg={{
          token,
          partySize: booking.party_size,
          todayStr: todayInTz(s.timezone),
          maxDateStr: maxBookableDateStr(s.advanceDays, s.timezone),
          locale: s.locale,
          businessPhone: s.businessPhone,
          openDayLabels: openDayLabels(s.serviceDays, s.locale),
        }}
      />
      <div className="mt-6 border-t border-neutral-200 pt-5">
        <p className="text-sm text-neutral-600">Can't make it at all?</p>
        <CancelConfirm token={token} />
      </div>
    </Shell>
  );
}
