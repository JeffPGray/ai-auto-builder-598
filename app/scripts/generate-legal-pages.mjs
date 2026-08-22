#!/usr/bin/env node
/**
 * generate-legal-pages.mjs <slug> [--write]
 *
 * Squarespace-class privacy + terms for THIS build: inventory what the site
 * actually does, then write /privacy and /terms from site-data.ts + greps.
 * Spec: .claude/skills/build/reference/legal-pages.md
 *
 * Prints: LEGAL_PAGES=WRITTEN|DRY … LEGAL_PAGES_CHECK=PASS|FAIL
 * Exit 0 on write/dry success, 1 on FAIL inventory/biz parse.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");
const slug = process.argv.includes("--template")
  ? "trade-site"
  : process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));

if (!slug && !TEMPLATE) {
  console.error("usage: generate-legal-pages.mjs <slug|--template> [--write|--check]");
  process.exit(2);
}

const TEMPLATE = process.argv.includes("--template");
const siteDir = TEMPLATE
  ? path.join(ROOT, "templates", "trade-site")
  : path.join(ROOT, "clients", slug, "site");
const appDir = path.join(siteDir, "src", "app");
const siteDataPath = path.join(appDir, "_components", "site-data.ts");

if (!existsSync(siteDataPath)) {
  console.error(`LEGAL_PAGES_CHECK=FAIL missing ${siteDataPath}`);
  process.exit(1);
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

const wordCount = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/[{}`'"]/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z]{2,}/.test(w)).length;


function field(re, fallback = "") {
  const m = siteData.match(re);
  return (m?.[1] || fallback).trim();
}

const biz = {
  name: field(/name:\s*"([^"]+)"/, "the business"),
  shortName: field(/shortName:\s*"([^"]+)"/),
  phone: field(/phone:\s*"([^"]+)"/),
  email: field(/email:\s*"([^"]+)"/),
  city: field(/city:\s*"([^"]+)"/),
  state: field(/state:\s*"([A-Z]{2})"/) || field(/\bstate:\s*"([^"]+)"/),
  jurisdiction: field(/\bstate:\s*"(Texas|[^"]+)"/) || field(/city:\s*"[^"]+"[\s\S]*?state:\s*"([^"]+)"/),
  street: field(/street:\s*"([^"]*)"/),
  zip: field(/zip:\s*"([^"]*)"/),
};

// Prefer biz.state full name for jurisdiction prose
const jurisdiction =
  field(/\n\s*state:\s*"(Texas|California|[^"]{3,})"\s*,/) ||
  (biz.state?.length > 2 ? biz.state : biz.state === "TX" ? "Texas" : biz.state) ||
  "the state where the business operates";

const inv = {
  siteChat: /<SiteChat\b/.test(blob),
  contactForm: /<ContactForm\b/.test(blob),
  contactPost: /\/api\/preview\/|fetch\(.*contact/.test(blob),
  mailtoForm: /mailto:/.test(blob) && /<form[\s\S]*mailto:|action=["']mailto:/.test(blob),
  stubForm: /preventDefault/.test(blob) && /ContactForm/.test(blob) && !/\/api\/preview\//.test(blob),
  maps: /output=embed|maps\.google|google\.com\/maps/.test(blob),
  googlePhotos: /lh3\.googleusercontent/.test(blob),
  reviews: /\breviews\s*=/.test(siteData) || /What customers say|reviews\.map/.test(blob),
  analytics: /gtag|googletagmanager|fbq\(|hotjar|clarity|plausible|posthog/i.test(blob),
  cookies: /document\.cookie|localStorage|sessionStorage/.test(blob),
  booking: /data-booking|href=["']\/book/.test(blob),
};

const monthYear = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
const contactLine = [biz.phone, biz.email].filter(Boolean).join(" or ");
const placeBits = [biz.street, biz.city, biz.state, biz.zip].filter(Boolean).join(", ");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function privacyBody() {
  const sections = [];

  sections.push({
    h: "Who this covers",
    p: [
      `This page describes how ${biz.name} handles information on this website. It is written from what this site actually does — not a generic policy copied from somewhere else.`,
      placeBits
        ? `${biz.name} serves customers from ${placeBits}.`
        : biz.city
          ? `${biz.name} is based in ${biz.city}${biz.state ? `, ${biz.state}` : ""}.`
          : null,
      `Questions about this page: ${contactLine || "use the contact details on this site"}.`,
    ].filter(Boolean),
  });

  const collect = [];
  if (inv.contactForm || inv.contactPost) {
    collect.push(
      "Contact form — name, phone, email, and the message you type. That enquiry is sent so the business can reply. The form is not used for advertising lists.",
    );
  }
  if (inv.mailtoForm) {
    collect.push(
      "Email links — some links open your own email app with a message addressed to the business. The website itself does not receive or store that message.",
    );
  }
  if (inv.siteChat) {
    collect.push(
      "Chat on this site — what you type is sent to the site’s chat service so an assistant can reply. The last few messages in the conversation travel with each request. If you share a name plus a phone number or email in chat, that may be treated as an enquiry so someone can get back to you. Your IP address is used to rate-limit the chat endpoint.",
    );
  }
  collect.push(
    `Phone and email — when you call or text ${biz.phone || "the published number"} or email ${biz.email || "the published address"}, you are contacting the business directly.`,
  );

  sections.push({
    h: "Information you provide",
    p: ["You choose what to send. Typical paths:"],
    ul: collect,
  });

  const use = [
    "Respond to service questions and schedule work.",
    "Call or text back when you asked to be contacted.",
  ];
  if (inv.siteChat) use.push("Answer chat questions about services, hours, and service area.");
  sections.push({ h: "How that information is used", ul: use });

  const auto = [];
  if (!inv.analytics) {
    auto.push(
      "This site does not run advertising pixels or third-party analytics trackers.",
    );
  } else {
    auto.push(
      "This build includes analytics or advertising scripts — they are disclosed here because they are present in the code. Review the live site head if you need the exact vendors.",
    );
  }
  if (!inv.cookies) {
    auto.push(
      "The site does not set its own cookies or use local browser storage for tracking.",
    );
  }
  if (inv.maps) {
    auto.push(
      "Pages with an embedded map load content from Google. Opening those pages can tell Google that the map was viewed.",
    );
  }
  if (inv.googlePhotos) {
    auto.push(
      "Some photos may load from Google’s servers when they come from the business listing.",
    );
  }
  if (inv.booking) {
    auto.push(
      "Any on-site booking steps that run only in your browser do not send a booking until you complete a confirmed path with the business.",
    );
  }
  auto.push(
    "Fonts are self-hosted with the site build. Visiting the site does not load fonts from Google Fonts.",
  );
  sections.push({ h: "What the site does not do", ul: auto });

  if (inv.siteChat) {
    sections.push({
      h: "The chat on this site",
      p: [
        "The chat widget is part of this website. Messages are processed by an AI service so you can get a quick answer about the business. Conversations are not published on the site.",
        "If you leave contact details in chat, treat that like leaving a voicemail — the business may use them to follow up. Do not send payment card numbers or passwords through chat.",
      ],
    });
  }

  sections.push({
    h: "Children",
    p: [
      "This site is aimed at adults arranging trade services. It is not directed at children.",
    ],
  });

  sections.push({
    h: "Changes",
    p: [
      `If how this site handles information changes, this page will be updated. Last updated: ${monthYear}.`,
    ],
  });

  sections.push({
    h: "Contact",
    p: [
      `This page was written from the details ${biz.name} publishes about itself. If anything here needs changing, email ${biz.email || "the business"} and it will be updated.`,
      `${biz.name}${biz.phone ? ` · ${biz.phone}` : ""}${biz.email ? ` · ${biz.email}` : ""}${biz.city ? ` · ${biz.city}` : ""}${jurisdiction ? `, ${jurisdiction}` : ""}.`,
    ],
  });

  return sections;
}

function termsBody() {
  const sections = [];
  sections.push({
    h: "Who runs this site",
    p: [
      `This website is published for ${biz.name}${biz.city ? ` in ${biz.city}` : ""}${jurisdiction ? `, ${jurisdiction}` : ""}.`,
      `Reach the business at ${contactLine || "the contact details shown on the site"}.`,
    ],
  });

  sections.push({
    h: "What this site is",
    p: [
      "Pages describe services, service area, and how to get in touch. Nothing on the site is a formal quote, a fixed price contract, or a booking confirmation by itself.",
      "Hours, services, and the area served are published as of the date on this page and can change. Confirm details when you speak with the business.",
    ],
  });

  sections.push({
    h: "Enquiries",
    p: [
      "Sending a form, starting a chat, calling, or texting is a request to be contacted. No work is booked and no price is agreed until the business confirms it with you.",
    ],
  });

  if (inv.reviews) {
    sections.push({
      h: "Reviews and photos",
      p: [
        "Customer comments shown on the site are quoted from public feedback about the business and belong to the people who wrote them.",
        "Photos show the kind of work associated with the business. Some may come from the business’s own materials or public listings.",
      ],
    });
  } else {
    sections.push({
      h: "Photos",
      p: [
        "Photos on the site illustrate the kind of work associated with the business. They are not a guarantee of identical results on every property.",
      ],
    });
  }

  sections.push({
    h: "Links",
    p: [
      "Links to other websites (maps, social profiles, partners) are outside this site’s control. Their terms and privacy rules apply there.",
    ],
  });

  sections.push({
    h: "Accuracy",
    p: [
      `${biz.name} aims to keep the site accurate. Mistakes can still happen. If something looks wrong, say so using the contact details above.`,
    ],
  });

  sections.push({
    h: "Governing law",
    p: [
      `These terms are governed by the laws of ${jurisdiction}, without naming a specific court.`,
    ],
  });

  sections.push({
    h: "Updates",
    p: [
      `Last updated: ${monthYear}.`,
      `This page was written from the details ${biz.name} publishes about itself. If anything here needs changing, email ${biz.email || "the business"} and it will be updated.`,
      `${biz.name}${biz.phone ? ` · ${biz.phone}` : ""}${biz.email ? ` · ${biz.email}` : ""}.`,
    ],
  });

  return sections;
}

function renderPage(kind, title, description, canonical, sections) {
  const h1 = kind === "privacy" ? "Privacy Policy" : "Terms of Service";
  const sectionJsx = sections
    .map((s) => {
      const paras = (s.p || [])
        .map(
          (t) =>
            `            <p className="font-body text-ink-muted leading-relaxed">${t.replace(/`/g, "'")}</p>`,
        )
        .join("\n");
      const ul = s.ul
        ? `            <ul className="font-body text-ink-muted leading-relaxed list-disc pl-5 space-y-2">\n${s.ul
            .map((i) => `              <li>${i.replace(/`/g, "'")}</li>`)
            .join("\n")}\n            </ul>`
        : "";
      return `          <section className="space-y-3" data-reveal>
            <h2 className="font-display text-2xl font-bold text-ink">${s.h}</h2>
${paras}${paras && ul ? "\n" : ""}${ul}
          </section>`;
    })
    .join("\n\n");

  // Avoid double periods when name ends with Co./Inc./LLC.
  return `import type { Metadata } from "next";
import Link from "next/link";
import { pageGraph, breadcrumbs } from "../_components/schema";
import { biz } from "../_components/site-data";

export const metadata: Metadata = {
  title: ${JSON.stringify(title)},
  description: ${JSON.stringify(description)},
  alternates: { canonical: ${JSON.stringify(canonical)} },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(pageGraph(${JSON.stringify(canonical)}, ${JSON.stringify(h1 + " | ") } + biz.name)),
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
        <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8 lg:py-20">
          <nav className="font-body mb-8 flex items-center gap-2 text-sm text-ink-muted" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-accent-text">Home</Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink">${h1}</span>
          </nav>
          <header className="mb-12" data-reveal>
            <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">${h1}</h1>
            <p className="font-body mt-3 text-sm text-ink-muted">Last updated: ${monthYear}</p>
          </header>
          <div className="space-y-10">
${sectionJsx}
          </div>
        </div>
      </main>
    </>
  );
}
`;
}

const privacySections = privacyBody();
const termsSections = termsBody();

const privacySrc = renderPage(
  "privacy",
  "Privacy Policy",
  `How ${biz.name} handles information submitted through this website.`,
  "/privacy",
  privacySections,
);
const termsSrc = renderPage(
  "terms",
  "Terms of Service",
  `Terms for using the ${biz.name} website — information only, not a quote or contract.`,
  "/terms",
  termsSections,
);



const pw = wordCount(privacySrc);
const tw = wordCount(termsSrc);

console.log(
  JSON.stringify(
    {
      slug,
      biz: { name: biz.name, city: biz.city, phone: biz.phone },
      inventory: inv,
      privacyWords: pw,
      termsWords: tw,
    },
    null,
    2,
  ),
);

if (pw < 220 || tw < 220) {
  console.error(`LEGAL_PAGES_CHECK=FAIL thin generated copy privacy=${pw} terms=${tw}`);
  process.exit(1);
}


if (CHECK) {
  const failures = [];
  for (const [label, file] of [
    ["privacy", path.join(appDir, "privacy", "page.tsx")],
    ["terms", path.join(appDir, "terms", "page.tsx")],
  ]) {
    if (!existsSync(file)) {
      failures.push(`missing ${label}/page.tsx — run: node scripts/generate-legal-pages.mjs ${slug} --write`);
      continue;
    }
    const body = readFileSync(file, "utf8");
    const w = wordCount(body);
    if (/demo preview|covers how .* handles information submitted through this website demo/i.test(body)) {
      failures.push(`${label} is still the empty stub — run generate-legal-pages.mjs --write`);
    }
    if (w < 220) failures.push(`${label} too thin (${w} words, need ≥220)`);
    if (!/Last updated/i.test(body)) failures.push(`${label} missing Last updated`);
  }
  if (failures.length) {
    for (const f of failures) console.error("  FAIL ", f);
    console.error("LEGAL_PAGES_CHECK=FAIL");
    process.exit(1);
  }
  console.log("LEGAL_PAGES_CHECK=PASS");
  process.exit(0);
}

if (!WRITE) {
  console.log("LEGAL_PAGES=DRY (pass --write to emit page.tsx files)");
  console.log("LEGAL_PAGES_CHECK=PASS");
  process.exit(0);
}

const privacyDir = path.join(appDir, "privacy");
const termsDir = path.join(appDir, "terms");
mkdirSync(privacyDir, { recursive: true });
mkdirSync(termsDir, { recursive: true });
writeFileSync(path.join(privacyDir, "page.tsx"), privacySrc);
writeFileSync(path.join(termsDir, "page.tsx"), termsSrc);
console.log(`LEGAL_PAGES=WRITTEN ${path.join(privacyDir, "page.tsx")}`);
console.log(`LEGAL_PAGES=WRITTEN ${path.join(termsDir, "page.tsx")}`);
console.log("LEGAL_PAGES_CHECK=PASS");
