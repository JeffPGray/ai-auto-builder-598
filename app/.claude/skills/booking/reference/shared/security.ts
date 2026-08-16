/**
 * Request-hardening helpers for the public booking endpoints: in-memory rate
 * limiting, trusted client-IP extraction, a strict Origin check, and the
 * honeypot rule. Installed by the Klaudius booking skill as
 * `src/lib/booking/security.ts`. Generic plumbing — do not edit per site.
 */

// ─── Rate limiting ──────────────────────────────────────────────────────────
// In-memory, per serverless instance only — fine for small-business traffic
// levels. If a site ever sees real load, upgrade to Redis/KV.

type Entry = { count: number; resetAt: number };
const stores = new Map<string, Map<string, Entry>>();
// Bound each namespace map so runaway unique keys can't OOM the lambda.
const MAX_ENTRIES_PER_NS = 10_000;

function getStore(namespace: string): Map<string, Entry> {
  let s = stores.get(namespace);
  if (!s) {
    s = new Map();
    stores.set(namespace, s);
  }
  return s;
}

function prune(store: Map<string, Entry>, now: number) {
  store.forEach((v, k) => {
    if (v.resetAt < now) store.delete(k);
  });
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window rate limit. `namespace` groups related endpoints (e.g.
 * "booking-create"), `key` is usually the client IP.
 */
export function rateLimit(
  namespace: string,
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const store = getStore(namespace);
  const now = Date.now();

  // Occasional prune to stop slow memory growth.
  if (store.size > 0 && Math.random() < 0.01) prune(store, now);
  // Hard cap on entries: at the ceiling, prune expired entries, and if the
  // map is STILL full (a flood of unique keys inside one window), fail
  // closed for new keys rather than growing without bound.
  if (store.size >= MAX_ENTRIES_PER_NS) {
    prune(store, now);
    if (store.size >= MAX_ENTRIES_PER_NS && !store.has(key)) {
      return { allowed: false, remaining: 0, resetAt: now + windowMs };
    }
  }

  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

export function clientIp(headers: Headers): string {
  // Prefer Vercel's own header when present (it can't be spoofed by the client).
  const vercelIp = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelIp) return vercelIp.split(",").pop()?.trim() || "unknown";

  // Fallback: take the LAST entry from x-forwarded-for — that's the IP the
  // edge appended. An attacker can prepend fake values but can't overwrite
  // the rightmost entry added by the trusted reverse proxy.
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()?.trim() || "unknown";

  return headers.get("x-real-ip")?.trim() || "unknown";
}

// ─── Origin check ───────────────────────────────────────────────────────────

/**
 * Strict origin check for CSRF-relevant methods (POST/PATCH/DELETE). Returns
 * true only when the request came from an allowed host. Modern browsers send
 * the Origin header on every state-changing fetch (even same-origin), so a
 * missing Origin means curl/bot — not a real customer submission, and safe to
 * reject. A legitimate non-browser caller should authenticate with a bearer
 * token instead (see the cron route).
 */
export function isAllowedOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return false;
  if (!host) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  const reqHost = host.split(":")[0].toLowerCase();

  // Same-host only. Every legitimate flow — custom domain, *.vercel.app
  // alias, preview deploy — serves the form from the same host it posts to,
  // so exact equality covers them all. A shared-suffix wildcard (any
  // *.vercel.app trusted by any other) would let an attacker's Vercel page
  // drive visitors' browsers at this API; don't add one.
  if (originHost === reqHost) return true;

  // Local dev — only when the request itself is being served locally.
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (local.has(originHost) && local.has(reqHost)) return true;

  return false;
}

// ─── Honeypot ───────────────────────────────────────────────────────────────

/**
 * The hidden "website" field must be present AND empty. Real browser
 * submissions always include it as an empty string; bots that don't render
 * the form omit it, and bots that scrape-and-resubmit fill it in. Both fail.
 */
export function honeypotOk(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    "website" in body &&
    typeof (body as { website: unknown }).website === "string" &&
    (body as { website: string }).website.length === 0
  );
}
