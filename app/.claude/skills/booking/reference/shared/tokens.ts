import { randomBytes, randomInt } from "crypto";

/**
 * Reference + cancel-token generation. Installed by the Klaudius booking
 * skill as `src/lib/booking/tokens.ts`. Generic plumbing — do not edit per
 * site.
 */

// Booking ref shown to the customer + used by staff to find a booking.
// 6 characters from an unambiguous alphabet (no 0/O, 1/I/L).
const CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** e.g. generateBookingRef("JB") → "JB-7XK2MQ". Prefix comes from settings. */
export function generateBookingRef(prefix: string): string {
  let ref = "";
  for (let i = 0; i < 6; i++) {
    ref += CHARS[randomInt(0, CHARS.length)];
  }
  return `${prefix}-${ref}`;
}

/**
 * Cancel token embedded in the confirmation email's cancel link. 32 random
 * bytes, base64url — ~43 chars, URL-safe, unguessable. It's a capability:
 * anyone holding the link can cancel that one booking, nothing else.
 */
export function generateCancelToken(): string {
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
