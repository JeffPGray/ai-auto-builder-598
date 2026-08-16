/**
 * sitemap.xml — SHIPS IN THE TEMPLATE. Do not author this per client.
 *
 * WHY (2026-08-16): the generated version hand-typed the site's route list as string literals, which
 * is (a) pure retyping at high effort on every build and (b) a silent correctness trap — a route
 * added to the nav but forgotten here is simply absent from the sitemap, and nothing fails. Deriving
 * it from `ROUTES` means the sitemap cannot drift from the site.
 *
 * REQUIRED FROM ./_components/site-data:
 *   SITE_URL  string
 *   ROUTES    string[]  every static, indexable path, root-relative, starting with "/".
 *                       Include "/" itself. Do NOT include /blog/<slug> — blog posts are derived
 *                       from POSTS below. Do NOT include routes that are noindex.
 *
 * CARRIED-OVER BUG FIX: the generated sitemaps did `new Date(post.published + "T12:00:00")` with no
 * guard. When `published` already carries a time component that produces "...T12:00:00T12:00:00",
 * which is an Invalid Date, and `.toISOString()` then THROWS — taking the whole route down with it.
 * The blog index had the guard and the sitemap did not, which is exactly the kind of divergence a
 * per-client rewrite produces. `publishedISO()` below is the single implementation.
 */
import { POSTS } from "../_components/blog-data";
import { SITE_URL, ROUTES } from "../_components/site-data";

export const dynamic = "force-static";

/** Tolerates both "2026-08-16" and "2026-08-16T09:00:00Z". Never throws; falls back to now. */
function publishedISO(published: string): string {
  const raw = /T/.test(published) ? published : `${published}T12:00:00`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function absolute(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

export function GET() {
  const now = new Date().toISOString();

  const routes = [
    ...ROUTES.map((path) => ({ loc: absolute(path), lastmod: now })),
    ...POSTS.map((post) => ({
      loc: `${SITE_URL}/blog/${post.slug}`,
      lastmod: publishedISO(post.published),
    })),
  ];

  // De-duplicate defensively: a slug that also appears in ROUTES would otherwise emit twice, and a
  // duplicate <loc> is a validation error in Search Console.
  const seen = new Set<string>();
  const unique = routes.filter((r) => (seen.has(r.loc) ? false : (seen.add(r.loc), true)));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique
  .map((r) => `  <url>\n    <loc>${r.loc}</loc>\n    <lastmod>${r.lastmod}</lastmod>\n  </url>`)
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
