/**
 * blog-data.ts — TYPES SHIP IN THE TEMPLATE, `POSTS` IS AUTHORED PER CLIENT.
 *
 * WHY THE TYPES ARE A TEMPLATE FILE NOW (2026-08-16). A real build hand-authored this file's
 * `Post`/`Block` types fresh, and this time `Block` was used in `blog/[slug]/page.tsx` but never
 * exported here — a type error that broke the article route's generation, which in turn shipped
 * blog articles with ZERO JSON-LD (26 AEO failures, no `BlogPosting` node, no `Blog` graph entry)
 * and a build that had already told itself the article HTML existed when it didn't. Same root
 * cause as `schema.ts` becoming a template file: freehand-retyping non-design-surface TypeScript
 * every build is pure risk with no design upside. The TYPES below are fixed and exported
 * correctly; only `POSTS` (the actual article content) is yours to write, per § Blog in
 * build/SKILL.md.
 *
 * `wordCount` is REQUIRED per post and MUST be computed from `blocks`, never typed by hand —
 * `schema.ts`'s `blogPostingSchema()` reads it directly for the `BlogPosting.wordCount` field.
 * Use `wordCountOf(post)` below rather than re-deriving this.
 */

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "list"; items: string[] };

export type Post = {
  slug: string;
  title: string;
  description: string; // meta description, ~150-160 chars
  dek: string; // one-sentence standfirst shown under the title
  published: string; // ISO date, the BUILD date — never backdated (build/SKILL.md § Blog)
  image: string; // site-root-relative, from data/images/ — never a new/generated image
  blocks: Block[];
};

export function wordCountOf(post: Post): number {
  return post.blocks.reduce((n, b) => {
    if (b.type === "list") return n + b.items.join(" ").split(/\s+/).filter(Boolean).length;
    return n + b.text.split(/\s+/).filter(Boolean).length;
  }, 0);
}

export function readMinutesOf(post: Post): number {
  return Math.max(1, Math.round(wordCountOf(post) / 220));
}

/**
 * Fill this in per client. Five posts, 700-950 words each, written for the business's CUSTOMERS
 * — see build/SKILL.md § Blog for the three-bucket truth rule, the anti-slop pass, and the
 * concurrent sub-agent delegation pattern. This placeholder array is intentionally empty; a
 * build that ships it unfilled fails the blog route-coverage gate immediately and loudly, rather
 * than silently shipping zero articles.
 */
export const POSTS: Post[] = [];
