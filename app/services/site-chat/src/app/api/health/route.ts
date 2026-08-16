import { allowedHostSuffixes } from "@/lib/kb";
import { durableLimitsConfigured } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness AND configuration check.
 *
 * `keyConfigured` is the field that matters. The Gray Reserve chatbot spent weeks
 * dead on production while answering HTTP 200, because nothing anywhere reported
 * whether the thing could actually reach the model. This endpoint says so out loud.
 */
export async function GET() {
  return Response.json({
    ok: true,
    // Neutral on purpose. This body is served to anyone who hits /api/health from a prospect
    // site, so naming the build tooling here discloses the vendor to the exact audience the
    // pipeline exists to impress. The Vercel PROJECT keeps its internal name; only what travels
    // over the wire is neutralised.
    service: "site-chat",
    model: process.env.CHAT_MODEL || "claude-haiku-4-5",
    keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    allowedHostSuffixes: allowedHostSuffixes(),
    leadSinks: {
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      webhook: Boolean(process.env.CHAT_LEAD_WEBHOOK_URL),
    },
    // false = in-memory only, i.e. the cap is really (instances x cap) under
    // serverless fan-out. Surfaced so the weaker mode is never assumed away.
    durableLimits: durableLimitsConfigured(),
    caps: {
      perSitePerDay: Number(process.env.CHAT_DAILY_MESSAGE_CAP || 40),
      convertedPerDay: Number(process.env.CHAT_CONVERTED_DAILY_CAP || 400),
      perIpPerMinute: Number(process.env.CHAT_BURST_PER_IP_PER_MIN || 8),
    },
  });
}
