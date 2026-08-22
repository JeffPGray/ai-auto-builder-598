#!/usr/bin/env node
/**
 * generate-legal-pages.mjs <slug|--template> [--write|--check]
 *
 * Termageddon / Squarespace-class privacy + terms for THIS build.
 * Inventory-gated (chat/form/maps/analytics) so we never invent trackers,
 * but the document is a full professional policy — not a three-paragraph stub.
 *
 * Spec honesty rules: .claude/skills/build/reference/legal-pages.md
 * Floor: privacy ≥ 900 words, terms ≥ 750 words of visible prose.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");
const TEMPLATE = process.argv.includes("--template");
const slug = TEMPLATE
  ? "trade-site"
  : process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));

if (!slug && !TEMPLATE) {
  console.error("usage: generate-legal-pages.mjs <slug|--template> [--write|--check]");
  process.exit(2);
}

const siteDir = TEMPLATE
  ? path.join(ROOT, "templates", "trade-site")
  : path.join(ROOT, "clients", slug, "site");
const appDir = path.join(siteDir, "src", "app");
const siteDataPath = path.join(appDir, "_components", "site-data.ts");

if (!existsSync(siteDataPath)) {
  console.error(`LEGAL_PAGES_CHECK=FAIL missing ${siteDataPath}`);
  process.exit(1);
}

const wordCount = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[{}`'"]/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z]{2,}/.test(w)).length;

const MIN_PRIVACY = 900;
const MIN_TERMS = 750;

if (CHECK) {
  const failures = [];
  for (const [label, min] of [
    ["privacy", MIN_PRIVACY],
    ["terms", MIN_TERMS],
  ]) {
    const file = path.join(appDir, label, "page.tsx");
    if (!existsSync(file)) {
      failures.push(`missing ${label}/page.tsx — run generate-legal-pages.mjs --write`);
      continue;
    }
    const body = readFileSync(file, "utf8");
    const w = wordCount(body);
    if (/demo preview/i.test(body)) {
      failures.push(`${label} still empty stub`);
    }
    if (w < min) failures.push(`${label} too thin (${w} words, need ≥${min} Termageddon-class)`);
    if ((body.match(/<h2\b/g) || []).length < 8) {
      failures.push(`${label} needs ≥8 section headings (got ${(body.match(/<h2\b/g) || []).length})`);
    }
    if (!/Last updated|Effective date/i.test(body)) {
      failures.push(`${label} missing effective / last-updated date`);
    }
  }
  if (failures.length) {
    for (const f of failures) console.error("  FAIL ", f);
    console.error("LEGAL_PAGES_CHECK=FAIL");
    process.exit(1);
  }
  console.log("LEGAL_PAGES_CHECK=PASS");
  process.exit(0);
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

const files = walk(appDir);
const blob = files.map((f) => readFileSync(f, "utf8")).join("\n");
const siteData = readFileSync(siteDataPath, "utf8");

function field(re, fallback = "") {
  const m = siteData.match(re);
  return (m?.[1] || fallback).trim();
}

const biz = {
  name: field(/name:\s*"([^"]+)"/, "the business"),
  phone: field(/phone:\s*"([^"]+)"/),
  email: field(/email:\s*"([^"]+)"/),
  city: field(/city:\s*"([^"]+)"/),
  stateCode: field(/state:\s*"([A-Z]{2})"/),
  stateLong: field(/\n\s*state:\s*"(Texas|California|Florida|New York|[^"]{4,})"\s*,/),
  street: field(/street:\s*"([^"]*)"/),
  zip: field(/zip:\s*"([^"]*)"/),
  area: field(/serviceAreaLabel:\s*"([^"]*)"/),
};

const STATE_MAP = {
  TX: "Texas",
  CA: "California",
  FL: "Florida",
  NY: "New York",
  AZ: "Arizona",
  CO: "Colorado",
  GA: "Georgia",
  NC: "North Carolina",
  OH: "Ohio",
  PA: "Pennsylvania",
  IL: "Illinois",
  WA: "Washington",
  OR: "Oregon",
  NV: "Nevada",
  TN: "Tennessee",
  OK: "Oklahoma",
  LA: "Louisiana",
  MS: "Mississippi",
  AL: "Alabama",
  AR: "Arkansas",
  NM: "New Mexico",
};
const jurisdiction =
  biz.stateLong ||
  STATE_MAP[biz.stateCode] ||
  (biz.stateCode ? biz.stateCode : "the state where the business operates");

const inv = {
  siteChat: /<SiteChat\b/.test(blob),
  contactForm: /<ContactForm\b/.test(blob),
  contactPost: /\/api\/preview\/|fetch\(.*contact/.test(blob),
  mailto: /mailto:/.test(blob),
  maps: /output=embed|maps\.google|google\.com\/maps/.test(blob),
  googlePhotos: /lh3\.googleusercontent/.test(blob),
  reviews: /\breviews\s*=\s*\[/.test(siteData) && !/reviews:\s*\[\s*\]/.test(siteData.replace(/\s/g, "")) ||
    (/reviews\s*=\s*\[[\s\S]*?\{/.test(siteData) && !/reviews:\s*\{\s*text:\s*string[\s\S]*?\}\[\]\s*=\s*\[\]/.test(siteData)),
  analytics: /gtag|googletagmanager|fbq\(|hotjar|clarity|plausible|posthog/i.test(blob),
  cookies: /document\.cookie|localStorage|sessionStorage/.test(blob),
  booking: /data-booking|href=["']\/book/.test(blob),
  heroVideo: /HeroVideo|hero\.mp4/.test(blob),
};

// reviews: true if array has at least one object
inv.reviews = /export const reviews\s*=\s*\[[\s\S]*?\{[\s\S]*?text:/.test(siteData);

const today = new Date();
const effective = today.toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const contactLine = [biz.phone, biz.email].filter(Boolean).join(" or ");
const place = [biz.street, biz.city, biz.stateCode || biz.stateLong, biz.zip]
  .filter(Boolean)
  .join(", ");

function S(h, ...blocks) {
  return { h, blocks: blocks.flat().filter(Boolean) };
}
function P(...paras) {
  return { type: "p", paras: paras.filter(Boolean) };
}
function UL(...items) {
  return { type: "ul", items: items.filter(Boolean) };
}

function privacySections() {
  const s = [];

  s.push(
    S(
      "Introduction",
      P(
        `This Privacy Policy describes how ${biz.name} ("${biz.name}", "we", "us", or "our") collects, uses, and shares information when you visit this website, contact us, or use features on the site such as forms${inv.siteChat ? " or chat" : ""}.`,
        `We wrote this policy for this specific website. It is meant to read like the policies you see on a professional small-business site (the same class of document tools such as Termageddon and Squarespace produce), while staying accurate about what this site actually does.`,
        `Effective date: ${effective}. If we change how the site handles information in a material way, we will update this page and the date above.`,
      ),
    ),
  );

  s.push(
    S(
      "Who we are",
      P(
        place
          ? `${biz.name} is a local trade business${biz.city ? ` serving customers in and around ${biz.city}` : ""}${biz.area ? ` (${biz.area})` : ""}. Published contact details: ${place}.`
          : `${biz.name} is a local trade business${biz.city ? ` based in ${biz.city}` : ""}${jurisdiction ? `, ${jurisdiction}` : ""}.`,
        `For privacy questions, contact us at ${contactLine || "the phone number or email published on this website"}.`,
      ),
    ),
  );

  s.push(
    S(
      "Scope of this policy",
      P(
        "This policy applies to information collected through this website and through communications that start from this website (for example, a form submission, a phone call to the number listed here, or an email to the address listed here).",
        "It does not cover websites we do not control, including map providers, social networks, or review platforms you may reach through outbound links.",
      ),
    ),
  );

  const collectItems = [
    "Identifiers and contact details you choose to give us (name, phone number, email address, service address or city).",
    "The contents of messages you send (form notes, chat text, or email body).",
    "Service preferences you select (for example, a service type on a contact form).",
    inv.contactForm || inv.contactPost
      ? "Technical details needed to deliver a form submission (such as the page you were on and basic browser information the network request carries)."
      : null,
    inv.siteChat
      ? "Chat conversation turns you send to the on-site assistant, and your IP address for rate-limiting the chat service."
      : null,
    "Call or text metadata when you contact the published business phone number (handled by your carrier and our phone system, not stored as a marketing profile on this static website).",
  ];

  s.push(
    S(
      "Information we collect",
      P("We collect information in these categories when you choose to provide it or when it is necessary to operate the site:"),
      UL(...collectItems),
      P(
        "We do not ask for Social Security numbers, payment card numbers, or government ID through this website. Please do not send that information by form or chat.",
      ),
    ),
  );

  const sources = [
    "Directly from you when you fill out a form, use chat, email us, or call us.",
    "From your device as part of ordinary web requests (for example, IP address seen by our host when a page or form is requested).",
    inv.maps || inv.googlePhotos
      ? "From map or photo providers when a page embeds or loads content from Google."
      : null,
  ];
  s.push(S("Sources of information", P("We obtain information from:"), UL(...sources)));

  const uses = [
    "Respond to requests for estimates, service, or information.",
    "Schedule visits and follow up by phone, text, or email when you asked to be contacted.",
    "Operate, secure, and troubleshoot this website.",
    inv.siteChat ? "Provide automated answers about services, hours, and service area through the on-site chat assistant." : null,
    "Comply with law when we are legally required to do so.",
  ];
  s.push(
    S(
      "How we use information",
      P("We use the information above to:"),
      UL(...uses),
      P(
        "We do not sell your personal information, and we do not use this website to run advertising audiences or cross-context behavioral ads.",
      ),
    ),
  );

  const share = [
    "People at the business who need the enquiry to reply or schedule work.",
    inv.contactPost
      ? "Hosting and form-delivery infrastructure that moves your submission from the website to the business (the same way any professionally hosted contact form works)."
      : null,
    inv.siteChat
      ? "The chat service that powers the on-site assistant, including an AI model provider that generates replies from the conversation turns you send. If you leave a name plus a phone or email in chat, that may be passed along as a lead so someone can follow up."
      : null,
    inv.maps || inv.googlePhotos
      ? "Google, when you load an embedded map or Google-hosted photos — Google receives what any browser sends when requesting those assets."
      : null,
    "Professional advisors or authorities when required by law or to protect rights and safety.",
  ];
  s.push(
    S(
      "How we share information",
      P(
        "We share information only as needed to run the business and this website:",
      ),
      UL(...share),
      P(
        "We do not sell personal information to data brokers. We do not share personal information for cross-context behavioral advertising.",
      ),
    ),
  );

  if (inv.siteChat) {
    s.push(
      S(
        "On-site chat and AI assistant",
        P(
          "This website includes a chat widget. When you use it, the text you type is sent to our chat service so an assistant can reply. Recent turns in the conversation travel with each request so the assistant has context.",
          "Replies are generated with the help of an AI service. Chat is for general questions about services, hours, and service area. It is not a substitute for a licensed inspection, a formal quote, or emergency dispatch.",
          "Do not send payment card numbers, passwords, or sensitive medical or government identifiers through chat. If you provide a name and a phone number or email, we may treat that as a request for a human follow-up.",
          "Your IP address may be used to limit abuse of the chat endpoint. Conversations are not published on the website.",
        ),
      ),
    );
  }

  if (inv.contactForm || inv.contactPost || inv.mailto) {
    s.push(
      S(
        "Contact forms and email links",
        P(
          inv.contactPost
            ? "The contact form on this site sends the details you enter to the business so we can respond. Submissions are handled as service enquiries, not as a newsletter signup, unless a page clearly offers a separate subscription."
            : "Contact options on this site let you reach the business by phone or email.",
          inv.mailto
            ? "Some links open your own email application addressed to the business. In that case the message is sent from your mail account; the website itself does not store the email body."
            : null,
          "Required fields exist so we can reply. Optional fields help us understand the job. You can call instead of using the form.",
        ),
      ),
    );
  }

  s.push(
    S(
      "Cookies, analytics, and tracking",
      P(
        inv.analytics
          ? "This build includes analytics or marketing scripts. Those tools may set cookies or similar identifiers according to their own policies. You can control cookies through your browser settings."
          : "This website is built as a static marketing site. It does not install advertising pixels, and it does not load third-party analytics packages such as Google Analytics, Meta Pixel, Hotjar, or similar tools.",
        inv.cookies
          ? "Some features may use browser storage when needed for basic function. We do not use local storage to build an advertising profile."
          : "We do not set first-party tracking cookies for advertising, and we do not use local or session storage to track you across visits for marketing.",
        "Your browser may still send ordinary request data (IP address, user agent) to our host when you load pages. That is standard for any website.",
        inv.heroVideo
          ? "If a page plays a hosted video, your browser requests the video file from our host the same way it requests images."
          : null,
      ),
    ),
  );

  s.push(
    S(
      "How long we keep information",
      P(
        "Enquiry information is kept as long as needed to respond to you, perform the work you requested, meet bookkeeping or legal duties, and resolve disputes.",
        "We do not publish a fixed multi-year retention schedule on this page because office practices can change. If you want a specific enquiry deleted from our active follow-up lists, contact us and we will handle the request as the law allows.",
      ),
    ),
  );

  s.push(
    S(
      "Security",
      P(
        "We use reputable hosting and transport encryption (HTTPS) for this website. No method of transmission or storage is completely secure. Please use judgment about what you send through forms or chat.",
        "If we learn of a breach that affects your personal information in a way that requires notice under applicable law, we will notify you as required.",
      ),
    ),
  );

  s.push(
    S(
      "Your choices and rights",
      P(
        "You can ask us what contact information we hold about you from website enquiries, ask us to correct it, or ask us to stop routine follow-up marketing messages where applicable.",
        `To make a request, email ${biz.email || "us"} or call ${biz.phone || "the number on this site"} and describe what you need. We may need to verify that we are speaking with the right person.`,
        `Depending on where you live, privacy laws in ${jurisdiction} or other jurisdictions may give you additional rights. This policy does not list every statute by section number. If you believe you have a specific legal right, contact us and we will respond in good faith.`,
      ),
    ),
  );

  s.push(
    S(
      "Children",
      P(
        "This website is intended for adults arranging trade services. It is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child provided information through this site, contact us and we will delete it.",
      ),
    ),
  );

  s.push(
    S(
      "Third-party sites and services",
      P(
        "Our pages may link to maps, social profiles, review listings, or other third-party sites. Their privacy practices are governed by their own policies. We are not responsible for those sites.",
        inv.booking
          ? "If an on-site booking flow runs in your browser before anything is confirmed with us, treat unconfirmed steps as informational until the business confirms the appointment."
          : null,
      ),
    ),
  );

  s.push(
    S(
      "Do Not Track",
      P(
        "Some browsers offer a Do Not Track signal. Because this site does not run advertising trackers, there is no additional advertising response layered on top of that signal. You can still use browser controls to block third-party cookies globally.",
      ),
    ),
  );

  s.push(
    S(
      "Changes to this policy",
      P(
        `We may update this Privacy Policy when the website or our practices change. The Effective date at the top will change when we do. Continued use of the site after an update means you should read the revised policy.`,
        `This page was prepared from the details ${biz.name} publishes about itself and from what this website’s code actually does. If something is wrong, email ${biz.email || "the business"} and it will be corrected.`,
      ),
    ),
  );

  s.push(
    S(
      "Contact us",
      P(
        `${biz.name}`,
        place || [biz.city, jurisdiction].filter(Boolean).join(", "),
        biz.phone ? `Phone: ${biz.phone}` : null,
        biz.email ? `Email: ${biz.email}` : null,
        "Ask for privacy or website questions when you reach out so we can route your message quickly.",
      ),
    ),
  );

  return s;
}

function termsSections() {
  const s = [];

  s.push(
    S(
      "Agreement to these terms",
      P(
        `These Terms of Service ("Terms") govern your use of the website operated for ${biz.name} (the "Site"). By accessing or using the Site, you agree to these Terms.`,
        `If you do not agree, do not use the Site. These Terms are meant to match the depth of a professional small-business policy pack (Termageddon / Squarespace class), written for this Site specifically.`,
        `Effective date: ${effective}.`,
      ),
    ),
  );

  s.push(
    S(
      "The business and the Site",
      P(
        `${biz.name} operates this Site to describe services${biz.city ? ` in the ${biz.city} area` : ""}${biz.area ? ` (${biz.area})` : ""} and to make it easy to get in touch.`,
        `Published contact details: ${contactLine || "see the Contact page"}${place ? `; ${place}` : ""}.`,
        "The Site is a marketing and information website. It is not an online storefront that completes paid checkout for field work unless a page clearly says otherwise.",
      ),
    ),
  );

  s.push(
    S(
      "Informational purpose — not a contract",
      P(
        "Content on the Site — including service descriptions, photos, example pricing mentions, blogs, and FAQs — is for general information.",
        "Nothing on the Site is, by itself, a binding quote, a fixed-price offer, an insurance certificate, a license filing, or a contract for work. Any job is agreed separately when the business confirms scope, timing, and price with you.",
      ),
    ),
  );

  s.push(
    S(
      "Enquiries, forms, calls, and chat",
      P(
        "Submitting a form, starting a chat, calling, or texting is a request to be contacted. It does not reserve a crew and does not lock pricing.",
        "We may refuse or reschedule work when a site visit shows unsafe conditions, access problems, or a scope that differs from what was described online.",
        inv.siteChat
          ? "Chat answers are automated assistance for common questions. They can be incomplete. For urgent issues (active flooding, electrical hazards, or similar), call the business directly."
          : null,
      ),
    ),
  );

  s.push(
    S(
      "Services and service area",
      P(
        "Service menus, hours, and coverage areas on the Site are published as of the Effective date and can change without updating every historical page at once.",
        "Some jobs require licenses, permits, or manufacturer constraints. Online copy cannot list every constraint for every property. Confirm requirements during your consultation.",
      ),
    ),
  );

  if (inv.reviews) {
    s.push(
      S(
        "Reviews and testimonials",
        P(
          "Customer comments displayed on the Site are quoted from public feedback about the business and belong to the people who wrote them.",
          "Individual results vary. A review describes one customer’s experience; it is not a guarantee that your project will have the same outcome.",
        ),
      ),
    );
  }

  s.push(
    S(
      "Photos, media, and examples",
      P(
        "Photos and video on the Site illustrate the kind of work associated with the business. Lighting, landscaping, structure, and finishes differ by property.",
        "Before-and-after or gallery images are examples, not a promise of identical results.",
        inv.googlePhotos
          ? "Some images may be served from public listing sources. Those files remain subject to the rules of the platforms that host them."
          : null,
      ),
    ),
  );

  s.push(
    S(
      "Intellectual property",
      P(
        `Site design, original text produced for this Site, and original graphics we publish are protected by applicable intellectual property laws. You may not copy the Site wholesale for commercial reuse without permission.`,
        "You may share links to public pages. You may not scrape the Site for bulk republishing, train models on the Site in a way that violates applicable law, or frame the Site so it appears to be yours.",
        "Third-party marks (product names, platforms) belong to their owners.",
      ),
    ),
  );

  s.push(
    S(
      "Acceptable use",
      P("You agree not to:"),
      UL(
        "Use the Site for unlawful purposes or to harass staff or other users.",
        "Attempt to break, overload, or probe the Site or its chat/form endpoints without authorization.",
        "Submit malware, spam, or deceptive content through forms or chat.",
        "Impersonate another person when requesting service.",
        "Harvest phone numbers or emails from the Site for unrelated bulk outreach.",
      ),
    ),
  );

  s.push(
    S(
      "Third-party links and tools",
      P(
        "The Site may link to maps, payment processors, social networks, or suppliers. Those services have their own terms. We are not responsible for their content or practices.",
        inv.maps
          ? "Embedded maps are provided by Google and are subject to Google’s terms when you interact with the map."
          : null,
      ),
    ),
  );

  s.push(
    S(
      "Disclaimer of warranties",
      P(
        'THE SITE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS TO THE FULLEST EXTENT PERMITTED BY LAW. WE DISCLAIM WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT AS THEY APPLY TO THE SITE CONTENT.',
        "We do not warrant that the Site will be uninterrupted, error-free, or free of harmful components. Field services, when separately agreed, are handled under that separate understanding with you — not under website marketing copy alone.",
      ),
    ),
  );

  s.push(
    S(
      "Limitation of liability",
      P(
        `TO THE FULLEST EXTENT PERMITTED BY LAW, ${biz.name} AND ITS OWNERS AND STAFF WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SITE OR RELIANCE ON SITE CONTENT.`,
        "Some jurisdictions do not allow certain limitations. In those places, our liability is limited to the maximum extent allowed. This section applies to the website experience; separately contracted field work may carry different terms stated in a written estimate or agreement.",
      ),
    ),
  );

  s.push(
    S(
      "Privacy",
      P(
        "Our Privacy Policy explains how we handle personal information collected through the Site. By using the Site, you also acknowledge that policy.",
      ),
    ),
  );

  s.push(
    S(
      "Governing law",
      P(
        `These Terms are governed by the laws of ${jurisdiction}, without regard to conflict-of-law rules that would choose another jurisdiction’s law.`,
        "We do not name a specific courthouse venue here. If a dispute arises, the parties will use the courts and procedures available under applicable law.",
      ),
    ),
  );

  s.push(
    S(
      "Changes to these Terms",
      P(
        "We may update these Terms when the Site or our practices change. The Effective date will change when we do. If you continue using the Site after an update, you should read the revised Terms.",
      ),
    ),
  );

  s.push(
    S(
      "Severability and entire agreement",
      P(
        "If a court finds a part of these Terms unenforceable, the rest remains in effect. These Terms and the Privacy Policy are the website terms between you and us regarding Site use. They do not replace a signed work order, estimate, or contract for field services.",
      ),
    ),
  );

  s.push(
    S(
      "Contact",
      P(
        `Questions about these Terms: ${contactLine || "use the Contact page"}.`,
        `This page was prepared from the details ${biz.name} publishes about itself. If anything needs changing, email ${biz.email || "the business"} and it will be updated.`,
        `${biz.name}${biz.phone ? ` · ${biz.phone}` : ""}${biz.email ? ` · ${biz.email}` : ""}.`,
      ),
    ),
  );

  return s;
}

function renderBlocks(blocks) {
  return blocks
    .map((b) => {
      if (b.type === "ul") {
        return `            <ul className="font-body list-disc space-y-2 pl-5 text-ink-muted leading-relaxed">\n${b.items
          .map((i) => `              <li>${i.replace(/`/g, "'")}</li>`)
          .join("\n")}\n            </ul>`;
      }
      return b.paras
        .map(
          (t) =>
            `            <p className="font-body text-ink-muted leading-relaxed">${t.replace(/`/g, "'")}</p>`,
        )
        .join("\n");
    })
    .join("\n");
}

function renderPage(kind, title, description, canonical, sections) {
  const h1 = kind === "privacy" ? "Privacy Policy" : "Terms of Service";
  const sectionJsx = sections
    .map(
      (sec) => `          <section className="space-y-4" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">${sec.h}</h2>
${renderBlocks(sec.blocks)}
          </section>`,
    )
    .join("\n\n");

  return `import type { Metadata } from "next";
import Link from "next/link";
import { pageGraph, breadcrumbs } from "../_components/schema";
import { biz } from "../_components/site-data";

export const metadata: Metadata = {
  title: ${JSON.stringify(title)},
  description: ${JSON.stringify(description)},
  alternates: { canonical: ${JSON.stringify(canonical)} },
};

/** Generated by scripts/generate-legal-pages.mjs — Termageddon-class depth, inventory-honest. */
export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(pageGraph(${JSON.stringify(canonical)}, ${JSON.stringify(h1 + " | ")} + biz.name)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbs([
              { name: "Home", href: "/" },
              { name: ${JSON.stringify(h1)}, href: ${JSON.stringify(canonical)} },
            ])
          ),
        }}
      />
      <main className="bg-surface-1">
        <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8 lg:py-24">
          <nav className="font-body mb-8 flex items-center gap-2 text-sm text-ink-muted" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-accent-text">Home</Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink">${h1}</span>
          </nav>
          <header className="mb-12 border-b border-surface-3 pb-8" data-reveal>
            <p className="font-body text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">Legal</p>
            <h1 className="font-display mt-3 text-4xl font-bold text-ink sm:text-5xl">${h1}</h1>
            <p className="font-body mt-4 text-sm text-ink-muted">Effective date: ${effective}</p>
            <p className="font-body mt-1 text-sm text-ink-muted">${biz.name}${biz.city ? ` · ${biz.city}` : ""}${jurisdiction ? `, ${jurisdiction}` : ""}</p>
          </header>
          <div className="space-y-12">
${sectionJsx}
          </div>
        </div>
      </main>
    </>
  );
}
`;
}

const privacySrc = renderPage(
  "privacy",
  "Privacy Policy",
  `Privacy Policy for ${biz.name} — how this website collects, uses, and shares information.`,
  "/privacy",
  privacySections(),
);
const termsSrc = renderPage(
  "terms",
  "Terms of Service",
  `Terms of Service for the ${biz.name} website — informational use, enquiries, and site rules.`,
  "/terms",
  termsSections(),
);

const pw = wordCount(privacySrc);
const tw = wordCount(termsSrc);
const ph2 = (privacySrc.match(/<h2\b/g) || []).length;
const th2 = (termsSrc.match(/<h2\b/g) || []).length;

console.log(
  JSON.stringify(
    { slug, biz: { name: biz.name, city: biz.city }, inventory: inv, privacyWords: pw, termsWords: tw, privacyH2: ph2, termsH2: th2 },
    null,
    2,
  ),
);

if (pw < MIN_PRIVACY || tw < MIN_TERMS || ph2 < 8 || th2 < 8) {
  console.error(
    `LEGAL_PAGES_CHECK=FAIL depth privacy=${pw}/${MIN_PRIVACY} h2=${ph2} terms=${tw}/${MIN_TERMS} h2=${th2}`,
  );
  process.exit(1);
}

if (!WRITE) {
  console.log("LEGAL_PAGES=DRY (pass --write to emit)");
  console.log("LEGAL_PAGES_CHECK=PASS");
  process.exit(0);
}

for (const [dir, src] of [
  [path.join(appDir, "privacy"), privacySrc],
  [path.join(appDir, "terms"), termsSrc],
]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "page.tsx"), src);
  console.log("LEGAL_PAGES=WRITTEN", path.join(dir, "page.tsx"));
}
console.log("LEGAL_PAGES_CHECK=PASS");
