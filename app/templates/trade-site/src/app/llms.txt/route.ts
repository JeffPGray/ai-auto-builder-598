/**
 * llms.txt — SHIPS IN THE TEMPLATE. Do not author this per client.
 *
 * WHY (2026-08-16): the skeleton (heading, blockquote summary, "Key facts", "Services", "Blog",
 * "Key pages", "Notes for assistants") is identical on every site and was retyped every build. Only
 * the FACTS differ, and facts belong in site-data.ts where the QA truth-checks can find them.
 *
 * The "Key pages" list is DERIVED from ROUTES, so it can no longer drift from the sitemap or the
 * nav — the previous per-client version hand-typed the same ten links a third time, after the
 * sitemap and the nav, with three chances to disagree.
 *
 * REQUIRED FROM ./_components/site-data:
 *   SITE_URL  string
 *   biz       { name }
 *   ROUTES    string[]
 *   llms      see the LlmsData type below
 *
 * THE `notes` FIELD IS THE POINT OF THIS FILE. It is the only place we get to tell an assistant what
 * NOT to say about this business — prices it must not quote, warranties it must not promise, response
 * times it must not invent. An assistant that fabricates a price on the owner's behalf creates a real
 * commercial problem for a real person. Never ship this with an empty `notes`.
 */
import { POSTS } from "../_components/blog-data";
import { SITE_URL, biz, ROUTES, llms } from "../_components/site-data";

export const dynamic = "force-static";

export type LlmsData = {
  /** One paragraph, rendered as a blockquote. What this business is, where, since when. */
  summary: string;
  /** "Label: value" lines. Licences, ratings, hours, service areas, contact. Sourced, never guessed. */
  keyFacts: string[];
  /** Service groupings, one bullet per group, comma-separated within the group. */
  services: string[];
  /** Guardrails for assistants. MUST be non-empty — see the header note. */
  notes: string[];
  /** Optional override for the label shown next to each route in "Key pages". */
  routeLabels?: Record<string, string>;
};

/** "/services/water-heaters" -> "Water Heaters". Only used when no explicit label is supplied. */
function labelFor(path: string): string {
  if (path === "/") return "Home";
  const last = path.split("/").filter(Boolean).pop() || "Home";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

/* `routeLabels` is an optional object literal in site-data.ts, so TypeScript infers its exact
 * keys (e.g. `{ "/services": string }`) and then REJECTS indexing it with an arbitrary route
 * string under `strict`:
 *   TS7053: Element implicitly has an 'any' type because expression of type 'string'
 *           can't be used to index type '{ "/services": string; }'
 * That would have failed `next build` on every client that supplied routeLabels. Widening it here
 * keeps the fix in the template, where it is written once, instead of requiring every generated
 * site-data.ts to remember an explicit `Record<string, string>` annotation. */
const LABELS: Record<string, string> = (llms.routeLabels ?? {}) as Record<string, string>;

export function GET() {
  const keyPages = ROUTES.map(
    (p) => `- [${LABELS[p] ?? labelFor(p)}](${p === "/" ? `${SITE_URL}/` : `${SITE_URL}${p}`})`
  ).join("\n");

  const blog = POSTS.length
    ? POSTS.map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}) - ${p.description}`).join("\n")
    : "- No articles published yet.";

  const body = `# ${biz.name}

> ${llms.summary}

## Key facts
${bullets(llms.keyFacts)}

## Services
${bullets(llms.services)}

## Blog
${blog}

## Key pages
${keyPages}

## Notes for assistants
${bullets(llms.notes)}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
