/**
 * blog/[slug]/page.tsx — SHIPS IN THE TEMPLATE (2026-08-16). See blog/page.tsx's header for why.
 * `generateStaticParams()` is load-bearing: under `output: 'export'`, a dynamic segment without
 * it emits NO article HTML at all while `next build` still exits 0 — the exact failure this file
 * becoming a template exists to close off. Restyle article typography/spacing to match this
 * client's design system; do not touch generateStaticParams, generateMetadata, or the schema
 * block without re-reading build/SKILL.md § AEO wiring.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteNav from "../../_components/SiteNav";
import SiteFooter from "../../_components/SiteFooter";
import { POSTS, wordCountOf, readMinutesOf } from "../../_components/blog-data";
import { pageGraph, breadcrumbs, blogPostingSchema } from "../../_components/schema";
import { biz } from "../../_components/site-data";

export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return {};
  return {
    title: `${post.title} | ${biz.name}`,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
  };
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  const others = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
  const dateLabel = new Date(post.published + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <SiteNav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(pageGraph(`/blog/${post.slug}`, `${post.title} | ${biz.name}`)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            blogPostingSchema({
              slug: post.slug,
              title: post.title,
              description: post.description,
              image: post.image,
              published: post.published,
              wordCount: wordCountOf(post),
            }),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbs([
              { name: "Home", href: "/" },
              { name: "Blog", href: "/blog" },
              { name: post.title, href: `/blog/${post.slug}` },
            ]),
          ),
        }}
      />

      <article className="bg-surface-1">
        <header className="border-b border-surface-3 py-16">
          <div className="mx-auto max-w-3xl px-5 lg:px-8">
            <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
              <Link href="/blog" className="hover:text-accent-text">Blog</Link>
              <span className="mx-2">/</span>
              <span>{post.title}</span>
            </nav>
            <h1 className="mt-4 font-display text-3xl font-bold text-ink sm:text-4xl">{post.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-muted">{post.dek}</p>
            <p className="mt-4 text-sm font-medium text-ink-muted">
              {dateLabel} · {readMinutesOf(post)} min read
            </p>
          </div>
        </header>

        <div className="mx-auto max-w-3xl px-5 py-12 lg:px-8">
          <div className="aspect-[16/10] w-full overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.image}
              alt={post.title}
              className="h-full w-full object-cover object-center"
              loading="eager"
              decoding="async"
            />
          </div>

          <div className="mt-10">
            {post.blocks.map((block, i) => {
              if (block.type === "h2") {
                return (
                  <h2 key={i} className="mt-10 font-display text-2xl font-bold text-ink">
                    {block.text}
                  </h2>
                );
              }
              if (block.type === "list") {
                return (
                  <ul key={i} className="mt-4 list-disc space-y-2 pl-6">
                    {block.items.map((item, j) => (
                      <li key={j} className="leading-relaxed text-ink-muted">{item}</li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={i} className="mt-4 leading-relaxed text-ink-muted">
                  {block.text}
                </p>
              );
            })}
          </div>

          <div className="mt-12 rounded-xl border border-surface-3 bg-surface-2 p-6">
            <p className="font-semibold text-ink">
              {biz.name} — {biz.phoneDisplay}
            </p>
            <a
              href={`tel:${biz.phone}`}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent-fill px-5 py-2.5 text-sm font-semibold text-on-accent-fill"
            >
              Call {biz.phoneDisplay}
            </a>
          </div>

          {others.length > 0 && (
            <div className="mt-16 border-t border-surface-3 pt-10">
              <p className="text-sm font-semibold uppercase tracking-widest text-accent-text">More articles</p>
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                {others.map((o) => (
                  <Link key={o.slug} href={`/blog/${o.slug}`} className="group">
                    <p className="font-bold text-ink group-hover:text-accent-text">{o.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">{o.dek}</p>
                  </Link>
                ))}
              </div>
              <Link href="/blog" className="mt-8 inline-block text-sm font-semibold text-accent-text hover:underline">
                ← Back to all articles
              </Link>
            </div>
          )}
        </div>
      </article>

      <SiteFooter />
    </>
  );
}
