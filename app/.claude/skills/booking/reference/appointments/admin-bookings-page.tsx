import { getCatalog, getSettings } from "@/lib/booking/settings";
import { todayInTz } from "@/lib/booking/dates";
import BookingsDashboard from "./BookingsDashboard";

/**
 * The /admin/bookings page (appointments variant) — staff-facing dashboard.
 * Installed by the Klaudius booking skill as
 * `src/app/admin/bookings/page.tsx`. Route protection comes from the /admin
 * proxy gate (src/proxy.ts); every data call the dashboard makes hits the
 * admin API routes, which verify the session themselves.
 *
 * The dashboard keeps the neutral monochrome admin skin — it's a staff tool,
 * not the brand site. Owner-facing strings must be in the operator's
 * language if it isn't English.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  // booking-generate: "Bookings — {Business Name}"
  title: "Bookings",
  robots: { index: false, follow: false },
};

export default async function AdminBookingsPage() {
  const s = await getSettings();
  const { services, staff } = await getCatalog();
  return (
    <BookingsDashboard
      cfg={{
        businessName: s.businessName,
        locale: s.locale,
        services: services.map((sv) => ({
          id: sv.id,
          name: sv.name,
          durationMinutes: sv.durationMinutes,
        })),
        staff,
        todayStr: todayInTz(s.timezone),
      }}
    />
  );
}
