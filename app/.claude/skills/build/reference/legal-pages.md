<!--
Split out of build/SKILL.md 2026-08-16 (Fable token-cost review). READ THIS IN FULL before
writing /privacy or /terms — this is not optional exposition, most of this file is the actual
requirement (the disclosure inventory table, the never-write list, the wiring checklist). It
moved out of the always-loaded core because legal-page writing happens at one specific point in
a build, not continuously, so it doesn't need to sit in context for the whole session — but when
you reach that point, read all of it. build/SKILL.md's core keeps the two-route mandate and the
never-write list verbatim as a floor in case this file is ever skipped; that is a safety net, not
a substitute for reading the real thing here.
-->

## Legal pages (MANDATORY — `/privacy` and `/terms` on every build)

**Jeff, 2026-08-16: "on every single build we need to port over our terms and conditions and privacy policy to be in the footer or sub footer, built for each site."** Both routes ship every time. The old conditional ("only if the contact form collects data") is what produced inconsistent coverage — one site with a privacy page, one with neither, and no site with terms at all.

**Then read the constraint that governs every word on them.** These pages make legal representations on behalf of a business that has not hired us, has not read them, and does not know they exist. So there are two failure modes and the second is the dangerous one:

- **Absent** — a site with a contact form and a chat widget and no policy reads unfinished, and it is the page an owner checks when they are deciding whether we did real work.
- **Boilerplate** — a generic policy reciting cookies, analytics, advertising partners, data retention periods and international transfers for a static site that does none of it. Every sentence of that is a false statement published under the business's name. It is worse than no page, because it is a liability we manufactured for them.

The rule that resolves both: **describe only what this specific site actually does, and omit anything you cannot source.** An omission is a gap the owner fills at conversion. A fabricated clause is theirs to defend.

### Step 1 — inventory what THIS build actually does (run the checks, don't recall them)

Run these against `clients/$ARGUMENTS/site/src` before writing a line. The answers differ per build, which is the whole point.

| Thing | Check | Disclose, if present | If absent |
|---|---|---|---|
| `mailto:` contact form | `grep -rn 'mailto:' src/app` | the form opens the visitor's own email program, and the message goes from there to the business's inbox — the website itself never receives or stores it | — |
| No-email stub form | `grep -rn 'preventDefault' src/app --exclude=SiteChat.tsx` | the form shows a confirmation but does not transmit or store anything yet | — |
| Chat assistant | `grep -n '<SiteChat' src/app/layout.tsx` | see § The chat widget below — it is the largest real disclosure on the site and the easiest to miss | say nothing about chat |
| Google Maps embed | `grep -rn 'output=embed' src/app` | the map is loaded from Google, so opening that page tells Google someone viewed it | say nothing about maps |
| Photos served by Google | `grep -rn 'lh3.googleusercontent' src/app` | fold into the same sentence as the map — some photos load from Google's servers | — |
| Booking facade | `grep -rn 'data-booking\|/book' src/app` | the booking steps run entirely in the visitor's browser and nothing is sent anywhere (build § Booking facade: zero network requests) | — |
| Analytics / pixels | `grep -rniE 'gtag\|googletagmanager\|fbq\|hotjar\|clarity\|plausible\|posthog' src/app` | **expect zero hits.** Zero means the honest line is that the site runs no analytics and no advertising trackers. A hit means your build added one — disclose it by name, or remove it | — |
| Cookies / storage | `grep -rn 'document.cookie\|localStorage\|sessionStorage' src/app` | **expect zero hits.** Zero means the site sets no cookies of its own; only the Google map iframe, if present, sets any | — |

**Fonts are not a third-party disclosure.** `next/font/google` self-hosts the woff2 into the build (§ Font), so no visitor request ever reaches Google Fonts. Writing that fonts are loaded from Google would be a false statement about this site.

### The chat widget — the disclosure nobody writes and every build needs

`SiteChat` ships on every site, and it is the only part of a static export that moves a visitor's words off the page. Verified 2026-08-16 by reading `services/site-chat/src` and `templates/trade-site/src/app/_components/SiteChat.tsx`:

- What the visitor types is POSTed to the shared chat service (`klaudius-site-chat.vercel.app`), with the last 12 messages of the conversation.
- The service writes the reply with a third-party AI model. **Name the provider only if you have confirmed it on this install** (`grep -n 'MODEL\|Anthropic' services/site-chat/src/app/api/chat/route.ts`); otherwise write "an AI service" and leave it there.
- **If the visitor gives a name plus a phone number or email in the chat, the assistant captures it as an enquiry and passes it on so someone can get back to them** (`capture_lead` in the same file). This is the one a visitor would actually want to know, and no boilerplate policy contains it.
- The visitor's IP address is used to rate-limit the endpoint. Conversations are not published, and there is no conversation database — but do not claim messages are "deleted immediately" either; you cannot source that.

Write it in three or four plain sentences under a heading a person would recognise ("The chat on this site"). Do not turn it into a sub-processor table.

### Step 2 — what goes on each page

Both pages: the business named rather than "we", real facts from `gathered-content.md` and `site-data.ts` only, and a closing block with the business name, phone and email. **That closing block is functional, not decorative** — `scripts/aeo-check.mjs` fails the whole build if the business name or phone is missing from the rendered text of *any* route, and these two routes are no exception.

Legal prose names the business far more often than marketing copy does, so **watch the sentence-final `{biz.name}.`** when the name itself ends in `Co.`, `Ltd.`, `Inc.` or `LLC.` — it renders "Marchetti & Sons Tile Co.." Caught on the scratch build in both a `<p>` and a `metadata.description`. End those sentences on another word.

`/privacy` — what the site does with a visitor's information, drawn entirely from the Step 1 inventory. Nothing else. Typically 250–450 words.

`/terms` — only what can be sourced:

- who runs the site: the trading or legal name from `gathered-content.md`, their town, and how to reach them;
- that the site is information about the business's services, and not a quote, a price or a contract;
- that an enquiry, a call or a chat is a request to be contacted — nothing is booked or agreed until the business confirms it;
- that hours, services and the area covered are as published at the time of writing and can change;
- **whose words and pictures these are, accurately.** The reviews are quoted verbatim from the business's public listing and belong to the people who wrote them; some photos are served from the business's Google listing. A blanket "all content on this site is the property of X" is false on a site built this way — do not write it;
  > **Each clause is conditional on what this build actually renders.** A site with no reviews section gets no reviews clause; a site whose photos are all hotlinked from Google does not claim the photographs. Caught on the 2026-08-16 scratch build: the first draft asserted "the reviews on this site are quoted word for word" on a page that displayed no reviews. That is the same manufactured-liability failure as a cookie clause on a cookieless site, just harder to spot — it reads correct because it is the sort of thing that is usually true.
- links to other sites are outside the business's control;
- a plain accuracy line: the business keeps the site accurate but does not promise it is free of errors;
- governing law **from their own address** — the state or country in `site-data.ts`, nothing more. Not Texas, not England, not the operator's jurisdiction. Never name a court or a venue.

Typically 300–500 words. `Last updated <build date>` on both.

### Never write these (each one is a fabricated legal fact)

Company registration number · VAT / EIN / tax number · a named data protection officer or privacy contact who is not the business's own published contact · a statutory rights recital (GDPR / UK-GDPR / CCPA article-by-article) · data retention periods · international transfer clauses · "we may share your data with trusted partners" · a cookie table or consent-banner language for cookies the site does not set · children's-privacy clauses · arbitration, class-action waiver, venue or jurisdiction beyond the business's own state · indemnities · a liability cap in money · prices, deposits, payment terms, refunds or cancellation windows · guarantees, warranties, response times or any service-level promise · insurance, licence or accreditation claims not in `gathered-content.md` · "your continued use constitutes acceptance".

**And one that reads harmless and is not:** never make a promise about what the business does with an enquiry *after* it reaches them ("we never sell your details", "we delete enquiries after 12 months"). You can describe the website's behaviour because you built it. You know nothing about theirs.

One line covers the whole class: **if you cannot point at the fact in `gathered-content.md`, in `site-data.ts`, or in code you have just read, it does not go on the page.**

### The review line

Both pages carry one plain sentence saying the page was written from the business's published details and inviting a correction. It reads as ordinary site copy, not an apology or a disclaimer box:

> This page was written from the details PowerWash-ington publishes about itself. If anything here needs changing, email trevinopowered@gmail.com and it will be updated.

Put it at the end, above the contact block. No "please note", no "we apologise", no italics-and-a-warning-triangle.

### Wiring (same invariants as every other route)

- `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`, one `<h1>` each ("Privacy" / "Terms"), own `metadata` with a distinct `title` and `description`, and **`alternates: { canonical: "/privacy" }` / `"/terms"`** — their own path, never the root's.
- Shared chrome: `<SiteNav />` and `<SiteFooter />`, exactly like every other page.
- Per-page `WebPage` node with the route's own `@id`, plus `BreadcrumbList` (§ AEO baseline). `noindex` is inherited from `layout.tsx` on spec builds — do not add or remove it here.
- **Footer links, both of them**, in the sub-footer row alongside the copyright. Never in `SiteNav`. The row already carries `data-chat-gutter`; keep it.
- **Add both routes to `src/app/sitemap.ts` and to the key-pages list in `llms.txt`** — `aeo-check` fails on a built route missing from the sitemap and warns on one missing from `llms.txt`.
- Register: `anti-ai-slop` applies to the human-readable prose. Legal text has its own register — plain, direct, short sentences — so do not make it chatty, and equally do not pad it. Every sentence says something the reader did not already know.

