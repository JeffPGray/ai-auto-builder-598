/**
 * Knowledge-base loader.
 *
 * The KB is NOT sent by the browser. If it were, anyone could POST an arbitrary
 * system prompt and spend our Anthropic credit on whatever they liked. Instead the
 * client sends only its own origin; this module fetches `<origin>/chat-kb.json`
 * server-side, after the origin has been checked against the allowlist.
 *
 * That also kills the drift failure that killed the Gray Reserve chatbot in July
 * 2026: there, the KB lived in a separate repo path that was never bundled into the
 * serverless function, so `kb` was always null, the system prompt assembled to the
 * empty string, and every single message threw and returned the phone-number
 * fallback at HTTP 200 — invisible to every monitor. Here the KB is emitted by the
 * same build that emits the site, served from the same host, and
 * `assembleSystem()` THROWS below 200 characters rather than degrading silently.
 */

export type SiteKb = {
  slug?: string;
  name: string;
  town?: string;
  trade?: string;
  phoneDisplay?: string;
  phoneE164?: string;
  email?: string;
  address?: string;
  areaServed?: string;
  hours?: string;
  services?: string[];
  facts?: string[];
  /** Verbatim review text. Never paraphrase these into the prompt. */
  reviews?: { author?: string; stars?: number; text: string }[];
  /** Anything the site must NOT claim (no pricing published, not licensed for X, ...). */
  doNotClaim?: string[];
  language?: string;
  greeting?: string;
};

type CacheEntry = { kb: SiteKb; at: number };

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export class KbError extends Error {}

/**
 * Host allowlist. `CHAT_ALLOWED_HOSTS` is a comma-separated list of suffixes.
 * A leading dot means "this domain and any subdomain of it".
 * Default covers the demo estate only — a converted client's own domain has to be
 * added deliberately, which is the point.
 */
export function allowedHostSuffixes(): string[] {
  const raw = process.env.CHAT_ALLOWED_HOSTS || ".grayreserve.agency";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Returns the normalised origin (`https://host`) or throws. */
export function assertAllowedOrigin(site: string): string {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new KbError("site is not a URL");
  }
  const host = url.hostname.toLowerCase();
  const allowLocal = process.env.CHAT_ALLOW_LOCALHOST === "1";
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";

  if (isLocal) {
    if (!allowLocal) throw new KbError(`host not allowed: ${host}`);
    return url.origin;
  }
  if (url.protocol !== "https:") throw new KbError("site must be https");

  const ok = allowedHostSuffixes().some((suffix) =>
    suffix.startsWith(".") ? host === suffix.slice(1) || host.endsWith(suffix) : host === suffix,
  );
  if (!ok) throw new KbError(`host not allowed: ${host}`);
  return url.origin;
}

export async function loadKb(origin: string): Promise<SiteKb> {
  const hit = CACHE.get(origin);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.kb;

  let res: Response;
  try {
    res = await fetch(`${origin}/chat-kb.json`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
  } catch {
    throw new KbError(`could not reach ${origin}/chat-kb.json`);
  }
  if (!res.ok) throw new KbError(`${origin}/chat-kb.json returned ${res.status}`);

  let kb: SiteKb;
  try {
    kb = (await res.json()) as SiteKb;
  } catch {
    throw new KbError(`${origin}/chat-kb.json is not valid JSON`);
  }
  if (!kb || typeof kb.name !== "string" || !kb.name.trim()) {
    throw new KbError(`${origin}/chat-kb.json has no business name`);
  }

  CACHE.set(origin, { kb, at: Date.now() });
  return kb;
}

const list = (label: string, items?: string[]) =>
  items && items.length ? `${label}:\n${items.map((s) => `- ${s}`).join("\n")}\n` : "";

/**
 * Build the system prompt. THROWS if the result is implausibly short — a short
 * prompt means the KB failed to load properly, and shipping an empty system prompt
 * is precisely how a chatbot dies silently at HTTP 200.
 */
export function assembleSystem(kb: SiteKb): string {
  const lang = kb.language && kb.language !== "en" ? kb.language : null;
  const contact = [
    kb.phoneDisplay ? `Phone: ${kb.phoneDisplay}` : null,
    kb.email ? `Email: ${kb.email}` : null,
    kb.address ? `Address: ${kb.address}` : null,
    kb.hours ? `Opening hours: ${kb.hours}` : null,
    kb.areaServed ? `Area served: ${kb.areaServed}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const reviews = (kb.reviews || [])
    .slice(0, 6)
    .map((r) => `- ${r.stars ? `${r.stars} stars, ` : ""}${r.author || "a customer"}: "${r.text}"`)
    .join("\n");

  const system = `You are the assistant on the website of ${kb.name}${
    kb.trade ? `, ${kb.trade}` : ""
  }${kb.town ? ` in ${kb.town}` : ""}. You answer visitors' questions about this business.

WHAT YOU KNOW
${contact}
${list("Services", kb.services)}${list("Facts about this business", kb.facts)}${
    reviews ? `What customers have said (quote these verbatim, never reword them):\n${reviews}\n` : ""
  }
HOW TO ANSWER
- Two to four short sentences. Plain, warm, useful. Write like a person who works here, not like a brochure.
- Answer ONLY from what you know above. If the answer is not there, say so plainly and point them at the phone number. Never invent a price, a guarantee, a certification, an opening time or a service.
- Never invent prices. If asked what something costs and no price is listed above, say prices depend on the job and offer a free quote.
- You are the website's assistant. Never claim to be a person, and never claim to be able to book, schedule or dispatch anything yourself.
- No em dashes, no en dashes. Use commas and full stops.
- If a question has nothing to do with this business, steer back in one sentence.
${
  kb.doNotClaim && kb.doNotClaim.length
    ? `\nNEVER SAY ANY OF THIS, it is not true of this business:\n${kb.doNotClaim
        .map((s) => `- ${s}`)
        .join("\n")}\n`
    : ""
}${lang ? `\nWrite every reply in ${lang}, idiomatically.\n` : ""}
CAPTURING A LEAD
- When someone shows real buying intent (a quote, a price, availability, a specific job), your next reply asks for their name and the best phone number or email.
- The moment you have a name AND a phone number or email, call the capture_lead tool. Do not mention the tool. Capture first, keep helping afterwards.
- After capturing, confirm someone from ${kb.name} will be in touch, then carry on answering.`;

  if (system.length < 200) {
    throw new KbError("assembled system prompt is implausibly short; refusing to call the model");
  }
  return system;
}

export function fallbackLine(kb: SiteKb | null, name?: string): string {
  const who = kb?.name || name || "the team";
  const phone = kb?.phoneDisplay;
  return phone
    ? `Sorry, I had trouble there. You can reach ${who} directly on ${phone}.`
    : `Sorry, I had trouble there. Please use the contact form and ${who} will get back to you.`;
}
