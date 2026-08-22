import type { Metadata } from "next";
import Link from "next/link";
import { pageGraph, breadcrumbs } from "../_components/schema";
import { biz } from "../_components/site-data";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using the Trade Business website — information only, not a quote or contract.",
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(pageGraph("/terms", "Terms of Service | " + biz.name)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbs([
              { name: "Home", href: "/" },
              { name: "Terms of Service", href: "/terms" },
            ])
          ),
        }}
      />
      <main className="bg-surface-1">
        <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8 lg:py-20">
          <nav className="font-body mb-8 flex items-center gap-2 text-sm text-ink-muted" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-accent-text">Home</Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink">Terms of Service</span>
          </nav>
          <header className="mb-12" data-reveal>
            <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">Terms of Service</h1>
            <p className="font-body mt-3 text-sm text-ink-muted">Last updated: August 2026</p>
          </header>
          <div className="space-y-10">
          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Who runs this site</h2>
            <p className="font-body text-ink-muted leading-relaxed">This website is published for Trade Business in Town, State.</p>
            <p className="font-body text-ink-muted leading-relaxed">Reach the business at (555) 555-0100 or hello@example.com.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">What this site is</h2>
            <p className="font-body text-ink-muted leading-relaxed">Pages describe services, service area, and how to get in touch. Nothing on the site is a formal quote, a fixed price contract, or a booking confirmation by itself.</p>
            <p className="font-body text-ink-muted leading-relaxed">Hours, services, and the area served are published as of the date on this page and can change. Confirm details when you speak with the business.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Enquiries</h2>
            <p className="font-body text-ink-muted leading-relaxed">Sending a form, starting a chat, calling, or texting is a request to be contacted. No work is booked and no price is agreed until the business confirms it with you.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Photos</h2>
            <p className="font-body text-ink-muted leading-relaxed">Photos on the site illustrate the kind of work associated with the business. They are not a guarantee of identical results on every property.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Links</h2>
            <p className="font-body text-ink-muted leading-relaxed">Links to other websites (maps, social profiles, partners) are outside this site’s control. Their terms and privacy rules apply there.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Accuracy</h2>
            <p className="font-body text-ink-muted leading-relaxed">Trade Business aims to keep the site accurate. Mistakes can still happen. If something looks wrong, say so using the contact details above.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Governing law</h2>
            <p className="font-body text-ink-muted leading-relaxed">These terms are governed by the laws of State, without naming a specific court.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Updates</h2>
            <p className="font-body text-ink-muted leading-relaxed">Last updated: August 2026.</p>
            <p className="font-body text-ink-muted leading-relaxed">This page was written from the details Trade Business publishes about itself. If anything here needs changing, email hello@example.com and it will be updated.</p>
            <p className="font-body text-ink-muted leading-relaxed">Trade Business · (555) 555-0100 · hello@example.com.</p>
          </section>
          </div>
        </div>
      </main>
    </>
  );
}
