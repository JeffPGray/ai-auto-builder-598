---
name: seo
description: One-shot go-live SEO + AEO/GEO (answer-engine) optimisation for a deployed client site — canonical host, metadata, icons, entity-graph structured data, answer-shaped Q&A, llms.txt, retrieval-crawler access, sitemap/robots, instant search-engine submission, and a handover checklist. Works on Vercel, Cloudflare Pages, and Netlify.
argument-hint: [business-name] [live-domain]
effort: medium
allowed-tools: Bash(npx *), Bash(npm *), Bash(node *), Bash(bash *), Bash(python3 *), Bash(cd *), Bash(cp *), Bash(mv *), Bash(mkdir *), Bash(rm *), Bash(cat *), Bash(grep *), Bash(test *), Bash(curl *), Bash(printf *), Bash(echo *), Bash(openssl *), Bash(head *), Bash(cut *), Bash(tr *), Bash(date *), Bash(sed *), Read, Write, Edit, Glob, Grep
---

# Make $ARGUMENTS findable — go-live SEO + AI search

Read `prompts/lessons/build.md` and `prompts/lessons/deploy.md` before starting — this skill rebuilds and redeploys the client site, and those failure modes apply.

This skill is the **go-live step**: it adds the launch basics a deployed site still lacks — sitemap, canonical URL, structured data telling Google and the AI assistants what the business is, and search-engine submission — so the site comes out launch-ready for classic search (Google, Bing) and AI answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews). Run it when a lead converts, ideally right after their custom domain is attached.

**The one-shot contract:** the operator says `/seo acme-roofing https://acmeroofing.com` (domain optional) and gets back a fully optimised live site plus a short handover checklist for the steps that sit behind account sign-ins.

**What this skill deliberately does NOT do** (verified against Google/Bing guidance and controlled studies, mid-2026 — do not "improve" it by adding these):

- No `meta keywords`, no `geo.region`/`ICBM` meta tags — Google ignores both.
- No `<priority>`/`<changefreq>` in the sitemap — Google ignores both.
- No sitemap "ping" endpoint — retired by Google in 2023; submission is via robots.txt + Search Console.
- No hreflang (single-locale site), no image sitemap (the photo set is small and already in-page), no EXIF geotagging of images (controlled study: no net ranking effect, and platforms strip it anyway), no thin auto-generated "service area" pages (doorway-page risk — this is about *generated* per-town doorways, and does not license dropping the real `/services` `/about` `/contact` pages the build skill ships).
- No `speakable` markup. Google's own doc still labels it beta, and its scope is US English on Google Home devices for *publishers*. It is not an answer-engine lever for a local trade business.
- No `nosnippet` / `data-nosnippet` / `max-snippet`. Those are the controls that limit what Google may *show*, and a business that wants to be quoted in an AI answer must not ship them.

> `BreadcrumbList` **is** emitted, on every page except `/`. It used to be excluded here on the grounds that the site was flat; the build skill's § Site structure now ships four real routes, so the exclusion was stale rather than principled. See Step 3.

## Architecture (read once, then follow the steps)

- Everything this skill adds is **static-export compatible**: metadata/icons/manifest in `src/app/`, a JSON-LD `<script>` in the page, `app/robots.ts` + `app/sitemap.ts` (Next emits them as static files at build), an IndexNow key file in `public/`. No runtime flip, **no host restriction** — unlike `/cms`, `/booking`, and `/auto-updating-google-rating`, this works on Vercel, Cloudflare Pages, and Netlify alike. Never touch `output: 'export'` in `next.config.mjs`.
- The **canonical URL is the single most important input**, and that includes the *host form*: `www` vs apex is a real duplicate-site split if both serve 200, because a canonical tag is only a hint. Step 0 picks one; Step 8 proves the other redirects.
- AI assistants' crawlers read server-rendered HTML and **do not execute JavaScript**. Measured, not assumed: Vercel/MERJ instrumented their network and found OpenAI, Anthropic, Meta, ByteDance and Perplexity all fetch-and-parse raw HTML only — they *download* JS without running it (ChatGPT on 11.5% of requests, Claude on 23.8%). The two exceptions are **Gemini**, which rides Googlebot's rendering infrastructure, and **Applebot**, which renders through a browser. Everything else is raw HTML. They extract answers chunk-by-chunk and prefer concrete, liftable sentences. That's why Steps 3–4 exist and why Step 6 proves the content is really in the HTML **with `<script>` stripped** — a fact sitting in Next's RSC flight payload passes a naive grep of the file and is invisible to every crawler above.

## The AEO/GEO layer — what it is, and what may honestly be claimed for it

Traditional SEO makes a page rank. **AEO/GEO makes a page liftable and attributable**: it gives an answer engine a clean, corroborated statement of *what this business is, where it works, what it sells and what it charges for* — in raw HTML, in a resolvable entity graph, in the question form a customer actually types. Three parts, in order of how much they are worth:

1. **Entity clarity** (Step 3) — one business, one `@id`, `sameAs` to the profiles engines already trust, `areaServed` as real towns, and NAP identical in the schema and on every page.
2. **Answer-shaped content** (Step 4) — question headings answered in named, concrete sentences.
3. **Extractability** (Steps 4 and 6) — every load-bearing fact present with JS off, in text, not in an image.

**Say the honest thing to the operator and to the client.** The claim is *"structured so answer engines can extract and attribute it"*. It is **not** *"you will appear in ChatGPT"*, and nobody may write or say that.

- There is **no way to prove a citation**. Answer-engine output is non-deterministic, personalised and location-dependent; asking ChatGPT "do you know this business?" proves nothing, and third-party "AI visibility" scores measure their own sampled prompt set, not reality.
- The only first-party telemetry that exists is in Step 10's handover: server/edge logs showing a named retrieval bot fetched a URL, `utm_source=chatgpt.com` referral sessions, and Search Console's Generative AI report (impressions only — no clicks, no queries, Google only).
- **The dominant lever is off-site, not on-site.** Ahrefs' 75,000-brand study found AI-mention correlation of ~0.66 for branded web mentions against ~0.22 for referring domains and ~0.19 for content volume — and said in their own words that correlation is not causation. Everything in this skill is the necessary on-site half. Being talked about elsewhere is the other half, and it is a marketing problem, not a website problem. Do not let the site carry a promise the site cannot keep.

## Step 0 — Preconditions (STOP gates)

1. **The site must exist and be deployed.** `test -d clients/$ARGUMENTS/site` and a `deployed_url` in Supabase (`python3 scripts/db.py client $ARGUMENTS`) or `clients/$ARGUMENTS/data/status.md`. If built but not deployed, run `/deploy $ARGUMENTS` first.
2. **Gathered content must exist.** `clients/$ARGUMENTS/data/gathered-content.md` is the only source of business facts. If it's missing, STOP — never reconstruct facts from memory.
3. **Not already applied.** If `clients/$ARGUMENTS/data/seo.md` exists, switch to § Maintenance and ask what changed.
4. **No live booking facade.** If this client's `extra.mode` is `booking` (status.md or Supabase) and neither `clients/$ARGUMENTS/data/booking.md` nor `data/booking-rewired.md` exists, the demo facade is still live — STOP: this skill deletes noindex and sitemaps `/book`, which would index a booking flow that takes nobody's bookings. Run `/booking $ARGUMENTS` (or the CTA rewire from the build skill's conversion rule — it writes the marker), then re-run `/seo`.
5. **Resolve the canonical base URL** and hold it as `BASE_URL` for every step:
   - If the operator passed a domain (second argument), use it: normalise to `https://`, no trailing slash. **The host form given is the preferred host** — if they said `acmeroofing.com`, apex is canonical and `www` must redirect to it (and vice versa). Verify it serves THIS site — `curl -sSL` it and check the `<title>` matches this client; a wrong domain poisons every tag you're about to write.
   - Otherwise use the Supabase `deployed_url` (host URLs have no www/apex ambiguity).
   - If the client has converted and a custom domain is being set up but isn't attached yet, **STOP and tell the operator**: attach the domain first (operator-guide.html has the walkthrough), then run `/seo`. Running on the host URL is only right for clients staying on it.
6. Drop an in-progress marker: `touch clients/$ARGUMENTS/data/seo-in-progress` (remove it in Step 10; if one is already there, a previous run died — clean up and start over).

## Step 1 — Collect the facts (and only the facts)

Read `clients/$ARGUMENTS/data/gathered-content.md` and pull out: business name, category/trade, each service offered, full address, phone, email, opening hours, photos, socials (`Social:` lines in the Brand block), brand colours + logo path, the Google Maps CID embed URL, the town, and any *concrete numbers* the gather recorded (years trading, review count, team size, response time, accreditations, service radius / towns covered). These facts — and nothing else — feed everything below.

**Optional but recommended — resolve the Google listing for verified address + coordinates** (only if `GOOGLE_PLACES_API_KEY` is set in `.env`; skip silently if not):

```bash
KEY="$(grep -E '^GOOGLE_PLACES_API_KEY=' .env | cut -d= -f2- | tr -d '"')"
curl -s "https://places.googleapis.com/v1/places:searchText" \
  -H "X-Goog-Api-Key: $KEY" \
  -H "X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.rating,places.userRatingCount" \
  -H "Content-Type: application/json" \
  -d '{"textQuery":"<BUSINESS NAME> <LOCATION>"}'
```

Apply the same right-business check as `/auto-updating-google-rating`: the `displayName` + `formattedAddress` must unmistakably be THIS client, never blindly the first result. A match gives you `location` (lat/lng) for `geo`, `googleMapsUri` for `sameAs`/`hasMap`, and the **live** `rating` + `userRatingCount` for the `aggregateRating` markup. If no result clearly matches, skip `geo` and `aggregateRating` — **an absent property is always better than a guessed one.**

## Step 2 — Head metadata, icons, manifest (`layout.tsx` + `src/app/`)

Upgrade the metadata export in `clients/$ARGUMENTS/site/src/app/layout.tsx` to the full go-live shape. Keep the existing title/description as the starting point — they were written for this business — but bring them up to standard, in `${OPERATOR_LANGUAGE}`:

```tsx
export const metadata: Metadata = {
  metadataBase: new URL("<BASE_URL>"),
  title: "<Business Name> | <trade> in <town>",   // natural phrasing in ${OPERATOR_LANGUAGE}, not keyword soup
  description: "<what they do + where, ~150-160 chars, in ${OPERATOR_LANGUAGE}>",
  alternates: { canonical: "/" },                  // resolves absolute via metadataBase — Google wants absolute + self-referencing
  openGraph: {
    type: "website",
    url: "/",
    siteName: "<Business Name>",
    title: "<same or shorter title>",
    description: "<same description>",
    locale: "<lang>_<COUNTRY>",                    // from ${OPERATOR_LANGUAGE_CODE} + ${OPERATOR_COUNTRY_CODE}, e.g. en_GB, it_IT
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "<describe the photo, in ${OPERATOR_LANGUAGE}>" }],
  },
  twitter: { card: "summary_large_image" },        // inherits title/description/images from openGraph
  robots: { index: true, follow: true },           // explicit allow; delete any noindex you find — a leftover one silently defeats everything else here
};

export const viewport: Viewport = {
  themeColor: "<brand primary hex from the Brand block>",   // Next 14+: themeColor lives on viewport, not metadata
};
```

- **og:image at real share dimensions.** Produce `public/og.jpg` at exactly **1200×630** from the best landscape photo of THIS business — a wrong-ratio image renders as a broken card when the owner shares the site. If the photo is a hotlinked URL rather than a file in `public/images/`, `curl -o` it to a temp file first, then:
  ```bash
  npx --package sharp-cli sharp -i <photo> -o /tmp/og-resize resize 1200 630   # -o is a DIRECTORY; fit defaults to cover
  mv /tmp/og-resize/<photo-basename> clients/$ARGUMENTS/site/public/og.jpg
  ```
  Declared `width`/`height` must match the actual file.
- **Icons beyond favicon.ico** (which the scaffold already has): if the Brand block has a usable logo, produce `src/app/apple-icon.png` at **180×180** (pad to square on the brand background colour — don't stretch). If there's no real logo, skip it rather than inventing branding.
- **Web manifest** — `src/app/manifest.ts`:
  ```ts
  import type { MetadataRoute } from "next";
  export const dynamic = "force-static"; // Next 16 static-export requirement (see robots.ts note in Step 5)
  export default function manifest(): MetadataRoute.Manifest {
    return {
      name: "<Business Name>", short_name: "<short form>",
      description: "<the meta description>",
      start_url: "/", display: "standalone",
      background_color: "<brand background hex>", theme_color: "<brand primary hex>",
      icons: [{ src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" }],  // + apple-icon if created
    };
  }
  ```
- Don't stuff the title. `"Bella Napoli | Pizzeria in Shrewsbury"` beats `"Pizza Shrewsbury | Best Italian Restaurant Takeaway Near Me"` — the second is the spam signature every SEO-slop site carries.

## Step 3 — Structured data: one entity graph (JSON-LD)

This is what search engines and AI assistants read to understand *what this business is* — and a connected graph (rather than a lone block) is what lets a model treat the business, its services, and its page as one entity instead of guessing.

1. **Pick the most specific schema.org subtype** — never bare `LocalBusiness` when a subtype fits (Google's explicit guidance). Common mappings: restaurant → `Restaurant`, café → `CafeOrCoffeeShop`, bakery → `Bakery`, plumber → `Plumber`, electrician → `Electrician`, roofer → `RoofingContractor`, painter/decorator → `HousePainter`, locksmith → `Locksmith`, garage/mechanic → `AutoRepair`, hair salon → `HairSalon`, beauty salon → `BeautySalon`, dentist → `Dentist`, florist → `Florist`, heating/HVAC → `HVACBusiness`, general builder → `GeneralContractor`, moving firm → `MovingCompany`. If none fit, check the subtype list at schema.org/LocalBusiness; only fall back to `LocalBusiness` itself when nothing more specific exists.
2. **Build a single `@graph`** from Step 1's facts only (omit any property you don't have a verified value for — no empty strings, no guesses):

```tsx
const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "<Subtype>",
      "@id": "<BASE_URL>/#business",
      name: "<Business Name>",
      url: "<BASE_URL>",
      telephone: "<+E.164>",
      image: ["<BASE_URL>/og.jpg", "..."],
      address: { "@type": "PostalAddress", streetAddress: "<street>", addressLocality: "<town>",
                 postalCode: "<postcode>", addressCountry: "<${OPERATOR_COUNTRY_CODE}>" },
      geo: { "@type": "GeoCoordinates", latitude: <lat>, longitude: <lng> },   // only if Step 1 resolved it
      hasMap: "<googleMapsUri>",                                               // only if Step 1 resolved it
      openingHoursSpecification: [
        { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "..."], opens: "09:00", closes: "17:30" },
      ],
      additionalType: "<Wikidata URI for the trade>",   // ONLY when no schema.org subtype fits the trade
                                                        // (landscaping, for one, has none). It pins the
                                                        // trade to a concept instead of leaving a model
                                                        // to infer it from prose.
      areaServed: [{ "@type": "City", name: "<town>",
                     containedInPlace: { "@type": "AdministrativeArea", name: "<county/state/region>" } }
                   /* ...one node per town genuinely served, not a bare string */],
      sameAs: ["<facebook URL>", "<instagram URL>", "<googleMapsUri>", "<their own existing site, rescue lane>"],
      hasOfferCatalog: {                                 // the machine statement of "everything they sell"
        "@type": "OfferCatalog", name: "<trade> services",
        itemListElement: [{ "@type": "Offer", itemOffered: { "@id": "<BASE_URL>/#service-<slug>" } }],
      },
      aggregateRating: {                                   // ONLY from Step 1's live Places lookup — see item 4
        "@type": "AggregateRating", ratingValue: <live rating>, ratingCount: <live count>,   // ratingCount, not reviewCount — Places counts ratings, not written reviews
      },
      review: [                                            // 2-3, verbatim from reviews the page displays — see item 4
        { "@type": "Review",
          author: { "@type": "Person", name: "<reviewer name as displayed>" },
          reviewRating: { "@type": "Rating", ratingValue: <stars> },
          reviewBody: "<review text exactly as the page renders it>" },
      ],
      // servesCuisine: "<cuisine>",   // restaurants only
      // priceRange: "<££ etc>",       // only if genuinely known — never invent one
    },
    // One Service node per service the business actually offers (this is what feeds "best <service> near me").
    // `Service` has never had a Google rich result and never will — it is purely the machine statement of
    // what this business sells and where. Ship it anyway; that is exactly what an answer engine needs.
    {
      "@type": "Service",
      "@id": "<BASE_URL>/#service-<slug>",
      name: "<Service name as the site words it>",
      serviceType: "<plain category, e.g. Boiler repair>",
      provider: { "@id": "<BASE_URL>/#business" },
      areaServed: [{ "@type": "City", name: "<town>" }],
    },
    // The page itself — carries the freshness signals AI engines weight heavily.
    // MULTI-PAGE: this node is PER PAGE, so its @id and url must carry that page's path
    // (`<BASE_URL>/services/#webpage`, url `<BASE_URL>/services`). Four pages all claiming
    // `<BASE_URL>/#webpage` is a self-inflicted duplicate-entity problem.
    {
      "@type": "WebPage",
      "@id": "<BASE_URL><PATH>/#webpage",
      url: "<BASE_URL><PATH>",
      name: "<the page title>",
      inLanguage: "<${OPERATOR_LANGUAGE_CODE}>",
      about: { "@id": "<BASE_URL>/#business" },
      datePublished: "<go-live date YYYY-MM-DD>",
      dateModified: "<go-live date YYYY-MM-DD>",
    },
    // FAQPage node referencing Step 4's visible FAQ — same questions, verbatim:
    {
      "@type": "FAQPage",
      "@id": "<BASE_URL>/#faq",
      mainEntity: [
        { "@type": "Question", name: "<question exactly as rendered>",
          acceptedAnswer: { "@type": "Answer", text: "<answer exactly as rendered>" } },
      ],
    },
  ],
};
```

2b. **Split the graph across the routes.** Put the shared, site-level nodes (`<Subtype>` business, the `Service` nodes, `WebSite`) in **`layout.tsx`** so they emit once per page without four divergent copies, and put the **per-page** nodes (`WebPage`, `BreadcrumbList`, and the `FAQPage` on whichever page renders the FAQ) in that route's own `page.tsx`. Same `@id`s across pages are correct for the shared nodes — that is what makes it one entity graph rather than four businesses.

2c. **The blog is already in the graph — verify it, do not rebuild it.** `/build` ships `/blog` plus five articles on every site (its § Blog), with one `Blog` node defined on `/blog` and a `BlogPosting` per article whose `author` and `publisher` are both the business `@id`. At go-live your job is to confirm it survived, not to re-author it: every article still carries its own canonical, `BlogPosting.datePublished` still matches what the page renders, and the `Blog` node is still defined exactly once. If the client has since written or commissioned real posts, they join `POSTS` and everything else regenerates. **Never invent a human author** to make the markup look richer, and never move an article's `datePublished` — a freshness date that lies is the one thing Google explicitly discounts.

Every page except `/` also carries a `BreadcrumbList`:

```ts
{
  "@type": "BreadcrumbList",
  "@id": "<BASE_URL><PATH>/#breadcrumb",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "<Home, in ${OPERATOR_LANGUAGE}>", item: "<BASE_URL>" },
    { "@type": "ListItem", position: 2, name: "<this page's nav label, verbatim>", item: "<BASE_URL><PATH>" },
  ],
}
```

The `name` values must match the visible nav labels character for character — Google cross-checks breadcrumb markup against the rendered navigation and drops the whole node on a mismatch. `/` gets no breadcrumb (a one-item trail is noise).

3. **Render it the way Next recommends** — a `<script>` tag in `page.tsx` (or `layout.tsx`, per item 2b), with `<` escaped:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
/>
```

4. **Review markup: true numbers, honest expectations.** `aggregateRating` comes ONLY from Step 1's live Places lookup — never a stale copy from `gathered-content.md`, never from memory; if the lookup was skipped or didn't match, omit it entirely. If `/auto-updating-google-rating` is installed, the page already shows the live figure — the schema must reflect the same source, not a frozen number. `review` nodes quote only reviews the page already displays, verbatim, reviewer name as shown. Know what this earns: Google treats a business marking up its own reviews as self-serving and will NOT show star rich results (policy since 2019) — the markup is here because it's true entity data AI engines can read, not because it produces stars.
5. **Freshness discipline:** `dateModified` and the sitemap's `lastModified` (Step 5) move **only when page content genuinely changes**. Bumping dates with no real change does nothing and reads as manipulation.

## Step 4 — Answer-shaped content pass (every page)

Run this pass over **each** `src/app/**/page.tsx`, not the home page alone. That includes `/blog` and every article: an article is the most quotable page on the site, so item 2 (concrete numbers) and item 3 (answer-first sections) apply to article copy the same way. Edit article prose in `_components/blog-data.ts`, never in the route file, and re-run `Skill(skill="anti-ai-slop")` if you rewrite more than a sentence of it. The subpages are where the liftable answers live — `/services` is the page an AI engine quotes for "who does X in <town>", and a pass that stops at `/` leaves three quarters of the site unoptimised. Items 1 and 6 below are per-page; items 2-5 apply wherever the relevant content sits (the NAP block belongs on `/contact` and in the shared footer; the FAQ goes on one page, and only that page carries the `FAQPage` node).

AI engines lift answers sentence-by-sentence, and controlled evidence shows concrete numbers and direct phrasing raise citation odds ~30–40% while padding does nothing. This step makes the page *quotable*. **Everything must match the site's existing design system, and every fact comes from Step 1 — no invented numbers, ever.**

1. **Add an FAQ section** (4–6 Q&As) phrased the way people actually ask — "Who does emergency boiler repair in <town>?", "How quickly can <Business> get to <town>?", "Is <Business> insured?", "What does <job> cost with <Business>?" — each answered in 1–3 concrete sentences that name the business explicitly. **The questions are derived from `gathered-content.md`, not invented**: the service list, the service-area list, hours, credentials/licence numbers, years trading and the pricing posture each generate a question a real customer asks. Where the business publishes no prices, the honest answer is that they quote after a visit — never an invented range.

   **Render and mark up the same words.** Drive both the visible `<h3>`/`<p>` and the `FAQPage` node from one array, so they cannot drift. A `Question` whose answer is not visible on the page is invisible markup: it breaches Google's structured-data policy and gives an answer engine text it cannot corroborate. `scripts/aeo-check.mjs` hard-fails on both halves — a question that is not a rendered heading, and an answer whose text is not in the page.

   > **FAQ rich results are gone, and the skill's old wording was stale.** Google restricted them to government and health sites in September 2023 and **fully deprecated** the feature in May 2026, with the documentation removed that June. That is not why this exists. `FAQPage` still ships because it is valid, liftable, answer-shaped text that Bingbot, PerplexityBot, ClaudeBot and GPTBot all parse straight out of raw HTML. Expect no SERP dropdown, and never sell one.
2. **Concrete-number density:** wherever the copy is vague and a gathered fact is specific, sharpen it — years trading, review count, response time, service radius or towns covered, team size, warranty length, accreditations with dates. "Serving Shrewsbury for 12 years" beats "trusted local experts".
3. **Answer-first sections:** each section's first sentence should answer its heading standalone, naming the business rather than "we" where it reads naturally (models resolve "Acme Roofing repairs flat roofs across Telford" far better than "We do all kinds of roofs").
4. **Visible NAP block:** business name, full address, and phone must appear as crawlable **HTML text** (typically the contact section + footer). Name and address **character-identical** to the JSON-LD (same street abbreviations); the displayed phone stays in the national format the Google listing shows, while the `tel:` href and the schema `telephone` carry E.164 — display and machine fields serve different consumers. Schema NAP is not a substitute for on-page NAP — engines cross-check the rendered text against the Google listing.
5. **Verify the build-standard furniture survived:** phone wired as `tel:` + E.164 (build standard), the CID-based Google Maps embed present (build standard), a "get directions" link near the map if the business has a premises (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` or the Maps URI).
6. **Micro-audit while you're in there:** exactly one `<h1>` that says who/what/where; the town + trade appear in visible headings/body, not just the `<title>`; every `<img>` has a real `alt` in `${OPERATOR_LANGUAGE}` describing what's in the photo (decorative → `alt=""`) **and explicit `width`/`height` or an aspect-ratio class** (the one Core Web Vitals lever worth enforcing statically — missing dimensions are the #1 cause of layout shift); `<html lang>` still equals `${OPERATOR_LANGUAGE_CODE}`.

Content changes here are visible — after editing, eyeball the affected sections (serve `out/` after Step 6's build) to confirm the FAQ and any sharpened copy sit naturally in the design.

## Step 5 — robots.ts, sitemap.ts, IndexNow key

All three go in before the build so they ship together:

1. **`src/app/robots.ts`** — allow everything, with the AI crawlers **explicitly named** (the wildcard already covers them; naming them makes the intent visible in the file). If this client has private admin surfaces (`data/cms.md` or `data/booking.md` exists), add `disallow: ["/admin"]` to **BOTH rules** — a crawler obeys only its most-specific matching group, so a disallow on `*` alone would NOT apply to the named bots:

```ts
import type { MetadataRoute } from "next";

// Next 16 + output:'export' requires metadata route handlers to opt into
// static rendering, or the build dies at "Collecting page data" (it names
// only the FIRST offending route, so a missing line here surfaces one
// failure at a time). Harmless on Next 15.
export const dynamic = "force-static";

// Split in two, because the difference decides visibility and is the single most
// misunderstood thing in AEO. Verified against each vendor's own bot documentation.
//
// LIVE-RETRIEVAL: fetches the page to answer a question NOW. Blocking any of these
// removes the business from that engine's answers. OpenAI's own docs: sites opted
// out of OAI-SearchBot "will not be shown in ChatGPT search answers".
const RETRIEVAL_CRAWLERS = [
  "Googlebot",                                          // AI Overviews / AI Mode ride the ORDINARY Google index
  "Bingbot",                                            // the Bing index is what Copilot and ChatGPT search ground on
  "OAI-SearchBot", "ChatGPT-User",                      // OpenAI
  "PerplexityBot", "Perplexity-User",                   // Perplexity
  "Claude-User", "Claude-SearchBot",                    // Anthropic
  "Applebot",                                           // Siri / Spotlight / Safari
];

// TRAINING: governs whether the text may be used to train a model. Allowed
// deliberately — a local business gains from being in the weights and loses nothing.
const TRAINING_CRAWLERS = [
  "GPTBot", "ClaudeBot", "Google-Extended",
  "Applebot-Extended", "meta-externalagent", "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: RETRIEVAL_CRAWLERS, allow: "/" },     // CMS/booking client? add disallow: ["/admin"] to EVERY rule, not just the wildcard
      { userAgent: TRAINING_CRAWLERS, allow: "/" },
      { userAgent: "*", allow: "/" },
    ],
    sitemap: "<BASE_URL>/sitemap.xml",
  };
}
```

**Two corrections to widely-repeated folklore, both load-bearing here.** (a) Blocking `Google-Extended` does **not** remove a site from AI Overviews or AI Mode — Google's own AI-features doc says robots.txt for *Googlebot* is the control, and Google-Extended governs Gemini training and grounding elsewhere. (b) `Applebot-Extended` does not crawl at all; it only governs use of what `Applebot` already fetched, so blocking it never affects search inclusion. Neither is a reason to block anything, but getting this backwards is how a site gets quietly removed from ChatGPT.

2. **`src/app/sitemap.ts`** — one entry per real page. **Enumerate the routes from the build, never from memory:** `find src/app -name 'page.tsx' -not -path '*/admin/*'` is the source of truth, so a site with extra rescue-parity routes gets them listed and a site that dropped a route does not get a sitemap entry 404ing. Standard build = `/`, `/services`, `/about`, `/contact`, `/blog` and one entry per article under `/blog/<slug>`, plus `/privacy` and `/terms` (both ship on every build — `/build` § Legal pages); booking-enabled clients also `/book`; **never `/admin`** or any route under it. Generate the article entries from `_components/blog-data.ts` (`POSTS`) rather than typing them, and give each article its own `lastModified` from its `published` date instead of the go-live date, so a later post does not inherit a stale stamp. `lastModified` = the go-live date — genuinely accurate today, and it only ever moves with real content changes. No `priority`, no `changeFrequency`:

```ts
import type { MetadataRoute } from "next";

export const dynamic = "force-static"; // Next 16 static-export requirement, same as robots.ts

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("<go-live date YYYY-MM-DD>");
  return [
    { url: "<BASE_URL>", lastModified },
    { url: "<BASE_URL>/services", lastModified },
    { url: "<BASE_URL>/about", lastModified },
    { url: "<BASE_URL>/contact", lastModified },
    // ...one line per additional real route this client actually has
  ];
}
```

The `sitemap:` line in robots.txt doubles as the zero-credential submission path — crawlers discover it there without any webmaster account.

3. **IndexNow key file** — one key per client site, generated once and kept for the life of the site. **Never reuse another site's key** (Gray Reserve's own `grayreserve.com` key included): IndexNow's only ownership proof is that `<key>.txt` is served from the submitting host, so a borrowed key means the submission is never verified.

The key is stored in `clients/$ARGUMENTS/data/indexnow-key`, **not** held in a shell variable: `data/` survives `/build`'s `rm -rf .../site`, and each bash call here is a fresh shell, so a variable set in this step is empty by Steps 6 and 9 (which sends `"key":""` and gets a real `400 InvalidRequestParameters` back). Re-derive it from the file in every later step:

```bash
KEYFILE=clients/$ARGUMENTS/data/indexnow-key
test -s "$KEYFILE" || openssl rand -hex 16 | tr -d '\n' > "$KEYFILE"   # generate once, reuse forever
INDEXNOW_KEY=$(cat "$KEYFILE")
printf '%s' "$INDEXNOW_KEY" > "clients/$ARGUMENTS/site/public/$INDEXNOW_KEY.txt"
```

4. **`llms.txt`** — generated from the same facts object as the schema and the rendered NAP, never hand-typed, so it cannot drift from the site it describes. On a static export, `src/app/llms.txt/route.ts` with `export const dynamic = "force-static"` emits it at `/llms.txt`; a literal `public/llms.txt` also works but goes stale silently.

   The llmstxt.org shape, in this order — an `# <Business Name>` H1, a `> ` blockquote summary, then `##` sections:

   ```markdown
   # <Business Name>

   > <one sentence: trade, town, what they do, how long>

   ## Key facts
   - Trade / Based in / Serving (every town) / Phone + hours / Postal address / Licence / Trading since

   ## Services
   - <one line per service actually offered>

   ## Key pages
   - [Home](<BASE_URL>/)          ← markdown links, one per real route
   - [Services](<BASE_URL>/services)

   ## Answers to common questions
   - **<question>** <answer>       ← the same Q&As as Step 4, verbatim

   ## Notes for assistants
   <what must NOT be invented: prices they don't publish, hours, a rating they don't have>
   ```

   **The "Notes for assistants" block is the part that earns its place.** It is the only surface where we can state, in plain language a model reads, that this business publishes no prices and has no star rating — which is the actual failure mode when an assistant is asked about a small business and helpfully fabricates a number.

   > **Be honest about what this file is worth.** No major answer engine has committed to reading `llms.txt`; Google's John Mueller has said flatly that no AI system currently uses it and that server logs show the bots do not even request it. It ships because it is generated free from facts we already hold, it is a genuinely useful plain-text summary for any human or agent that does fetch it, and adoption would find us already compliant. **It is not a ranking lever and must never be sold as one.** If a link in it 404s it is worse than useless — `aeo-check` verifies every link resolves to a real route.

## Step 6 — Build and prove it locally

**Check the site's shape first** — a `/cms`, `/booking`, or rating install removes `output: 'export'`, and a server-shaped build produces `.next/`, not `out/`:

```bash
cd clients/$ARGUMENTS/site
grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs && echo "static export" || echo "server-shaped"
```

- **Static export** (the default): run the block below as written.
- **Server-shaped:** `npx next build` still validates everything compiles, but there is no `out/` — skip the `out/` file asserts. If the home page is prerendered (booking/rating installs), run the grep/python checks against `.next/server/app/index.html`; a **CMS install makes the home page force-dynamic, so that file won't exist** — for those, check the served page instead (`npx next start -p 3113 &`, run the greps against `curl -s localhost:3113`, then kill it) or defer entirely to Step 8's live checks, which cover every file-serving assert after deploy.

```bash
npm install
rm -rf out
npx next build
test -f out/index.html || { echo "build produced no site — STOP"; }
test -f out/sitemap.xml && test -f out/robots.txt || echo "sitemap/robots missing from out/ — STOP and fix"
test -f out/manifest.webmanifest || echo "manifest missing — STOP and fix"
INDEXNOW_KEY=$(cat ../../../clients/$ARGUMENTS/data/indexnow-key)   # fresh shell: re-read, never assume the Step 5 variable survived
test -f "out/$INDEXNOW_KEY.txt" || echo "IndexNow key file missing — STOP and fix"
test -f out/llms.txt || echo "llms.txt missing — STOP and fix"
test -f out/og.jpg || echo "og image missing — STOP and fix"
grep -q 'rel="canonical"' out/index.html || echo "canonical tag missing — STOP and fix"
grep -q 'application/ld+json' out/index.html || echo "JSON-LD missing — STOP and fix"
grep -q 'og:image' out/index.html || echo "og:image missing — STOP and fix"
grep -q 'name="viewport"' out/index.html || echo "viewport meta missing — STOP and fix"
grep -qi 'noindex' out/index.html && echo "NOINDEX PRESENT — the site would be invisible. STOP and fix Step 2."
```

Then three deeper checks:

1. **The JSON-LD must parse** — extract and validate rather than eyeballing:
   ```bash
   python3 -c "
   import json, re
   html = open('out/index.html').read()
   blocks = re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.S)
   assert blocks, 'no JSON-LD block found'
   for b in blocks: json.loads(b.replace('\\\\u003c','<'))
   print(f'JSON-LD OK ({len(blocks)} block(s))')"
   ```
2. **NAP must match between page text and schema:** grep the built HTML for the exact street address as it appears in the JSON-LD, and for the displayed (national-format) phone number. An address mismatch (e.g. "St." on the page, "Street" in the schema) fails the cross-check engines run; fix whichever side diverges from the Google listing. (The schema `telephone` is E.164, so don't expect that exact string in the visible text — the `tel:` href carries it.)
3. **The content is really in the HTML** (AI crawlers don't run JavaScript): grep `out/index.html` for the business name, one service phrase, one FAQ question, and the phone number.

   ⚠️ **A bare grep of the file is a false green.** Next embeds the RSC flight payload in `<script>` tags, so `grep -q "$PHONE" out/index.html` passes even when the phone number exists *only* inside a script a crawler never executes. The grep is a first pass, not the proof.

4. **Run the AEO gate — this is the real one.** From the repo root:

   ```bash
   node scripts/aeo-check.mjs clients/$ARGUMENTS/site
   ```

   It must print `AEO_CHECK=PASS`. Every text assertion it makes is against HTML with `<script>`, `<style>`, `<template>` and `<noscript>` stripped, which is what separates "in the page" from "in the payload". It checks: the entity graph parses and resolves (one business `@id` across every route, per-page `WebPage` `@id`s, no dangling `@id` edges, no empty-string properties, `sameAs` and `areaServed` present); every FAQ question is a rendered heading and every answer is in the visible text; NAP appears on every route and matches the schema (including a guard against truncated street addresses); `llms.txt` matches the llmstxt.org shape and every link resolves to a real route; the sitemap covers exactly the built routes; no live-retrieval crawler is blocked; no page is `noindex`.

   `--json` gives a machine-readable report. `--url https://…` runs the same checks against the live site after Step 7, which is the only way to see the host's clean-URL behaviour.

   **It proves structure and extractability. It cannot prove a citation, and no report may say otherwise.**

5. **Validate the schema against the real vocabulary**, not just as JSON — a typo'd property name parses fine and means nothing:

   ```bash
   curl -sL https://schema.org/version/latest/schemaorg-current-https.jsonld -o /tmp/schemaorg.jsonld
   ```

   then check every `@type` and property used in the emitted JSON-LD exists in that vocabulary. Google's Rich Results Test (`search.google.com/test/rich-results`) and `validator.schema.org` are the live-URL equivalents and belong in the Step 10 handover — they need a public URL, which is why the vocabulary check runs here and they run after deploy.

## Step 7 — Deploy

Invoke `/deploy $ARGUMENTS` — don't hand-roll deploy commands. It handles all three hosts, re-verifies the project link, and records the URL.

## Step 8 — Verify live (including the host canonicalisation)

```bash
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/")" = "200" || echo "HOMEPAGE BROKEN — investigate"
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/robots.txt")" = "200" || echo "robots.txt not serving"
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/sitemap.xml")" = "200" || echo "sitemap.xml not serving"
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/manifest.webmanifest")" = "200" || echo "manifest not serving"
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/llms.txt")" = "200" || echo "llms.txt not serving"
curl -sSL "$BASE_URL/" | grep -q 'application/ld+json' || echo "JSON-LD not on the live page"
curl -sSL "$BASE_URL/" | grep -qi 'noindex' && echo "LIVE SITE IS NOINDEX — fix and redeploy NOW"
```

**Custom domains only — prove one host wins.** A canonical tag is a hint; a 301 is an answer. Both the alternate host form and plain HTTP must redirect to `BASE_URL`:

```bash
HOST=$(printf '%s' "$BASE_URL" | sed 's|https://||')
case "$HOST" in www.*) ALT="${HOST#www.}";; *) ALT="www.$HOST";; esac
echo "http→https:"; curl -sI "http://$HOST/" | head -1        # expect 301/308
echo "alt host:";   curl -sI "https://$ALT/" -o /dev/null -w '%{http_code} → %{redirect_url}\n'   # expect 301/308 → $BASE_URL/
```

- If the alternate host **serves 200** (duplicate-site split): fix at the host — Vercel: Project → Settings → Domains → add both forms and mark the preferred one so the other redirects; Cloudflare Pages: attach the preferred host and add a Redirect Rule for the other; Netlify: set the preferred form as the *primary domain* (Netlify then 301s the rest automatically). Re-verify.
- If the alternate host **doesn't resolve** (no DNS record): tell the operator to add it at the registrar and set the redirect as above — a dead `www.` looks broken to anyone who types it. Not a blocker; note it in `seo.md` + the handover.
- Also sanity-check the served URL form matches the canonical exactly (scheme, host, trailing slash) — `curl -s "$BASE_URL/" | grep 'rel="canonical"'`.

## Step 9 — Push to the search engines (IndexNow)

One POST notifies Bing, Yandex, Naver, Seznam, and Yep — no webmaster account needed. (Google doesn't participate in IndexNow; it's covered by the robots.txt sitemap line now and Search Console in the handover checklist.)

```bash
# Shell expansion, NOT sed: BSD sed (macOS) has no `\?` in BRE, so the old
# `sed 's|https\?://||; s|/.*||'` left HOST as the literal "https:" and the POST
# below came back 400 "URL is not valid url." Verified on macOS 2026-08-15.
HOST=${BASE_URL#*://}; HOST=${HOST%%/*}
INDEXNOW_KEY=$(cat clients/$ARGUMENTS/data/indexnow-key)   # fresh shell: re-read the persisted key, see Step 5
test -n "$INDEXNOW_KEY" || echo "no IndexNow key — go back to Step 5 (an empty key is a hard 400)"
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/$INDEXNOW_KEY.txt")" = "200" \
  || echo "key file not serving at $BASE_URL/$INDEXNOW_KEY.txt — the submission below will never verify"
curl -sS -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"$HOST\",\"key\":\"$INDEXNOW_KEY\",\"keyLocation\":\"$BASE_URL/$INDEXNOW_KEY.txt\",\"urlList\":[\"$BASE_URL/\"]}" \
  -o /dev/null -w 'IndexNow HTTP %{http_code}\n'
```

Measured against the live endpoint on 2026-08-15, the codes mean different things and only one of them is clean:

- `200` — accepted **and the key was verified** against the key file. This is the success case.
- `202` — accepted, **key validation still pending**. A wrong or unserved key returns 202 too (verified: a deliberately bogus key on a real host got 202, not an error), so 202 is not proof of anything. Treat it as "re-check that `$BASE_URL/<key>.txt` serves 200", which the pre-flight above already does.
- `400 InvalidRequestParameters` (`"The key field is required."`) — the key was empty, i.e. the Step 5 variable didn't survive into this shell. Re-read the key from `clients/$ARGUMENTS/data/indexnow-key`.

Anything else: re-check the key file and retry once; if it still fails, note it in `seo.md` and continue — it's a notification, not a gate. (Accepted means "notified", not "indexed" — engines still crawl on their own schedule, typically days for a new small-business domain. And IndexNow is Bing, Yandex, Naver, Seznam and Yep only: **Google does not participate**, so the sitemap plus Search Console in the handover remains the entire Google story.)

## Step 10 — Record + handover

1. Write `clients/$ARGUMENTS/data/seo.md`: the canonical URL and preferred host, the subtype chosen, what was added (metadata/icons/manifest/entity graph/FAQ/robots/sitemap), the go-live date used for `datePublished`/`dateModified`/`lastModified`, the IndexNow key + submission result, the UTM URL from item 3 below, and anything skipped (e.g. `geo` unresolved, `www` DNS missing). Remove the `seo-in-progress` marker.
2. Append one line to `clients/$ARGUMENTS/data/status.md`: `SEO go-live applied <date> — canonical <BASE_URL>, IndexNow submitted`.
3. **Give the operator the handover checklist** — the steps that sit behind account sign-ins. Offer to drive the browser-based ones yourself (operator signs in, you do the clicking):
   - **Google Search Console** (~5 min, operator's or owner's Google account): add `<BASE_URL>` as a domain property, verify via the DNS TXT record it shows (at the registrar), then Sitemaps → submit `sitemap.xml`. The only way to request Google indexing directly, and the only place to see what searches the site appears for. While there, paste the URL into search.google.com/test/rich-results to confirm the LocalBusiness markup is read.
   - **Bing Webmaster Tools + Bing Places** (~5 min): at bing.com/webmasters, "Import from Google Search Console" makes verification one click; submit the sitemap. This matters beyond Bing itself — **Bing's index is ChatGPT Search's retrieval layer**, and BWT's AI Performance report shows how often Copilot/Bing AI actually cite the site. Then claim the business at Bing Places (bingplaces.com) so the listing data flows into the Microsoft/ChatGPT ecosystem.
   - **Google Business Profile website field:** when the owner adds the site to their Google listing, give them this exact URL so their profile traffic is measurable in analytics: `<BASE_URL>/?utm_source=google&utm_medium=organic&utm_campaign=gbp` (all lowercase; it must serve 200 directly — never a redirecting form, which would strip the tags). The name/address/phone on the site must match the listing character-for-character.
   - **Off-site presence — this is the bigger half, and it is not optional.** Ahrefs' 75,000-brand study found AI-mention correlation of ~0.66 for branded web mentions and ~0.53 for branded anchors, against ~0.22 for referring domains and ~0.19 for content volume. Everything this skill does is the necessary on-site half; being talked about elsewhere is the other half and it moves more. Concretely: consistent name/address/phone across review platforms, local directories, chamber listings and local press. **Yelp specifically became a first-class AEO surface in July 2026**, when OpenAI licensed Yelp's reviews, ratings and photos into ChatGPT along with a request-a-quote flow — a complete Yelp profile is now a direct input to a ChatGPT local answer, which is unusually concrete for this field. (Once there is real third-party coverage to cite, a Wikidata entry linked via `sameAs` is the strongest entity signal going.)
   - **The legal pages now have a real owner — get them read.** `/build` § Legal pages ships `/privacy` and `/terms` on every site, written from what that site actually does and deliberately silent on anything that could not be sourced (no refund terms, no guarantees, no registration number, no jurisdiction beyond their own state). Until conversion nobody has reviewed them. Tell the owner in one line: these were drafted from their published details, they should read both, and anything they want added — refunds, cancellation, a company number, an insurance line — goes in now that they can confirm it. Do not fill those gaps for them.
   - **The only real citation telemetry, and its limits.** Set expectations with these three, and nothing beyond them:
     - **Server / edge logs** showing a named retrieval bot (`OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `Claude-User`) fetched a specific URL, verified against the vendors' published bot IP lists (`openai.com/searchbot.json`, `claude.com/crawling/bots.json`). This is the strongest evidence that exists.
     - **`utm_source=chatgpt.com` referral sessions** — ChatGPT appends it to citation links, and GA4 has an "AI Assistant" channel. It is a **floor, never a total**: most AI-sourced sessions arrive with no referrer and land in Direct, and copy-paste visits are unrecoverable in principle.
     - **Search Console's Generative AI performance report** (launched June 2026, beta): impressions and pages for AI Overviews and AI Mode. **No clicks, no CTR, no query data**, and Google only.
     Third-party "AI visibility" scores are a measurement of that tool's sampled prompt set, not of reality. Do not quote one as a result.
4. Final message to the operator: confirm what's live, the selling line for the client — **"your site is now structured so the AI assistants can read it, are allowed to read it, and can pull clean facts about what you do and where you do it, and we can prove all three"**, which is true and provable, rather than "you'll show up in ChatGPT", which is neither — the checklist, and one honest expectation: first Google indexing typically takes days after the Search Console step, and the site's four pages rank for its own town — a business wanting to rank across many *other* towns eventually needs dedicated per-town pages, which is a real future project rather than a defect in what shipped. Do NOT tell the operator a client needs to buy `/services`, `/about` or `/contact`: those ship on every build.

## Rules

- **Truth only.** Every fact in the metadata, schema, FAQ, `llms.txt` and copy comes from `gathered-content.md` or the verified Places lookup. Missing fact → omit. Never invent hours, prices, coordinates, service areas, years trading, or any number.
- **Never promise a citation.** The claim is "structured so answer engines can extract and attribute it". Not "you will appear in ChatGPT", not a percentage, not a visibility score, not a timeline. There is no test that proves a citation and no honest way to guarantee one — and a business owner who was promised ChatGPT and did not get it is a refund and a reputation problem, not a renewal.
- **Rendered and marked up say the same words.** Anything in `FAQPage`, `sameAs`, `address` or `areaServed` that is not corroborated by the rendered page is invisible markup. `aeo-check` fails it; do not work around the gate by loosening the check.
- **Generate the schema, the NAP and `llms.txt` from ONE facts object.** Typing an address or phone number twice is how they end up disagreeing, and a disagreement is worse than either value alone.
- **Review markup is true or absent.** `aggregateRating` only from the live Places lookup at run time; `review` only verbatim from reviews the page displays. Never invented, never from memory, never a stale copy — and never promise the operator it earns Google stars (it doesn't; self-serving markup is ignored there).
- **Freshness dates never lie.** `dateModified` / sitemap `lastModified` move only with real content changes. A go-live stamp is truthful; a weekly bump is manipulation and Google ignores exactly that pattern.
- **Content edits must look native.** The FAQ and copy sharpening match the site's design system and `${OPERATOR_LANGUAGE}` conventions. If a change would look bolted-on, restyle it until it doesn't. No auto-generated "local content" essays — thin locality padding is doorway-page bait.
- **Don't add the dead stuff.** The "deliberately does NOT do" list at the top is a contract, not a suggestion.
- **Host-agnostic means don't touch the runtime.** Never remove `output: 'export'`, never add server code. If the site is already server-shaped (CMS/booking/rating installed earlier), everything here still works — leave the runtime exactly as you found it.
- **The canonical URL decision is load-bearing.** Wrong domain or host form in Step 0 = every tag wrong. When in doubt, ask the operator rather than guessing.
- **Never leave the site noindexed after reporting success** — the Step 6/8 greps are non-negotiable.
- If anything fails irrecoverably (deploy fails, canonical domain won't serve, build errors you can't fix), alert via `bash scripts/notify.sh "seo $ARGUMENTS: <reason>"` and stop rather than leaving the site half-optimised.

## § Maintenance (seo.md already exists)

- **Domain changed** (e.g. ran on the host URL, custom domain attached later — the common case): update `metadataBase`, every `@id`/`url` in the entity graph, `sitemap.ts`, `robots.ts`, and the UTM URL to the new domain; rebuild, redeploy, re-run the Step 8 host checks and the IndexNow POST with the new host; update `seo.md`. Remind the operator to add the new domain as a fresh Search Console + Bing Webmaster property.
- **The client got rebuilt.** `/build` does `rm -rf .../site`, wiping all of this. Re-run the whole skill after any rebuild + redeploy (`seo.md` survives in `data/`, so Step 0's gate routes you here — treat a rebuild as "apply again from Step 1").
- **Page content genuinely changed** (new photos, new services, price update): update `dateModified` + sitemap `lastModified` to the change date, rebuild, redeploy, re-POST IndexNow. This is the ONLY event that moves those dates.
- **A page was added** (e.g. `/book` via the booking skill): add the route to `sitemap.ts`, give it its own metadata title/description, rebuild, redeploy.
- **A new blog article was added** (the ${PRICING_MONTHLY} content promise, post-conversion): append it to `POSTS` in `_components/blog-data.ts` and nothing else. The sitemap entry, the `Blog` node's `blogPost` list, the `BlogPosting`, the `llms.txt` line and the index card all regenerate from that one array. Its `lastModified` and `datePublished` are the day it was actually written. Rebuild, redeploy, re-POST IndexNow with the new article URL in `urlList`.
- **Owner asks "why aren't we on Google yet":** check the Search Console step from the handover checklist actually happened — it's the usual missing piece. New domains typically take days to first indexing, longer to rank.
