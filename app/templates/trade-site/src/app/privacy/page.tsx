import type { Metadata } from "next";
import Link from "next/link";
import { pageGraph, breadcrumbs } from "../_components/schema";
import { biz } from "../_components/site-data";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Trade Business handles information submitted through this website.",
  alternates: { canonical: "/privacy" },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(pageGraph("/privacy", "Privacy Policy | " + biz.name)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbs([
              { name: "Home", href: "/" },
              { name: "Privacy Policy", href: "/privacy" },
            ])
          ),
        }}
      />
      <main className="bg-surface-1">
        <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8 lg:py-20">
          <nav className="font-body mb-8 flex items-center gap-2 text-sm text-ink-muted" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-accent-text">Home</Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink">Privacy Policy</span>
          </nav>
          <header className="mb-12" data-reveal>
            <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">Privacy Policy</h1>
            <p className="font-body mt-3 text-sm text-ink-muted">Last updated: August 2026</p>
          </header>
          <div className="space-y-10">
          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Who this covers</h2>
            <p className="font-body text-ink-muted leading-relaxed">This page describes how Trade Business handles information on this website. It is written from what this site actually does — not a generic policy copied from somewhere else.</p>
            <p className="font-body text-ink-muted leading-relaxed">Trade Business serves customers from 123 Main St, Town, ST, 00000.</p>
            <p className="font-body text-ink-muted leading-relaxed">Questions about this page: (555) 555-0100 or hello@example.com.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Information you provide</h2>
            <p className="font-body text-ink-muted leading-relaxed">You choose what to send. Typical paths:</p>
            <ul className="font-body text-ink-muted leading-relaxed list-disc pl-5 space-y-2">
              <li>Contact form — name, phone, email, and the message you type. That enquiry is sent so the business can reply. The form is not used for advertising lists.</li>
              <li>Email links — some links open your own email app with a message addressed to the business. The website itself does not receive or store that message.</li>
              <li>Chat on this site — what you type is sent to the site’s chat service so an assistant can reply. The last few messages in the conversation travel with each request. If you share a name plus a phone number or email in chat, that may be treated as an enquiry so someone can get back to you. Your IP address is used to rate-limit the chat endpoint.</li>
              <li>Phone and email — when you call or text (555) 555-0100 or email hello@example.com, you are contacting the business directly.</li>
            </ul>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">How that information is used</h2>
            <ul className="font-body text-ink-muted leading-relaxed list-disc pl-5 space-y-2">
              <li>Respond to service questions and schedule work.</li>
              <li>Call or text back when you asked to be contacted.</li>
              <li>Answer chat questions about services, hours, and service area.</li>
            </ul>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">What the site does not do</h2>
            <ul className="font-body text-ink-muted leading-relaxed list-disc pl-5 space-y-2">
              <li>This site does not run advertising pixels or third-party analytics trackers.</li>
              <li>The site does not set its own cookies or use local browser storage for tracking.</li>
              <li>Fonts are self-hosted with the site build. Visiting the site does not load fonts from Google Fonts.</li>
            </ul>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">The chat on this site</h2>
            <p className="font-body text-ink-muted leading-relaxed">The chat widget is part of this website. Messages are processed by an AI service so you can get a quick answer about the business. Conversations are not published on the site.</p>
            <p className="font-body text-ink-muted leading-relaxed">If you leave contact details in chat, treat that like leaving a voicemail — the business may use them to follow up. Do not send payment card numbers or passwords through chat.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Children</h2>
            <p className="font-body text-ink-muted leading-relaxed">This site is aimed at adults arranging trade services. It is not directed at children.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Changes</h2>
            <p className="font-body text-ink-muted leading-relaxed">If how this site handles information changes, this page will be updated. Last updated: August 2026.</p>
          </section>

          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">Contact</h2>
            <p className="font-body text-ink-muted leading-relaxed">This page was written from the details Trade Business publishes about itself. If anything here needs changing, email hello@example.com and it will be updated.</p>
            <p className="font-body text-ink-muted leading-relaxed">Trade Business · (555) 555-0100 · hello@example.com · Town, State.</p>
          </section>
          </div>
        </div>
      </main>
    </>
  );
}
