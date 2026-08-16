/**
 * robots.txt — SHIPS IN THE TEMPLATE. Do not author this per client.
 *
 * WHY (2026-08-16): this file is 100% invariant except one hostname. It was being retyped — 16
 * user-agent stanzas — on every build at high effort. There is no client-specific judgement in it.
 *
 * THE ALLOW-LIST IS A DELIBERATE PRODUCT DECISION, not an oversight. Every crawler below is allowed,
 * including the training crawlers (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended,
 * meta-externalagent, CCBot). For a local trade business trying to be FOUND, being absent from the
 * models people now ask "who's a good plumber in Houston" is a pure loss; there is no proprietary
 * content here to protect. If a client ever asks to be excluded from training, remove the training
 * block for that client and record it in status.md.
 *
 * REQUIRED FROM ./_components/site-data:
 *   SITE_URL  string
 */
import { SITE_URL } from "../_components/site-data";

export const dynamic = "force-static";

/** Crawlers that fetch a page live to answer a question right now — the AEO/GEO lane. */
const LIVE_RETRIEVAL = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-User",
  "Claude-SearchBot",
  "Applebot",
];

/** Crawlers that collect corpora for model training. Allowed — see the note above. */
const TRAINING = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "CCBot",
];

const stanzas = (agents: string[]) =>
  agents.map((a) => `User-agent: ${a}\nAllow: /`).join("\n\n");

export function GET() {
  const body = `# Live-retrieval crawlers
${stanzas(LIVE_RETRIEVAL)}

# Training crawlers
${stanzas(TRAINING)}

# Default
User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
