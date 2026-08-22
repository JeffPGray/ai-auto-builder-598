/**
 * blog/page.tsx — SHIPS IN THE TEMPLATE (2026-08-16, same reasoning as schema.ts: the JSON-LD
 * wiring and generateStaticParams plumbing here carry no design surface, and freehand-retyping
 * it is what let a real build ship 5 articles with zero structured data). Restyle the card
 * markup to match this client's design system — palette tokens, spacing, grain, motion hooks —
 * but do not touch the schema/metadata block without re-reading build/SKILL.md § AEO wiring.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { POSTS, readMinutesOf } from "../_components/blog-data";
import { pageGraph, breadcrumbs, blogIndexSchema } from "../_components/schema";
import { biz } from "../_components/site-data";

export const metadata: Metadata = {
  title: `Blog | ${biz.name}`,
  description: `Practical guidance from ${biz.name} — written for our customers, not for search engines.`,
  alternates: { canonical: "/blog" },
};

export default function BlogIndexPage() {
  const posts = [...POSTS].sort((a, b) => (a.published < b.published ? 1 : -1));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph("/blog", `Blog | ${biz.name}`)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogIndexSchema(posts)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbs([{ name: "Home", href: "/" }, { name: "Blog", href: "/blog" }])),
        }}
      />

      <section className="relative isolate overflow-hidden bg-surface-1 py-20 grain" data-reveal>
        <div className="mx-auto max-w-5xl px-5 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent-text">Blog</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-ink sm:text-5xl">
            Guides from {biz.name}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Straight answers to the questions we hear most, written for our own customers.
          </p>

          <div className="mt-12 grid gap-8 sm:grid-cols-2" data-reveal-group>
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-surface-3 bg-surface-2 transition-shadow hover:shadow-lg"
              >
                <div className="aspect-[16/10] w-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.image}
                    alt={post.title}
                    className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <p className="text-xs font-semibold uppercase tracking-widest text-accent-text">
                    {new Date(post.published + "T12:00:00").toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    · {readMinutesOf(post)} min read
                  </p>
                  <h2 className="mt-2 text-xl font-bold font-display text-ink group-hover:text-accent-text">
                    {post.title}
                  </h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{post.dek}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
