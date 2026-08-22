/**
 * Template site-data stub — Opus replaces every field from gathered content + design lock.
 * Shape matches the bluegrass fixture contract (NAV_LINKS children, chrome fields, schema).
 */
export const SITE_URL = "https://example.grayreserve.agency";
export const BUSINESS_ID = `${SITE_URL}/#business`;

export const biz = {
  name: "Trade Business",
  shortName: "Trade Co",
  /** From inspect-logo.mjs — light when logo has white plate */
  navTheme: "dark",
  /** Lockup/wordmark: logo alone (no shortName beside) */
  logoOnly: false,
  /** Display size classes from inspect-logo */
  logoImgClass: "h-10 w-10 shrink-0 object-contain",
  phone: "(555) 555-0100",
  phoneHref: "tel:+15555550100",
  email: "hello@example.com",
  address: {
    street: "123 Main St",
    city: "Town",
    state: "ST",
    zip: "00000",
  },
  areaServed: ["Town", "County"],
  /** Top-bar secondary line, e.g. "Serving Central Kentucky" */
  serviceAreaLabel: "Serving the local area",
  /** Compact hours for the top strip, e.g. "Mon-Thu 8am-10pm" */
  hoursShort: "Mon-Fri 8am-5pm",
  /** Footer hours block lines */
  hoursLines: ["Mon-Fri: 8:00 AM - 5:00 PM", "Sat-Sun: Closed"],
  state: "State",
  founded: "2000",
  owner: "Owner",
  ownerTitle: "Owner",
  tagline: "Replace with the consult lock line.",
  footerBlurb: "Replace with a 1-2 sentence NAP-aware blurb.",
  insuredNote: "Fully insured.",
};

export const faq: { q: string; a: string }[] = [];

export const seo: import("./schema").SeoData = {
  schemaType: "LocalBusiness",
  description: "Replace with sourced description.",
  serviceCatalog: ["Service A", "Service B"],
  primaryImage: "/images/logo.webp",
  openingHours: [
    { dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "17:00" },
  ],
};

export const ROUTES: string[] = [
  "/",
  "/services",
  "/about",
  "/contact",
  "/blog",
  "/privacy",
  "/terms",
];

export type NavLink = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
};

/** At least one link should carry children for the DropdownMenu chrome path. */
export const NAV_LINKS: NavLink[] = [
  {
    href: "/services",
    label: "Services",
    children: [
      { href: "/services#one", label: "Service One" },
      { href: "/services#two", label: "Service Two" },
    ],
  },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

export const llms: {
  summary: string;
  keyFacts: string[];
  services: string[];
  notes: string[];
  routeLabels?: Record<string, string>;
} = {
  summary: "Replace.",
  keyFacts: [],
  services: [],
  notes: [],
};

export const reviews: { text: string; name: string; source?: string }[] = [];
