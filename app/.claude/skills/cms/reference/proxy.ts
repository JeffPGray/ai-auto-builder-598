import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth";

/**
 * Gates everything under /admin behind a valid signed session.
 *
 * Installed by the Klaudius cms skill as `src/proxy.ts` (Next.js 16 renamed
 * the "middleware" file convention to "proxy"). On a site running Next.js 15
 * or older, install this file as `src/middleware.ts` instead and rename the
 * exported function to `middleware` — the body is identical.
 *
 * NOTE: this gate protects page ROUTES only. Server actions are public POST
 * endpoints and authorise themselves via requireSession() in lib/actions.ts.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The login page itself must stay reachable without a session.
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  // Everything else under /admin requires a valid signed session.
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const ok = await verifySession(cookie);

  if (!ok) {
    const loginUrl = new URL("/admin/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
