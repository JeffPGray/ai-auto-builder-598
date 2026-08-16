import Anthropic from "@anthropic-ai/sdk";
import {
  KbError,
  assembleSystem,
  assertAllowedOrigin,
  fallbackLine,
  loadKb,
  type SiteKb,
} from "@/lib/kb";
import { bumpDurable, checkLimits, dailyCapFor } from "@/lib/limits";
import { deliverLead } from "@/lib/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MODEL CHOICE — deliberate, not a downgrade-for-cost reflex.
 *
 * `claude-haiku-4-5` ($1/MTok in, $5/MTok out) is the right tier for a
 * three-sentence answer drawn from a KB that is already in the prompt: there is no
 * hard reasoning to do, latency is user-visible in a chat bubble, and the same
 * choice is already proven in Gray Reserve's own Next.js chat route. It is
 * overridable with CHAT_MODEL for a converted client who wants a stronger model.
 *
 * `thinking` is deliberately omitted: Haiku 4.5 runs without thinking when the
 * parameter is absent, which is what a chat widget wants.
 *
 * Prompt caching is deliberately NOT used: Haiku 4.5's minimum cacheable prefix is
 * 4096 tokens and this system prompt is around 1.2k, so a cache_control marker
 * would silently do nothing while implying a saving that is not there.
 */
const MODEL = process.env.CHAT_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = 400;

const CAPTURE_TOOL: Anthropic.Tool = {
  name: "capture_lead",
  description:
    "Save a sales lead once you have the visitor's name AND a phone number or email. " +
    "Call it the moment you have both. Do not announce it to the visitor.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Visitor's first and/or last name." },
      phone: { type: "string", description: "Phone number, if given." },
      email: { type: "string", description: "Email address, if given." },
      summary: { type: "string", description: "One line: what the visitor needs." },
    },
    required: ["name"],
  },
};

function corsHeaders(origin: string | null): Record<string, string> {
  // Echo the caller's origin only when it passes the same allowlist the KB fetch
  // uses. A wildcard would let any page on the internet spend our credit.
  let allow = "";
  if (origin) {
    try {
      allow = assertAllowedOrigin(origin);
    } catch {
      allow = "";
    }
  }
  return {
    "access-control-allow-origin": allow || "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

const textOf = (content: Anthropic.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    Response.json(body, { status, headers: { ...cors, ...extra } });

  let body: { site?: string; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  // 1. Origin. The browser-supplied `site` is verified against the allowlist before
  //    anything else happens, and the KB is fetched from it server-side.
  let origin: string;
  try {
    origin = assertAllowedOrigin(String(body.site || req.headers.get("origin") || ""));
  } catch (e) {
    return json({ error: e instanceof KbError ? e.message : "bad site" }, 403);
  }

  // 2. Shape.
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: Anthropic.MessageParam[] = raw
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        !!m &&
        typeof m === "object" &&
        ((m as any).role === "user" || (m as any).role === "assistant") &&
        typeof (m as any).content === "string",
    )
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (messages.length === 0) return json({ error: "no messages" }, 400);
  if (messages[messages.length - 1].role !== "user") return json({ error: "last message must be from the visitor" }, 400);

  // 3. Cost gate BEFORE the KB fetch and before the model call.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const verdict = checkLimits(origin, ip);

  // Cross-instance cap. The in-memory check above is only the fast path — every warm
  // serverless instance has its own Map, so on its own the effective cap is
  // (instances x cap). This second check is a single atomic Postgres upsert, so
  // concurrent instances cannot both read-then-write past the limit. It is a no-op
  // until CHAT_USAGE_TABLE is configured, and it fails open if Supabase is
  // unreachable — the in-memory verdict still bounds the damage.
  if (verdict.ok) {
    const cap = dailyCapFor(origin);
    const used = await bumpDurable(origin, cap);
    if (used !== null && used > cap) {
      const kbMaybe = await loadKb(origin).catch(() => null);
      return json(
        {
          reply: kbMaybe?.phoneDisplay
            ? `Chat is busy right now. Please call ${kbMaybe.phoneDisplay} and someone will help you straight away.`
            : "Chat is busy right now. Please use the contact form and someone will get back to you.",
          limited: "site_daily_cap",
        },
        200,
        { "retry-after": "3600" },
      );
    }
  }

  if (!verdict.ok) {
    const kbMaybe = await loadKb(origin).catch(() => null);
    const phone = kbMaybe?.phoneDisplay;
    return json(
      {
        reply: phone
          ? `Chat is busy right now. Please call ${phone} and someone will help you straight away.`
          : "Chat is busy right now. Please use the contact form and someone will get back to you.",
        limited: verdict.reason,
      },
      200,
      { "retry-after": String(verdict.retryAfter) },
    );
  }

  // 4. Key. Checked BEFORE the KB fetch, and reported with its OWN error code.
  //    Two different misconfigurations used to return the same `unconfigured`
  //    string, so an operator reading a failing response could not tell "no API
  //    key" from "this site never emitted chat-kb.json" — which is the same class
  //    of invisibility that killed the Gray Reserve chatbot. `/api/health`
  //    reports `keyConfigured`; this makes the chat path agree with it.
  //    The KB is still loaded best-effort so the visitor gets the phone number
  //    rather than a generic line, but a failure there cannot mask this one.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[site-chat] ANTHROPIC_API_KEY is not set");
    const kbMaybe = await loadKb(origin).catch(() => null);
    return json({ reply: fallbackLine(kbMaybe), error: "key_not_configured" }, 200);
  }

  // 5. KB + system prompt. Both throw loudly rather than degrading.
  let kb: SiteKb | null = null;
  let system: string;
  try {
    kb = await loadKb(origin);
    system = assembleSystem(kb);
  } catch (e) {
    console.error("[site-chat] KB/system failure for", origin, e);
    return json({ reply: fallbackLine(kb), error: "kb_unavailable" }, 200);
  }

  const client = new Anthropic({
    apiKey: key,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    maxRetries: 1,
    timeout: 25_000,
  });

  try {
    const first = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [CAPTURE_TOOL],
      messages,
    });

    const tool = first.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "capture_lead",
    );

    if (!tool) {
      const reply =
        textOf(first.content) ||
        `Tell me a bit about what you need and I can point you in the right direction.`;
      return json({ reply });
    }

    const input = (tool.input || {}) as Record<string, unknown>;
    const delivered = await deliverLead({
      site: origin,
      business: kb.name,
      name: String(input.name || "").slice(0, 200) || "(chat visitor)",
      phone: String(input.phone || "").slice(0, 40) || undefined,
      email: String(input.email || "").slice(0, 200) || undefined,
      summary: String(input.summary || "").slice(0, 1000) || undefined,
    });

    // Continue the turn so the visitor gets a natural confirmation rather than
    // a conversation that just stops after they hand over their number.
    const second = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [CAPTURE_TOOL],
      messages: [
        ...messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: tool.id,
              content: delivered
                ? "Lead saved. Warmly confirm the team will be in touch shortly, then keep helping."
                : "Lead noted. Warmly confirm the team will be in touch shortly, then keep helping.",
            },
          ],
        },
      ],
    });

    const reply =
      textOf(second.content) ||
      `Got it. Someone from ${kb.name} will be in touch shortly. Anything else I can help with?`;
    return json({ reply, leadCaptured: true });
  } catch (e) {
    // Log the real cause. The July 2026 Gray Reserve outage was invisible precisely
    // because the catch returned a bare 200 and nothing recorded why.
    console.error("[site-chat] model call failed for", origin, e);
    return json({ reply: fallbackLine(kb) }, 200);
  }
}
