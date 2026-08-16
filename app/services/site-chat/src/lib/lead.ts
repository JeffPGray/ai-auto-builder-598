/**
 * Lead delivery.
 *
 * A captured lead never blocks the conversation: every path here swallows its own
 * errors and reports success/failure back to the caller as a boolean. A delivery
 * hiccup must not turn into "Sorry, I had trouble there" for a visitor who just
 * handed over their phone number.
 *
 * Two sinks, both optional, both already configured on this install:
 *   - Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) — same pair scripts/notify.sh
 *     already uses, so the operator gets the lead where they already look.
 *   - A generic webhook (CHAT_LEAD_WEBHOOK_URL) — the seam for GoHighLevel. The
 *     The GHL mirror is Python and cannot run inside this service, so the
 *     service posts JSON and the mirror side owns CRM shape.
 *
 * Note the deliberate omission: this service does NOT send email to the business
 * owner. OUTREACH_ENABLED=false is an evaluation-wide rule and a chat endpoint that
 * emails a real business is exactly the thing that rule exists to prevent.
 */

export type Lead = {
  site: string;
  business: string;
  name: string;
  phone?: string;
  email?: string;
  summary?: string;
};

async function toTelegram(lead: Lead): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const text = [
    `New chat lead on ${lead.business}`,
    lead.site,
    "",
    `Name: ${lead.name}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.summary ? `Wants: ${lead.summary}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function toWebhook(lead: Lead): Promise<boolean> {
  const url = process.env.CHAT_LEAD_WEBHOOK_URL;
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.CHAT_LEAD_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.CHAT_LEAD_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ source: "site-chat", ...lead }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deliverLead(lead: Lead): Promise<boolean> {
  const results = await Promise.all([toTelegram(lead), toWebhook(lead)]);
  const delivered = results.some(Boolean);
  if (!delivered) {
    // Last resort: the platform log. A lead in a log beats a lead nowhere.
    console.error("[site-chat] lead captured but NOT delivered anywhere", JSON.stringify(lead));
  }
  return delivered;
}
