/**
 * Edge-compatible auth helpers for the /admin CMS. Uses the Web Crypto API so
 * the same code runs in both Node.js (server actions) and the Edge runtime
 * (the proxy/middleware gate).
 *
 * Two env vars must be set on the Vercel project for the admin to work:
 *   ADMIN_PASSWORD  — the password the site owner types to sign in
 *   SESSION_SECRET  — a random string, at least 32 chars, used to sign the cookie
 *
 * Installed by the Klaudius cms skill. Generic plumbing — do not edit per site.
 */

export const SESSION_COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getAdminPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return pw;
}

function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison. Returns true iff a and b are byte-identical.
 * Implemented in JS to stay Edge-compatible.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Constant-time password comparison. Returns false (not throw) if ADMIN_PASSWORD
 * is missing — keeps the admin inaccessible without crashing requests.
 */
export function isValidPassword(input: string): boolean {
  const expected = getAdminPassword();
  if (!expected) return false;
  return constantTimeEqual(input, expected);
}

/**
 * Issue a signed session token. Throws if SESSION_SECRET is missing — this is
 * called from server actions, which can surface the error meaningfully (unlike
 * middleware).
 */
export async function signSession(): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET env var must be set and at least 32 chars");
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const key = await importHmacKey(secret);
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(expiry))
  );
  return `${expiry}.${bufferToHex(sigBuf)}`;
}

/**
 * Verify a session token. Returns true iff the HMAC is valid AND the expiry
 * hasn't passed. Returns false (never throws) on any error — this runs in the
 * proxy/middleware gate on every request, so a thrown error would 500 the user.
 */
export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiryStr, hmacFromCookie] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry)) return false;
  if (expiry < Math.floor(Date.now() / 1000)) return false;

  const secret = getSessionSecret();
  if (!secret) return false;

  try {
    const key = await importHmacKey(secret);
    const sigBuf = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(expiryStr)
    );
    const expectedHex = bufferToHex(sigBuf);
    return constantTimeEqual(hmacFromCookie, expectedHex);
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
