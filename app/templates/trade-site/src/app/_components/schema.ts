/**
 * schema.ts — structured-data graph. SHIPS IN THE TEMPLATE. Do not author this per client.
 *
 * WHY THIS IS A TEMPLATE FILE (2026-08-16). Measured on a real build: the pipeline spent 47.8 of
 * 55.8 minutes generating tokens, and this file is 122 lines carrying ZERO design surface — no JSX,
 * no styling, no markup of any kind. It was being retyped from scratch on every build, at high
 * effort, plus the thinking to re-derive schema.org invariants the build skill already spells out.
 * Authoring it once means the AEO gates get one chance to be right instead of one fresh chance to
 * get `@id` wiring or canonical URLs wrong per client.
 *
 * WHAT THE BUILDER STILL OWNS: everything client-specific lives in `site-data.ts` under `seo`.
 * This file only knows how to SHAPE it. If a client needs a genuinely different graph (a trade with
 * no schema.org type, a multi-location LocalBusiness split), override this file for that client and
 * say so in status.md — deviation is allowed, silence is not.
 *
 * REQUIRED EXPORTS FROM ./site-data — `next build` fails loudly if any is missing, which is the
 * enforcement mechanism. There is no runtime guard here on purpose: a type error at build time is
 * strictly better than a site that deploys with a half-empty graph.
 *
 *   SITE_URL     string
 *   BUSINESS_ID  string   (`${SITE_URL}/#business`)
 *   biz          { name, shortName, phone, email, address:{street,city,state,zip},
 *                  areaServed:string[], state, founded, owner, ownerTitle,
 *                  facebook?, website? }
 *   faq          { q, a }[]
 *   seo          see the SeoData type below
 */
import { biz, SITE_URL, BUSINESS_ID, faq, seo } from "./site-data";

export type SeoData = {
  /** schema.org type for the trade, e.g. "Plumber", "Electrician", "HVACBusiness", "RoofingContractor". */
  schemaType: string;
  /** Optional Wikidata entity for the trade — strengthens entity resolution. Omit if unsure; never guess. */
  schemaTypeWikidata?: string;
  /** One or two sentences. Must be true and sourced from gathered-content.md. */
  description: string;
  /** Named services for the OfferCatalog. Real offerings only — never pad this list. */
  serviceCatalog: string[];
  /** Site-root-relative path to the primary image, e.g. "/images/gmaps2.webp". */
  primaryImage: string;
  /**
   * Opening hours. Omit entirely when the real hours are unknown — an invented schedule is a false
   * statement published under the business's name, and Google shows it.
   */
  openingHours?: { dayOfWeek: string[]; opens: string; closes: string }[];
};

const ALL_DAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

/* ── Shared graph (injected once in layout.tsx) ── */

export function businessGraph() {
  const business: Record<string, unknown> = {
    "@type": seo.schemaType,
    "@id": BUSINESS_ID,
    name: biz.name,
    alternateName: biz.shortName,
    description: seo.description,
    url: SITE_URL,
    telephone: biz.phone,
    email: biz.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: biz.address.street,
      addressLocality: biz.address.city,
      addressRegion: biz.address.state,
      postalCode: biz.address.zip,
      addressCountry: "US",
    },
    areaServed: biz.areaServed.map((city) => ({
      "@type": "City",
      name: city,
      containedInPlace: { "@type": "State", name: biz.state },
    })),
    foundingDate: String(biz.founded),
    founder: {
      "@type": "Person",
      name: biz.owner,
      jobTitle: biz.ownerTitle,
    },
    sameAs: [biz.facebook, biz.website].filter(Boolean),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Services",
      itemListElement: seo.serviceCatalog.map((name, i) => ({
        "@type": "Service",
        "@id": `${SITE_URL}/#service-${i}`,
        name,
        provider: { "@id": BUSINESS_ID },
      })),
    },
    image: `${SITE_URL}${seo.primaryImage}`,
  };

  // Only emit keys we can actually stand behind. `geo` is deliberately absent unless coordinates
  // were verified — an approximate lat/long on a LocalBusiness is worse than none.
  if (seo.schemaTypeWikidata) business.additionalType = seo.schemaTypeWikidata;
  if (seo.openingHours?.length) {
    business.openingHoursSpecification = seo.openingHours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.dayOfWeek,
      opens: h.opens,
      closes: h.closes,
    }));
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      business,
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: biz.name,
        publisher: { "@id": BUSINESS_ID },
      },
    ],
  };
}

/** Convenience for the common "open 24/7" case, so it is not retyped or mistyped per client. */
export const OPEN_24_7 = [{ dayOfWeek: ALL_DAYS, opens: "00:00", closes: "23:59" }];

/* ── Per-page helpers ── */

export function pageGraph(path: string, title: string) {
  const url = path === "/" ? SITE_URL : `${SITE_URL}${path}`;
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}/#webpage`,
    url,
    name: title,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": BUSINESS_ID },
  };
}

export function breadcrumbs(items: { name: string; href: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.href === "/" ? SITE_URL : `${SITE_URL}${item.href}`,
    })),
  };
}

export function faqSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}
