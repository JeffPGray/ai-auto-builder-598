import { getSettings } from "@/lib/booking/settings";
import { maxBookableDateStr, todayInTz } from "@/lib/booking/dates";
import BookingForm from "./BookingForm";

/**
 * The /book page (slot-capacity variant). Installed by the Klaudius booking
 * skill as `src/app/book/page.tsx`.
 *
 * booking-restyle: give this page the site's header/nav/footer and design
 * system so it feels native, and write the heading/intro copy for this
 * business. Keep the server-side config computation and force-dynamic —
 * settings changes (hours, capacity, cutoff) must show up without a redeploy.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  // booking-generate: "Book — {Business Name}"
  title: "Book",
};

// Localized weekday names for the business's open days, computed once on the
// server (2023-01-01 was a Sunday; day n of that week has weekday n).
function openDayLabels(serviceDays: number[], locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return [...serviceDays]
    .sort((a, b) => a - b)
    .map((d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d))));
}

export default async function BookPage() {
  const s = await getSettings();
  const cfg = {
    businessName: s.businessName,
    businessPhone: s.businessPhone,
    locale: s.locale,
    slotTimes: s.slotTimes,
    minParty: s.minParty,
    maxParty: s.maxParty,
    todayStr: todayInTz(s.timezone),
    maxDateStr: maxBookableDateStr(s.advanceDays, s.timezone),
    cutoffHours: s.cutoffHours,
    openDayLabels: openDayLabels(s.serviceDays, s.locale),
  };

  return (
    <main className="mx-auto max-w-xl px-5 py-14">
      <h1 className="text-3xl font-bold text-neutral-900">Book with {s.businessName}</h1>
      <p className="mt-2 mb-8 text-neutral-600">
        Choose a date and time — you'll get an instant email confirmation.
      </p>
      <BookingForm cfg={cfg} />
      {s.businessPhone && (
        <p className="mt-6 text-center text-sm text-neutral-500">
          Prefer to talk to us? Call{" "}
          <a href={`tel:${s.businessPhone.replace(/\s+/g, "")}`} className="font-semibold">
            {s.businessPhone}
          </a>
          .
        </p>
      )}
    </main>
  );
}
