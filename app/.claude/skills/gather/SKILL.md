---
name: gather
description: Collect content from public sources for a business - reviews, photos, contact info, services
argument-hint: [business-name]
allowed-tools: Bash(npx *), Bash(python3 *), Bash(curl *), Bash(mkdir *), Bash(node *), Read, Write, Glob, Grep
---

# Gather Content for $ARGUMENTS

Collect all public data for this business. Read `prompts/lessons/gather.md` before starting.

**IMPORTANT: NEVER use WebFetch for scraping.** It makes raw HTTP requests that get 403'd by most sites. Always use `npx playwright-cli` for visiting web pages - it runs a real browser that bypasses more protections. Use `curl` only for APIs (Google Places, etc.).

**Browser session hygiene.** playwright-cli sessions are global per machine and never self-close. Use a per-client named session for every playwright-cli command in this skill (`npx playwright-cli -s=gather-{slug} ...`, where `{slug}` is the client folder name, e.g. `gather-acme-roofing-leeds`) — the unnamed default collides with parallel pipeline children — and close it when gather ends, even on an early abort: `npx playwright-cli -s=gather-{slug} close`. A leaked session holds a headless browser (hundreds of MB) indefinitely.

**Do NOT translate gathered content.** Capture reviews, Instagram bios, Facebook posts, opening-hours strings, and owner names verbatim in whatever language the business actually publishes in — usually `${OPERATOR_LANGUAGE}` but not always (e.g. a German-speaking business in South Tyrol that an Italian operator targets). The build step writes the site in `${OPERATOR_LANGUAGE}` directly, but quotes / reviews / proper nouns lifted from gathered content stay in their source language for authenticity. Never back-translate at gather time — it forces a re-translation at build time and produces strictly worse output.

## Coverage checklist
- [ ] Identity: name, category, tagline/description
- [ ] Services/menu: specific offerings with descriptions
- [ ] Testimonials: 3-5 real customer quotes with names AND verified OVERALL star rating (4+ stars). Never treat aggregator sub-scores (e.g. "Food: 5/5" on Restaurant Guru or TripAdvisor) as overall ratings — they often hide a low overall star count. Use `places-reviews.js` as the primary source (returns verified overall rating). Skip any review whose overall star rating cannot be confirmed.
- [ ] About: owner name, story, qualifications, years in business
- [ ] Contact: phone, email, address, full opening hours
- [ ] Photos: 3+ real images (ACTUAL URLs, not descriptions)
- [ ] Location: embeddable map data, service area
- [ ] Credibility: ratings, awards, accreditations
- [ ] Brand: logo + brand colours from Facebook/Instagram (see Social harvest)

## Step 0: Website check (do this BEFORE anything else)

The Google Places API only checks if a website is linked on the Maps listing. Many businesses have a website but haven't added it to Google Maps. **You must verify the business doesn't actually have a live website before gathering.**

### 0a: Web search for existing website

This is the single most reliable check. Search for the business by name and look for their own domain in the results:
```bash
node scripts/ddg-search.js "\"BUSINESS NAME\" LOCATION"
```
Scan every result URL. If any result points to a domain that isn't a directory or aggregator (Facebook, Google, Yelp, the country's well-known business directories, review aggregators) and looks like it could be the business's own site, curl it and check.

**Why this matters:** Businesses with long names often register shortened domains (e.g. "Northern Window Cleaning Services" might own `northernwindowcleaning.com` or the equivalent on the country TLD). Domain guessing can't reliably predict these, but search engines index them.

### 0b: Domain variation checks

Also check obvious domain variations with curl. Try `.com` plus the country-code TLD for the business's country — `.co.uk` (UK), `.de` (Germany), `.fr` (France), `.com.au` (Australia), `.ca` (Canada), `.ie` (Ireland), and so on. Infer the country from the business's location or the Places API's `addressComponents`:

```bash
curl -sIL -o /dev/null -w "%{http_code}" "https://BUSINESSNAME.com"
curl -sIL -o /dev/null -w "%{http_code}" "https://BUSINESSNAME.<country-tld>"
```

**Once you've generated the full variation list below** (spaces-removed, hyphenated, truncated, brand+TLD-suffix, brand+city — can run to 10-16 URLs), check them all in ONE Bash call backgrounded with `&` + `wait` rather than one curl per tool call (Fable consult, 2026-08-18 — same pattern shipped for find's search sweep and deploy's route check). They're independent HEAD requests against domains that mostly don't exist; no reason to pay a separate turn for each.

Also check the domain of any email address found (contact@X → check https://X). And when you pull the Google photos later, glance at any shopfront/window shot for a web address painted on the signage — businesses advertise domains on the shop that never made it onto their Google listing; if one appears, curl it before proceeding.

Try variations (against both `.com` and the country TLD):
- Remove spaces/hyphens: "The Barbers Club" -> barbersclub.com, thebarbersclub.com
- **ADD hyphens between the words too**: "Beauty and the Blade" -> beauty-and-the-blade.co.uk. Hyphenated registrations hide from un-hyphenated guesses and from name searches.
- **Drop trailing generic words** (cleaning, services, solutions, group, ltd): "Northern Window Cleaning Services" -> northernwindowcleaning.com
- **Drop filler words** (and, the, of): "Salt and Pepper Grill" -> saltpeppergrill.com
- **Try initials/abbreviations** for long names: "Northern Window Cleaning Services" -> nwcs.com
- **Brand + country-code suffix** (common in Eastern Europe, the DACH region, and other markets where the bare `.com` is often taken): "Famoza" -> famoza-bg.com, famoza-bg.bg; "Schmidt Bau" -> schmidtbau-de.com, schmidtbau-at.com. Use the 2-letter ISO code for the business's country. Also try the lowercase language code as the suffix (`famoza-pl.com` for a Polish business) since some businesses use the language rather than the country.
- **Brand + city suffix** (common when a brand operates regionally): "Famoza" in Sofia -> famoza-sofia.com; "Acme" in Berlin -> acme-berlin.de.

For businesses with 4+ words in the name, always try at least one truncated variation.

### 0c: Verify any hits

**If any return a 200 or 301**, check whether the site actually belongs to the business:
```bash
curl -sL "https://DOMAIN" | head -c 3000
```
Look for the business name, location, phone number, or services that match. Ignore domain parking pages, unrelated businesses, or generic registrar placeholders.

**If the site is a real website belonging to this business, STOP.** Update Supabase status to `rejected`: `python3 -c "from scripts.db import set_rejected; set_rejected('SLUG', 'has website at domain.com')"`, and move on to the next candidate.

**Rescue leads are the exception.** If this client's `extra.mode` is `rescue` (status.md or Supabase), a live-but-bad website is the premise, not a disqualifier — skip the STOP unless the site turns out to be genuinely fine (re-run `node scripts/site-check.js "URL"` if unsure; verdict `ok` means the premise is gone, reject as usual). Capture the existing site as a first-class source — their own published copy is the top-priority content source for the rebuild. The site's *problems* (the recorded signals) feed only the outreach observation — never any copy on the new site. Dead/parked sites have nothing to capture: note that and gather the classic way. When the old site serves real content (`curl -k` when the cert is broken):

- **Enumerate ALL pages** via sitemap + nav crawl (cheap — always complete), then **capture up to 15 pages by priority**: services/prices → contact/hours (including exceptions like late nights or seasonal closures — exceptions are what gets dropped) → about/history → regulated/legal → proof (prizes, awards, press, testimonials) → blog/news last. Record captured pages verbatim into gathered-content.md — services and prices, about/owner copy, published credentials, emails and phone numbers.
- **Classify every old-site photo genuine vs stock, defaulting to stock.** Reuse only with positive evidence it's the business's own — their premises/people/work in a same-domain original, or a match with their Google/social photos; "can't tell" = stock. Record stock photos as present but NEVER reusable — the licence belongs to the old site's arrangement, not ours. If the old site's photos are all stock, the classic photo sources above carry the build; if nothing genuine exists anywhere, the existing no-photos discipline applies (note it, never fake).
- **Write `clients/$ARGUMENTS/data/parity-checklist.md`** — the completeness contract `/build` and QA enforce via `node scripts/parity-check.js`. One atom per line:
  - `TEXT: <short distinctive literal string>` — 1-3 anchors per captured page, plus EXHAUSTIVE rows for: prices; regulated/legal blocks (full verbatim strings); proper-noun lists (staff, brands, guarantees, accreditations); history/timeline facts (founding year, renames, ownership); proof content; affiliated entities/brands the site names.
  - `ASSET: <path-or-filename>` — every PDF/download. Download each to `data/docs/`; ship verbatim with original URL paths preserved — never re-render official documents.
  - `UNCAPTURED: <url> — <title>` — every enumerated-but-not-captured page. The capture cap is fine; silent truncation is not.
  - `WAIVED: <atom> — <reason>` — anything deliberately dropped.

(Related non-exception: a Google-listed URL that `booking-check.js` classes `unclaimed_or_directory` or `social_as_website` is NOT a real website — never STOP on one of those; the lead proceeds under classic rules.)

**Booking leads (`extra.mode` = `booking`) are the other exception.** A `golden_check` lead's "website" is its booking-platform page — that page is the premise AND the top-priority content source, not a disqualifier. (If a real owned website surfaces during gather, the premise is gone: re-run `node scripts/booking-check.js "URL"`, and reject as usual on `not_booking_platform`.) Capture from the platform page, verbatim:
- **The full service menu** — every service name, price, and duration exactly as published. This feeds the build's booking facade, so completeness matters; don't sample.
- Opening hours, staff names IF published, about/bio copy, photos policy per the normal rules (only what the business itself published).
- **The platform review count, labelled by platform** — record "4.9★ from 212 reviews on Fresha" as its own line, never merged into the Google review figures. Per-platform counts are never conflated anywhere downstream.
- **Disclosure granularity**: booking platforms often show area-only locations for home-based/mobile businesses. Record exactly the granularity THEY publish (area vs full street address) and mark it — the build must never publish a more precise address than the business itself does.

Fetch the page with the normal tools (`curl`, playwright fallback for JS-heavy pages); there are no per-platform scraper scripts.

`square.site` special case: Square Online websites and Square booking pages share that namespace. If the page turns out to be a full multi-page website rather than a booking page, the premise is has-website — reject as usual.

## Step 1: Start with Google Places + the Step 0a search output

Google Places (`places-reviews.js`) is the universal default and gives you most of what the build step needs in one call — 5 reviews with original-language text (`originalText` field for non-English), opening hours, rating, total review count, phone, address. Combined with the Step 0a `ddg-search.js` output (which surfaces the business's social media presence, directory listings, and any non-Google review aggregators alongside the website check), this is usually 80%+ of what's required.

Then only visit individual sites for what's still missing — typically: Google Maps for photos via `places-photos.js`, Instagram via `instagram-profile.js`, Facebook via `fb-page.js`, plus any country-specific review aggregator or business registry that's relevant to the target country (see Tier 3 below). Skip a per-source visit if Step 0a's snippet already gave you the data point.

## "Good enough" gate — stop gathering when you have enough

After `places-reviews.js` + photo extraction (and any country-specific aggregator you needed to visit), check if you have:
- Name, address, phone ✓
- Rating and approximate review count ✓
- At least 1 working photo URL in gathered-content.md ✓
- At least 1 review quote ✓
- Hours (from Google Maps, Fresha, or Apple Maps) ✓
- **Email-only installs** (`OUTREACH_ENABLED=true`, `OUTREACH_PRIORITY=email`): a contact email ✓ — if none surfaced, spend up to 2 extra lookups, no more (`fb-page.js --brief` on their Facebook; for rescue leads the captured site's contact/impressum page) and record it in the client row. If both fail: FB/IG present → proceed (manual-DM lane); neither → note it in status.md and stop, /build will refuse this client. Never guess one.

If yes, that is enough to build. Do NOT visit 5 more sites hunting for extra data. Move on to the build step.

**The photo requirement is NOT optional.** A site with zero photos looks like a generic template and kills credibility with the business owner. Before marking gather as complete, confirm that gathered-content.md contains at least one actual image URL (not just "Facebook has photos of completed work"). If you haven't got a photo URL yet, work this zero-photo fallback ladder before moving on:
1. Visit Google Maps listing with `npx playwright-cli -s=gather-{slug}`, extract `lh3.googleusercontent.com` URLs from `<img>` tags
2. Restaurant Guru (food businesses), or any country-specific Google-Maps-mirror you know works there (e.g. CityMaps.uk for the UK)
3. Check Facebook page for photos
4. **Street View exterior (last resort).** When `places-photos.js` reports `NO PLACES PHOTOS`, the Maps listing usually still shows a cover image — a Street View fallback served from `streetviewpixels-pa.googleapis.com`, so step 1's lh3 filter misses it and the Places API never returns it. Extract that URL, download it, and apply the Street View rules under "Other photo sources" below (shopfront with signage only, never home-based businesses).
If a business genuinely has zero extractable photos anywhere online, note this explicitly in gathered-content.md so the build step knows to use a design that doesn't depend on photos.

### 🚨 PHOTO VISION GATE — Read every photo before you keep it (MANDATORY, added 2026-08-16)

**Count is not quality. Look at each one.** Every photo you download to `data/images/` must be
opened with the Read tool and judged on what it actually DEPICTS, exactly as § Logo already
requires for the logo. There is no script for this and there cannot be one — it is a content
judgement, and it is the single highest-consequence check in this skill.

**Why this exists, and it is not hypothetical.** On 2026-08-16 the Abacus Plumbing build shipped
`gmaps5.jpg` — **a photograph of two people in horror-clown makeup with blood-spattered hands and
sharpened teeth** — onto the HOME PAGE and into a blog article of a Houston plumbing company. It
survived gather, survived the build's photo pre-check (which only counts URLs), and was caught only
by the second QA round, 90 minutes in, after fourteen routes had been written around it. Had QA
round 1 passed, that image goes to a real business owner under Gray Reserve's name.

Google Maps photos are **customer-uploaded**. They are not curated, not verified, and frequently
have nothing to do with the business: Halloween events, someone's pet, a screenshot, a meme, a
receipt, an unrelated venue, occasionally something genuinely offensive.

**For each downloaded photo, Read it and classify:**

- **KEEP** — depicts the business, its premises, its people at work, its completed work, its
  vehicles or signage. This is what the site is for.
- **KEEP, ROLE-LIMITED** — real but weak: a dark interior, a blurry phone snap, a close-up of one
  fitting. Usable as a small supporting image, never as the hero. Note the limitation next to the
  photo in `gathered-content.md`.
- **REJECT** — anything else. Delete the file from `data/images/` immediately. Do not keep it "in
  case", because a file in that directory WILL be copied into `site/public/images/` and used.

**REJECT on sight, no deliberation:** costumes, makeup, gore, horror imagery; people who are not
plausibly staff or customers of this trade; pets; memes, screenshots, receipts, menus of other
businesses; anything sexual, political, violent or otherwise off-brand; any image you would not
personally defend to the owner if they asked "why is this on my website?"

**The tie-breaker is the owner's reaction, not yours.** If you are weighing whether an image is
"probably fine", it is not. A site with three good photos is worth far more than one with six where
one is wrong — the wrong one is all the owner will see, and it costs the lead outright.

**Then record the count you actually kept** in `gathered-content.md`. If rejections drop you below
one usable photo, you are back at the zero-photo ladder above — work it. **Never keep a bad photo
to satisfy the photo requirement.** The requirement exists so the site looks real; a horror clown
does not satisfy it.

If the web search and aggregator visits turn up almost nothing (no review aggregator listings, no social media, no directory pages), the business has thin online presence. Accept it, gather what exists, and proceed to build quickly. A site with 1 photo and 1 review is better than wasting 15 tool calls chasing 404s.

## Source priority

**Tier 1 — Universal (work in every country, always check):**
1. **Google Maps / Places API** — Name, address, phone, category, rating, photos, attributes. Use `places-photos.js` for photos and `places-reviews.js` for the 5 verified reviews available via the API in one call. **Headless browsers only ever get Google's "limited view" for reviews — don't scrape Maps for review text, use `places-reviews.js`** (full context in `prompts/lessons/gather.md`). Use Google Maps directly only for: rating (stars), address, photos, and confirming no website is linked. `places-reviews.js` returns each review as BOTH `originalText` (+ `originalLanguage`, the customer's own words) and `text` (translated to the site language) — record the **`originalText`** quote in gathered-content.md so the site shows the authentic review, never Google's translation, which mangles meaning. It also returns the business's opening **hours** (`weekdayDescriptions`), so you get phone, hours and reviews from this one call.
2. **Web search** (`ddg-search.js`) — Discovery engine for Facebook, Instagram, directory pages, and any non-Google review aggregator listings. Wraps the DuckDuckGo HTML lite endpoint (`html.duckduckgo.com/html/`); see CLAUDE.md "Known issues with headless browsing" for why the other engines don't work headless. It rate-limits on rapid second queries — keep search calls minimal per gather.
3. **Instagram** — Use the helper script: `node scripts/instagram-profile.js HANDLE`. It tries the REST API first, falls back to Patchright page scraping if rate limited. Returns bio, followers, posts, business email/phone, category, website. The email is often `unavailable` — treat as unknown, not "no email"; check Facebook or their website instead. Then use Playwright for post images.
4. **Apple Maps** — Structured hours, ratings, payment methods. Works globally.
5. **Facebook** — Bio, email, follower count visible without login.

**Tier 2 — Multi-country aggregators (use when the data type matches):**
6. **Restaurant Guru** — Reviews, hours, photos. Best for food businesses, internationally.
7. **Wanderlog** — Review texts with names and ratings; travel-tilted but covers many local businesses.
8. **TripAdvisor** — Global, biased toward hospitality. Useful for restaurants and tourism-adjacent businesses.

**Tier 3 — Country-specific (let the business's country guide you):**

Klaudius doesn't ship a curated per-country directory list — those go stale fast and we'd rather not push outdated guidance. Instead, identify the country from the Places API `addressComponents` (or the operator-supplied location) and use sources that genuinely operate there. The categories that almost always exist somewhere for any country:

- **Business directories / yellow-pages-style listings.** Phone numbers, addresses, sometimes emails. Examples — Yellow Pages + Yelp (US), Yell + ReviewBritain (UK), Gelbe Seiten (DE), PagesJaunes (FR), TrueLocal (AU), YellowPages.ca (CA), Goldenpages.ie (IE). Equivalents exist in most countries.
- **Public business registries.** Owner name, incorporation date, registered address. Examples — Companies House (UK), state Secretary of State filings (US), Handelsregister (DE), Société.com / Infogreffe (FR), ASIC (AU), Companies Registration Office (IE).
- **Industry-specific platforms.** Trades, beauty, food delivery — most countries have one or two dominant ones. Examples — HomeAdvisor / Angi / Houzz (US trades), TrustATrader / Checkatrade (UK trades), Booksy / Fresha / Treatwell (beauty, multi-country), Uber Eats / Deliveroo / DoorDash (food delivery).
- **Food / health regulators.** Only relevant for food businesses. Examples — ratings.food.gov.uk (UK), state health-department lookups (US), state food authorities (AU).

**If you don't already know what's locally appropriate**, do a quick `node scripts/ddg-search.js "best {industry} directories {country}"` or `"business registry {country}"` before guessing. Don't make up domains.

**Many of these sites are Cloudflare-blocked** for headless browsers regardless of country (Yell, Checkatrade, Yelp, etc. reject even Patchright). Don't waste tool calls retrying — record the failure in `prompts/lessons/gather.md` for next time, then move on.

**Build country-specific knowledge over time.** Record working sources, patterns, and access notes for the operator's country in `prompts/lessons/gather.md` as you learn them — the next gather run reads that file at the start and benefits from the accumulated map.

**Coverage matters, not volume.** Maximise coverage of what's available; don't skip a business for a small online presence (worked example + rationale in `prompts/lessons/gather.md`).

## Photos (CRITICAL - treat like testimonials)

**Always download photos to `clients/$ARGUMENTS/data/images/`** — never directly to `site/public/images/`. The build step copies the template into `site/` which overwrites anything already there. Photos in `data/images/` survive the template copy and get moved into the site during build.

For Google Maps photos, use:
```bash
node scripts/places-photos.js "BUSINESS NAME LOCATION" clients/$ARGUMENTS/data/images
```

Record each photo in `gathered-content.md` as `/images/gmaps1.jpg — 2048x2731 portrait`, using the on-disk numbers the script prints. `/build` reads only that file, so anything you leave out is lost. Never copy across a trailing `(source WxH)` — that resolution is not on disk.

**CRITICAL: handle the MISMATCH exit code.** Both `places-photos.js` and `places-reviews.js` request the top 5 Places API results, then auto-pick the first one whose `displayName` actually matches the brand and industry of your query (so when Google ranks "MA Automotive" at #1 but "M A GARAGE Walkley" at #2 for "M A Garage Sheffield", the script picks #2 with a `Note: picked result #2…` line on stderr — proceed normally). The script only exits with code 2 + `MISMATCH:` after scanning all 5 and finding none that match. That's a strong signal the business isn't on Google Maps under this name at all. **Do NOT proceed past a MISMATCH and do NOT retry with a slightly different query** — fuzzier queries just paper over the underlying problem and produce a site for the wrong business. Two correct responses:
1. Skip this candidate entirely. Mark them `unreachable` or move on to the next one in `/find`.
2. If you have very strong independent signals that the business exists on Maps under a different exact name (e.g. you found their Maps URL via the Step 0a web search), pass THAT exact name to the script.

Never paper over a MISMATCH by editing the gathered-content.md to look like the correct business. The CID, photos, reviews, address, and hours coming back from a mismatched search ALL belong to the wrong business — using any of them produces a site that's branded as Business A but visually represents Business B.

**Cross-check contact info against the Places listing.** Even when the script exits cleanly, sanity-check that the phone number / address / website URI returned by the Places API match the contact info you've sourced from other channels (Facebook, Instagram, web search). If Facebook lists one phone number and the Places API returns a different one for the same business, the most common explanation is that the two channels are tracking two DIFFERENT businesses with similar names — stop and investigate before continuing.

Gather as many real photos as possible. If the business has an Instagram, extract photos from it BEFORE moving to the build step. If Instagram extraction fails (rate limited, account private), fall back to Google Maps gallery and Restaurant Guru img02 photos. If a business genuinely has very few photos online, that's fine - build with what exists and use strong design elements to compensate.

**Instagram photos are important for barbers, beauty salons, and restaurants** — they show actual work (haircuts, nails, food) that Google Maps shopfront photos don't capture. For these industries, make a real effort to get Instagram photos.

Instagram photo extraction process:
1. First try: `node scripts/instagram-profile.js photos HANDLE OUTPUT_DIR` (uses Patchright, fastest)
2. If that fails: visit the profile page with `npx playwright-cli -s=gather-{slug}`, extract `/p/` post links (NOT `/reel/` — those are videos), then visit each post page individually and extract the `img` src
3. If the profile page shows "Something went wrong": wait 30 seconds and try once more. Instagram rate limiting is temporary.
4. If all automated methods fail: check if the profile is public. If so, note it in gathered-content.md as "Instagram photos available but extraction failed — manual download recommended" so the user can grab them.
5. Only skip Instagram photos entirely if the account is private or doesn't exist.
6. DOWNLOAD every image immediately (CDN URLs expire within hours) and reference as `/images/filename.jpg`
7. After downloading, visually verify each image with the Read tool. Delete any text posts, memes, or announcements — we only want real photos of haircuts, work, shop interior, etc.

Other photo sources:
- **Google Maps**: `lh3.googleusercontent.com/...` (append `=w2048`, not `=w0-h0` — that's the 3-4MB original) - PERMANENT, can hotlink. If fewer than 3 photos, cover may be auto-assigned.
- **Restaurant Guru**: `img02.restaurantguru.com/...` - PERMANENT, can hotlink. WARNING: Many photos are collages with a cartoon watermark character, memes, or merch photos. Visually verify before using. NOTE: `img.restaurantguru.com/reviews/` URLs (different subdomain) block hotlinking - do NOT use those.
- **Street View**: `streetviewpixels-pa.googleapis.com/...` - PERMANENT. Screenshot and visually verify before using. NEVER use Street View for home-based businesses (plumbers, electricians, cleaners, mobile services) - it just shows a residential house which looks unprofessional. Only use if it shows a real shopfront with signage.

## Social harvest (brand assets + logo)

Run this for EVERY business that has a Facebook page and/or Instagram, **even when you
already have a phone number**. Social is not just a contact fallback: it is the main
source of the business's own **logo** and **brand colours**, which make the built site
look like theirs instead of a template. (Logged-out only. NEVER log in to Facebook to
scrape: it risks getting the operator's own account banned.)

**What to harvest, by reliability (logged-out):**
- **Logo** -> Facebook profile image via `node scripts/fb-logo.js <fb-url> <out.jpg>` (it
  downloads the bytes through the browser; curl is blocked on fbcdn). Instagram profile
  pic via `instagram-profile.js` is an alternative. A real website's favicon / apple-touch /
  og:image is best of all when one exists.
- **Brand colours** -> sampled from the logo (below). Robust even when the logo image
  itself is too messy to use.
- **Description / category / a recent post / recommendation %** -> Facebook main page.
  Good for About copy, a credential, or a personalisation hook.
- **Photos** -> prefer **Instagram** (`instagram-profile.js`), NOT Facebook: FB's photo grid
  is login-walled logged-out and returns nothing. Use FB only for the logo.
- Do **NOT** trust FB/IG **contact or location** over the live Google Maps listing. Social
  data is often stale (old number, old town). Maps wins for phone/address/hours.

### Logo: grade defensively, never ship a bad one
The logo could be a clean graphic, a square avatar with a baked background, a logo baked
into a banner, or a phone-snap of a sign. **Just as often the FB profile pic is NOT a logo
at all** -- in real testing, about half were: an owner's photo, a business-card *mockup* on a
desk, a storefront photo, or a photo of a printed price-list flyer. A storefront or flyer is
still useful (route it to photos, or mine it for text/services) but it is NOT the logo, and a
personal photo is neither. So GRADE it, don't assume:

1. Acquire the best candidate (ladder: SVG/transparent PNG > large opaque > small avatar >
   baked-in > photo-of-a-logo).
2. **Vision gate -- Read the image yourself** and decide: real logo or a photo? shape
   (roundel / square / horizontal-wordmark / stacked)? background (transparent / solid /
   none)? legible small? Then pick a mode:
   - clean transparent/vector, decent res -> `python3 scripts/brand-logo.py normalize IN OUT.png` (use as-is).
   - roundel/mark inside a SOLID square (typical FB avatar) -> `python3 scripts/brand-logo.py circle IN OUT.png --snap`
     (masks by geometry, never colour-keys, so it won't delete same-colour interior letters).
   - mark on a uniform background -> `python3 scripts/brand-logo.py trim IN OUT.png --flood-bg`
     (removes only the corner-connected background; safe for enclosed detail).
   - baked into a banner -> crop to the logo region first, then re-grade the crop.
   - phone-snap / noisy / tiny-only -> attempt, then Read the result; if not clearly clean,
     REJECT it (build will use the monogram fallback). Never ship a wonky logo.
3. **Re-Read the processed output.** If clean, save it as `data/images/logo.png`. If not, drop
   it: a clean monogram beats a bad real logo.

### Brand colours
Sample colours from the **processed/cropped logo** (`data/images/logo.png`), NOT the raw avatar.
A raw avatar's large background dominates and poisons the sample. Run
`python3 scripts/brand-logo.py colours <processed-logo>` -- it returns two measured hexes plus a
`dominant` list:
- `base`   = the most area-dominant colour -> usually the logo background / dark base.
- `accent` = the most vivid colour -> usually the brand "pop" colour (recovers small-area accents
  the dominant list misses, e.g. the green on a full-bleed navy logo).

**You have Read the logo, so YOU assign the roles** -- these two hexes are measured data, not the
decision. In the `## Brand` block, map the **accent** to `primary` (it is what `/build` uses for
CTAs/links/rules) and the **base** to `secondary`. On a full-bleed logo the dominant colour is the
background, so never promote `base` to the accent. Usually `accent` == the right pop colour; if it
clearly doesn't match what you see (a stray vivid artifact), pick the right one from `dominant` by eye.

**Only record `Brand colours` for a genuine logo/brand graphic.** The sampler will happily return a
`base`/`accent` from the grass behind an owner photo or the wood desk under a business card -- drop
the colours entirely if the image is a photo/storefront/flyer. Do still record colours when a real
logo's IMAGE was too messy to ship (its colours are still real); never from a non-logo.

## Press & story sweep (all leads — one cheap check)

Local press often holds story depth no other source has (interviews, anniversaries, family history, awards). Run `node scripts/news-search.js "BUSINESS NAME" TOWN` — it prints title/outlet/date only; empty is normal, move on without retrying. For the 2-3 most promising titles, find the real article with `node scripts/ddg-search.js "<VERBATIM headline, original script>"` (never translate/simplify it), read only openly-readable pages — NEVER bypass a paywall (walled hits contribute title/snippet facts only) — and apply the **two-anchor rule** before using anything: the article body must contain the business name AND one of town/street/owner, else discard. Record findings under a `## Press & story` section: facts, story, dates, outlet names, and whether each piece is coverage ABOUT the business or a mere mention (sponsorship, community event). Budget: at most 2-3 headline resolutions per lead; a DDG rate-limit ends the sweep — never retry, and a failed news-search call isn't alert-worthy.

## Output
Save everything to `clients/$ARGUMENTS/data/gathered-content.md` with source attribution.

**IMPORTANT**: Always include the CID-based Google Maps embed URL in the Location section of gathered-content.md. Get this from the `mapsEmbed` field in the Places API output (`https://www.google.com/maps?cid=XXXXX&output=embed`). The build step depends on this for embedding the map correctly. Never use search-based embed URLs.

**Brand block (from the Social harvest step)**: if the business has socials, add a `## Brand`
section so `/build` and the design step can consume the logo + colours:

```markdown
## Brand
- Logo: data/images/logo.png        # OMIT this line entirely if no usable logo (build falls back to a monogram)
  - source: facebook | instagram | site-favicon
  - shape: roundel | square | horizontal-wordmark | stacked
  - background: transparent | solid:#FFFFFF
  - grade: clean | processed | rejected
  - vision-verdict: <one line on what you saw and what you did>
- Brand colours:
  - primary: #RRGGBB     # the ACCENT (brand pop colour, usually `accent` from the sampler) -- /build uses this as the site accent
  - secondary: #RRGGBB   # the BASE (usually `base` from the sampler -- the logo background / dark base)
- Social: facebook=<url|none> ; instagram=<handle|none>
```
Record `Brand colours` even when the `Logo:` line is omitted. Never invent values: run the scripts.

## Personalisation hook (MANDATORY — used by /outreach)

Before marking gather complete, add a `## Personalisation hook` section to `gathered-content.md`. The outreach message reads this section to include one specific, verifiable detail about the business — proof we actually looked at them, not a templated send.

Pick ONE hook from the categories below (or two candidates if you can — outreach will pick). Each must be a factual nod, not a sentiment ("we love how..."). Each must cite the source line in gathered-content.md it came from, so it's traceable and impossible to invent.

**Allowed hook categories** (in rough preference order):

1. **Review quote** — a real customer review mentions a specific habit, person, or detail of the business. e.g. *"One review mentioned how James always remembers people's usuals."* Cite the reviewer name + source aggregator.
2. **Specific or unusual service** — something they do that most competitors don't. e.g. *"You do mobile dog grooming for elderly owners who can't travel to the salon."* Cite where the service was listed.
3. **Heritage / owner credential** — years in business (from a public business registry), a specific qualification, a named owner with a stated specialism. e.g. *"Open since 1987"* or *"Sarah's certified Level 3 barbering qualification."* Cite the source.

**Forbidden**:
- Anything derived from looking at photos ("love the dog in the cafe") — too easy to misread an image.
- Anything derived from Instagram bios — often jokey/sarcastic and easy to misinterpret.
- Generic praise that could apply to any business in their industry ("great atmosphere", "friendly staff", "good value") — fails the differentiation test.
- Invented details. If no hook exists in the gathered material, write the hook section with the literal text `(no hook available — gather did not surface a specific differentiator)` and outreach will fall back to a generic body.

Format:

```markdown
## Personalisation hook

**Candidate 1** (category: review quote)
Hook line: One review mentioned how Dave always sharpens the kids' clippers between cuts.
Source: Google Maps review by "Mark T", quoted in "Reviews" section above.

**Candidate 2** (category: specific service)
Hook line: You do same-day emergency boiler callouts seven days a week across your service area.
Source: "Services" section above, listed on Facebook page bio.
```

If only one candidate exists, write only Candidate 1. If none, write the fallback line above.

## Write the discovered facts back to the client row (MANDATORY - do this last)

⛔ **Saving `gathered-content.md` is NOT the same as recording what you found.** Measured
2026-08-16 on `powerwash-ington`: gather correctly identified the owner and wrote
`- **Owner:** Jessie Trevino` on line 13 of the gathered file, while `clients.owner` stayed
`NULL`. Nothing copied it across. The GHL mirror then created a CRM contact with no person on
it, `{{contact.first_name}}` had nothing to render, and the operator was on the verge of buying
a paid lead-enrichment product to be told a name the pipeline already knew.

The markdown file is for the BUILD step. The client row is what the CRM, the outreach copy and
every downstream query read. Facts that exist only in the file are invisible to all of them.

So before marking the client `gathered`, promote everything you discovered:

```bash
python3 - <<'PY'
from scripts.db import update_client, update_status
slug = "$ARGUMENTS"
# Only include keys you ACTUALLY found. Never write a placeholder, a guess, or
# "unknown" — an empty column is honest and downstream code already treats it
# as absent, whereas a fabricated value silently poisons the outreach copy.
found = {
    # "owner":    "Jessie Trevino",       # a PERSON's name only, never the business name
    # "email":    "owner@example.com",
    # "phone":    "3605550142",           # mobile
    # "landline": "3605550188",
    # "address":  "123 Main St, Olympia, WA 98501",
    # "location": "Olympia, WA",
    # "industry": "pressure washing",
    # "facebook": "https://facebook.com/...",
    # "instagram":"https://instagram.com/...",
    # "website":  "https://...",
}
if found:
    update_client(slug, found)
update_status(slug, "gathered")
print("client row updated:", sorted(found) or "(status only)")
PY
```

**`owner` is a person, not a company.** If the only name you have is the trading name, leave it
empty — `scripts/ghl.py` rejects business-shaped values anyway (suffix and word-count checks), so
writing one just moves the rejection downstream.

Do NOT rely on the calling session to remember this — it must happen here before gather is
complete.
