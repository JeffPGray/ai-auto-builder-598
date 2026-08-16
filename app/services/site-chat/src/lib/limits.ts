/**
 * Cost and abuse limits.
 *
 * THE DECISION, stated plainly because it is a spend decision, not a technical one:
 * the chatbot is ENABLED on speculative prospect sites, not gated to converted
 * clients. Reasoning:
 *
 *   - The widget is a third of what justifies the $98/mo. A prospect who opens the
 *     demo and finds the chat bubble inert has been shown the opposite of the pitch.
 *     Hiding the feature from the only person we are trying to sell it to is
 *     self-defeating.
 *   - The real cost is small and measurable. Claude Haiku 4.5 is $1/MTok in and
 *     $5/MTok out. A turn here is roughly 1.2k input (system + KB + trimmed history)
 *     and ~150 output, so about $0.0020 per turn and ~$0.012 for a six-turn
 *     conversation. Note prompt caching does NOT apply: Haiku 4.5's minimum
 *     cacheable prefix is 4096 tokens and our system prompt is well under that, so
 *     a `cache_control` marker would be a no-op. The figures above are uncached.
 *   - Realistic demo traffic is one conversation per site, often zero. 75 builds a
 *     day each having one six-turn conversation is about $0.90/day.
 *
 * What is genuinely dangerous is not normal use, it is a bot finding the endpoint
 * and hammering it. So the answer is a hard cap rather than a gate:
 *
 *   - PER SITE: `CHAT_DAILY_MESSAGE_CAP` messages/day (default 40) for an
 *     unconverted demo. That bounds a single site's worst case at ~$0.08/day.
 *   - CONVERTED CLIENTS: hosts listed in `CHAT_CONVERTED_HOSTS` get
 *     `CHAT_CONVERTED_DAILY_CAP` (default 400/day, comfortably above the 600
 *     conversations/month the package sells).
 *   - PER IP: `CHAT_BURST_PER_IP_PER_MIN` (default 8) so one client cannot burn a
 *     site's whole daily allowance in a few seconds.
 *
 * CROSS-INSTANCE ENFORCEMENT. In-memory Maps are the fast path only. Gray Reserve's
 * `chatbot-architecture` skill names "in-memory Maps for rate limiting in serverless
 * environments" as an explicit anti-pattern, and it is right: every warm instance
 * gets its own Map, so under fan-out the effective cap is (instances x cap). The
 * durable counter below is a Postgres upsert against Supabase — already this
 * pipeline's state store, so no new vendor and no new dependency (plain `fetch`
 * against PostgREST).
 *
 * It is OPT-IN, and deliberately so: this service must not silently create tables in
 * anyone's database. Set CHAT_USAGE_TABLE (plus SUPABASE_URL and
 * SUPABASE_SERVICE_KEY) after creating the table, and the durable path activates:
 *
 *   create table site_chat_usage (
 *     day date not null,
 *     origin text not null,
 *     count integer not null default 0,
 *     primary key (day, origin)
 *   );
 *   create or replace function bump_site_chat_usage(p_origin text, p_cap int)
 *   returns int language plpgsql as $$
 *   declare n int;
 *   begin
 *     insert into site_chat_usage (day, origin, count)
 *     values (current_date, p_origin, 1)
 *     on conflict (day, origin) do update set count = site_chat_usage.count + 1
 *     returning count into n;
 *     return n;
 *   end $$;
 *
 * The bump is a single atomic statement, so two concurrent instances cannot both
 * read-then-write past the cap. Until the table exists the service runs on the
 * in-memory path and `/api/health` reports `durableLimits: false`, so the weaker
 * mode is visible rather than assumed.
 */

type Window = { count: number; resetAt: number };

const perSite = new Map<string, Window>();
const perIp = new Map<string, Window>();

const num = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

function convertedHosts(): string[] {
  return (process.env.CHAT_CONVERTED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isConverted(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return convertedHosts().some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}

function hit(map: Map<string, Window>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const w = map.get(key);
  if (!w || now >= w.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (w.count >= limit) return { ok: false, remaining: 0, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
  w.count += 1;
  return { ok: true, remaining: limit - w.count };
}

export type LimitVerdict =
  | { ok: true; converted: boolean }
  | { ok: false; reason: "site_daily_cap" | "ip_burst"; retryAfter: number };

export function checkLimits(origin: string, ip: string): LimitVerdict {
  // Opportunistic sweep so the maps cannot grow unbounded on a long-lived instance.
  if (perSite.size > 5000 || perIp.size > 20000) {
    const now = Date.now();
    for (const [k, w] of perSite) if (now >= w.resetAt) perSite.delete(k);
    for (const [k, w] of perIp) if (now >= w.resetAt) perIp.delete(k);
  }

  const burst = hit(perIp, `${origin}|${ip}`, num("CHAT_BURST_PER_IP_PER_MIN", 8), 60_000);
  if (!burst.ok) return { ok: false, reason: "ip_burst", retryAfter: burst.retryAfter ?? 60 };

  const converted = isConverted(origin);
  const cap = converted
    ? num("CHAT_CONVERTED_DAILY_CAP", 400)
    : num("CHAT_DAILY_MESSAGE_CAP", 40);
  const daily = hit(perSite, origin, cap, 24 * 60 * 60 * 1000);
  if (!daily.ok) return { ok: false, reason: "site_daily_cap", retryAfter: daily.retryAfter ?? 3600 };

  return { ok: true, converted };
}

/** True when the durable, cross-instance counter is configured. Reported by /api/health. */
export function durableLimitsConfigured(): boolean {
  return Boolean(
    process.env.CHAT_USAGE_TABLE && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY,
  );
}

/**
 * Durable per-site daily counter. Returns the post-increment count, or `null` when
 * the durable path is not configured or the call fails.
 *
 * FAILS OPEN, ON PURPOSE. If Supabase is unreachable, the in-memory verdict that
 * already ran stands and the conversation continues. A visitor who is mid-sentence
 * with a business should not be cut off because a counter table was briefly
 * unavailable; the in-memory cap still bounds the blast radius.
 */
export async function bumpDurable(origin: string, cap: number): Promise<number | null> {
  if (!durableLimitsConfigured()) return null;
  const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/bump_${process.env.CHAT_USAGE_TABLE}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_KEY as string,
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_origin: origin, p_cap: cap }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) {
      console.error("[site-chat] durable limit bump failed", r.status, await r.text());
      return null;
    }
    const n = await r.json();
    return typeof n === "number" ? n : null;
  } catch (e) {
    console.error("[site-chat] durable limit bump unreachable", e);
    return null;
  }
}

/** The daily cap that applies to this origin. */
export function dailyCapFor(origin: string): number {
  return isConverted(origin)
    ? num("CHAT_CONVERTED_DAILY_CAP", 400)
    : num("CHAT_DAILY_MESSAGE_CAP", 40);
}

/** Test seam — the contract tests reset counters between cases. */
export function __resetLimits() {
  perSite.clear();
  perIp.clear();
}
