"use server";

/**
 * Minimal /admin login + logout server actions. Installed by the Klaudius
 * booking skill as `src/lib/actions.ts` ONLY when the site does not already
 * have one (i.e. the cms skill isn't installed). If /cms is added later, its
 * own actions.ts replaces this file — that's safe by design: the cms version
 * contains identical loginAction/logoutAction signatures plus its content
 * actions, and both share the same cookie via src/lib/auth.ts.
 *
 * Owner-facing strings: error messages RETURNED as values reach the owner
 * verbatim — write them in the operator's language if it isn't English.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  isValidPassword,
  signSession,
  sessionCookieOptions,
} from "./auth";

function readString(form: FormData, key: string, fallback = ""): string {
  const v = form.get(key);
  return typeof v === "string" ? v : fallback;
}

export async function loginAction(
  _prev: unknown,
  form: FormData
): Promise<{ error?: string }> {
  const password = readString(form, "password");
  if (!password) return { error: "Enter the password to continue." };

  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return { error: "The dashboard isn't set up yet — contact your website provider." };
  }

  if (!isValidPassword(password)) {
    // Cheap brute-force throttle: make every failed attempt cost ~1.5s.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { error: "Wrong password." };
  }

  let token: string;
  try {
    token = await signSession();
  } catch {
    return { error: "The dashboard isn't set up yet — contact your website provider." };
  }
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  redirect("/admin/bookings");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
  redirect("/admin/login");
}
