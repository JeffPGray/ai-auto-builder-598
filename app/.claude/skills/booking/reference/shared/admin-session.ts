import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth";

/**
 * Session check for the booking admin API routes. Installed by the Klaudius
 * booking skill as `src/lib/booking/admin-session.ts`. Generic plumbing — do
 * not edit per site.
 *
 * Uses the same signed cookie as the CMS skill's /admin (src/lib/auth.ts), so
 * one owner password unlocks both the site editor and the bookings dashboard
 * when a site has both skills installed.
 */
export async function isAdminAuthenticated(): Promise<boolean> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return verifySession(cookie);
}
