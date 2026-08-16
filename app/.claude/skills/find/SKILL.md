---
name: find
description: Search Google Maps for businesses without websites (or, in rescue/booking modes, with bad ones or booking-page-only web presences) in a specific region (UK, US, EU — operator-supplied)
argument-hint: [region and/or industry]
allowed-tools: Bash(node *), Bash(python3 *), Bash(grep *), Bash(ls *), Bash(curl *), Bash(cat *), Bash(npx *), Bash(*/notify.sh *), Read, Write, Glob, Grep, mcp__supabase__execute_sql

> ⚠️ **Terminal events only.** `NOTIFY_CHANNEL` fans out to two channels, so one call is two
> messages. Alert here ONLY if this failure stops the pipeline or needs a human now. Stage
> progress must stay silent — see CLAUDE.md § Alerting.
---

# Find Businesses Without Websites

Search Google Maps for businesses in **$ARGUMENTS** that have NO website. Read `prompts/lessons/find.md` before starting.

`$ARGUMENTS` is whatever target the operator specified — a city, a region within a country, any locality in any country, and optionally an industry ("plumbers in Texas"). Klaudius is region-agnostic at the framework level: don't anchor query terms or strategy to a specific country unless the operator has set that direction. Step 0 parses this argument — never paste it verbatim into search queries.

## Email-only installs (check `.env` before Step 1)

If `OUTREACH_ENABLED=true` and `OUTREACH_PRIORITY` is exactly `email`: the Places API has no email field, so screen candidates BEFORE claiming — a build on an un-emailable lead is wasted. All other installs skip this section (a mobile number from Places is enough; with outreach disabled the operator pitches however they choose).

- **Rescue leads first.** If `PIPELINE_MODES` includes `rescue`, work rescue-qualified candidates ahead of classic ones — their own site usually carries an email, so claim them without pre-verification (/gather captures it; /build's reachability check catches exceptions).
- **Booking leads screen like classic ones** — booking-platform pages rarely publish an email, so a golden-check hit does NOT get rescue's claim-without-verification shortcut. The platform page itself is the first (free) place to look during screening; otherwise the same FB-page/search steps below apply.
- **If rescue is NOT enabled**, expect few qualified leads — that's correct behaviour, not a failure. If the session ends with no claimable candidates because of it, alert via `bash scripts/notify.sh`: "Email is your only outreach channel and rescue mode is off — this session found no email-verified leads. Fix: enable rescue mode (one line in .env — ask me) or add another channel via npx klaudius configure."
- **Claim classic candidates only with a verbatim email** (no-email candidates with FB/IG stay claimable for the manual-DM lane — Step 3). Cheapest first:
  1. Places result shows a Facebook link → `node scripts/fb-page.js --brief FB_URL` (no search engine needed, highest yield).
  2. No social link → ONE `node scripts/ddg-search.js "\"NAME\" LOCATION facebook"`, then fb-page.js on the hit. Budget ~12 searches/session; a rate-limit is the normal end of search screening — stop searching (FB-linked and rescue screening continue), never retry.
  3. Instagram-only → email unknowable logged-out; manual-DM lane only (Step 3).
- **NEVER guess or construct an email** (`info@businessname.com` patterns). Verbatim from a page, or it doesn't exist.

## WhatsApp-reliant installs: screen the number at claim time

When WhatsApp is the only channel that can reach a candidate (sole enabled channel, or every channel ahead of it in `OUTREACH_PRIORITY` is non-viable for them), the reachability test is "is on WhatsApp", not "has a mobile" — a verified mobile can simply not be registered (field report: found out nine days after the build). Before claiming, probe:

```bash
node scripts/whatsapp.mjs check-number --phone "+447xxx"
```

Registry-only: sends nothing, costs no send-pacing budget. (Defaults to the first paired account; `--account <label>` overrides.) `on_whatsapp: false` → the mobile is unusable for WhatsApp; the candidate stays viable only via another channel or the manual-DM lane (Step 3 rules). Error/timeout = UNKNOWN — proceed; the send-time pre-flight still guards.

**Probe only the candidate you're about to claim — never sweep a pool.** Bulk existence checks are contact enumeration, an automation signal. One lookup per claim decision.

## Process

### Step 0: Parse the target and pick this session's town

**0a: Parse `$ARGUMENTS`.** Work out what the operator actually gave you:

- **Industry scope?** If it names a trade or vertical ("plumbers in Texas", "restaurants Lisbon"), extract it. The industry replaces the Step 1 industry sweep — search only that industry plus 2-3 regional synonyms/adjacent phrasings — and the rest of the argument is the region. NEVER paste an industry-containing string into queries as if it were a region: `"plumber plumbers in Texas"` returns zero usable results, silently.
- **Region granularity?** Classify the region part as either a **specific town/city** or **broad** (a country, a state/county/province, or a large metro like Houston or Greater Manchester). Empty region → `${OPERATOR_COUNTRY}`, which is broad.

**Before picking anything: reuse a cached sweep.** If a `clients/_pool/<town-slug>.json` is under 14 days old (its `swept` field), still has candidates, and its town fits the current scope, work from it — skip 0c and Step 1 entirely (a sweep costs real API money; the pool amortises one sweep across many clients). Delete the file once its usable tiers are exhausted or it has expired — Places data drifts (businesses get websites, close, change numbers).

**0b: Specific town** → that's the operator's scope. Use it as-is and go to Step 1. Work it fully (see "Work order and scope" below).

**0c: Broad region** → enumerate towns, then pick one AT RANDOM. Never search the broad name itself — text search matches region words against business *names* (a "Texas" sweep returns "Texas Barber" in the UK), and even a correct metro-level query surfaces only a shallow handful of leads.

1. Query Supabase to see where existing clients are concentrated. Use the Supabase MCP (`mcp__supabase__execute_sql`) however you like — an aggregate over the `location` column is usually enough. Keep the output tight (one compact summary, not a full row dump) so it's cheap in context.
2. List 15-20 viable towns inside the region that you have NOT already worked: second-tier towns, suburbs, outer boroughs, the periphery of metros. Skip metro cores (over-served — see "Market saturation"), anything already in the DB, and towns marked in `clients/_pool/exhausted.md` within the last 90 days (older entries are stale — towns replenish).
3. Pick ONE with real randomness — not judgment:
   ```bash
   python3 -c "import random,sys; print(random.choice(sys.argv[1:]))" "Town A" "Town B" "Town C" ...
   ```
   This is deliberate: asked to "use judgment" from the same starting state, the model picks the same town almost every time (measured: 21 of 22 fresh sessions chose the identical town in a whole US state), so every session, parallel child, and operator would work the same leads in the same order. Enumerate with judgment; choose at random.

### Step 1: Batch search — core sweep + locally-adapted extension

Run all searches for the chosen town upfront, in two layers. The Places API has no rate limiting, so run them all immediately. `<town>` below is the town from Step 0. (A fixed list alone was measured to surface only ~25% of a town's qualified supply — the extension layer is not optional.)

**Use natural `${OPERATOR_LANGUAGE}` industry terms in your queries** — Google Places matches local-language searches against local-language listings. The Places scripts pass `${OPERATOR_LANGUAGE_CODE}` so display names and addresses come back in the right language, but the *query strings* are yours to write (e.g. Italian `idraulico`, Spanish `fontanero`, French `plombier`, not `plumber`).

Adapt the query terms to regional conventions even within a single language. Google Places doesn't always match across regional vocab (e.g. `heating engineer` works in the UK; `HVAC contractor` is the US equivalent. `tyre shop` for UK; `tire shop` for US. `takeaway` for UK / AU / IE; `takeout` for US/CA. `kitchen fitter` for UK; `kitchen remodeler` for US):

**Layer 1 — core sweep (always run):**

```bash
node scripts/places-search.js "plumber <town>"
node scripts/places-search.js "electrician <town>"
node scripts/places-search.js "<heating engineer / HVAC contractor> <town>"
node scripts/places-search.js "locksmith <town>"
node scripts/places-search.js "roofer <town>"
node scripts/places-search.js "landscaper <town>"
node scripts/places-search.js "<kitchen fitter / kitchen remodeler> <town>"
node scripts/places-search.js "auto repair <town>"
node scripts/places-search.js "<tyre shop / tire shop> <town>"
node scripts/places-search.js "handyman <town>"
node scripts/places-search.js "painter <town>"
node scripts/places-search.js "cleaning service <town>"
node scripts/places-search.js "restaurant <town>"
node scripts/places-search.js "beauty salon <town>"
node scripts/places-search.js "barber <town>"
```

**Layer 2 — locally-adapted extension (always run):** generate 10-15 ADDITIONAL search categories fitted to this specific town's economy, then run them the same way. Rules for generating them:

- Favour categories where the owner is **likely to pay for a website**: high job/ticket value, urgency-driven customers, owners who already spend on marketing or lead generation.
- Adapt to the town's real character — dominant local industries, demographics, local-language and regional terms (a Texas border town wants `taqueria` and `panaderia`; a UK market town wants `tree surgeon` and `damp proofing`).
- Owner-operated local businesses only — never categories dominated by chains or franchises.
- Skip professions that near-universally already have websites (dentists, lawyers, realtors/estate agents, accountants).
- Skip anything without fixed premises or a normal Google Business listing.

(If the operator specified an industry in `$ARGUMENTS`, skip both layers and search only that industry plus 2-3 synonyms — see Step 0a.)

Collect ALL no-website businesses from every search into a working list. (If rescue mode is enabled, businesses WITH a website also enter the pool — see Rescue mode below. If booking mode is enabled, add its extra searches to this same sweep and gate has-website candidates through the golden check — see Booking mode below.) **Persist it:** write the qualified pool to `clients/_pool/<town-slug>.json` before claiming anything — top-level `"swept": "YYYY-MM-DD"`, then entries with name, phone, reviews, rating, **tier**, address, cid — removing entries as you claim or disqualify them (Step 0 reuses this file). If a search printed a truncation WARNING, add `"truncated": true`.

**Priority ranking:** Sort candidates by tier FIRST, then by review count within each tier:
- **Tier 1 (high-value trades):** plumber, electrician, locksmith, roofer, heating/HVAC engineer, landscaper, kitchen fitter / remodeler, builder, painter, carpenter, etc. — these close easier and pay without hesitation
- **Tier 2 (services):** cleaning service, pest control, handyman, mechanic, auto repair, tyre/tire shop, etc.
- **Tier 3 (consumer-facing):** restaurant, cafe, takeaway/takeout, beauty salon, nail salon, barber, etc.

**Why this ordering:** Tier 1 businesses have high job values, urgency-driven customers, and already spend heavily on customer acquisition (US home-service contractors typically spend thousands per month on marketing, at $50-230 per lead), so a one-off website is an easy yes. Tier a Layer 2 category by the same rule — **ticket size × customer urgency × existing marketing spend** — not by which list it resembles.

Always exhaust Tier 1 candidates in a town before picking from Tier 2 or 3. A plumber with 15 reviews is a better lead than a barber with 80. When two candidates are effectively equal (same tier, review counts within ~25%), tie-break with the same `random.choice` one-liner rather than always taking the higher count.

**Work order and scope:**
- **Operator gave a broad region (or nothing):** when Tier 1 and strong Tier 2 in the current town are exhausted, close any playwright session you opened for this town, log it in `clients/_pool/exhausted.md` (Step 2), and go back to Step 0c for a new town — the next town's Tier 1 beats this town's Tier 3. Tier 3 is a deliberate operator choice or end-of-region fallback, never an autonomous default.
- **Operator named a specific town:** the opposite — that town is the brief. Work it fully, Tier 1 → Tier 2 → Tier 3, and report it exhausted rather than silently wandering to a neighbouring town.

### Step 2: Check town viability
After running all searches, count how many no-website candidates you found with 15+ reviews (rescue-qualified and booking-qualified candidates count too when those modes are on). Thin means: fewer than **10** for a full two-layer sweep; fewer than **3** for an industry-scoped sweep. If any search printed a truncation WARNING, counts are a lower bound — don't declare a town thin off an incomplete sweep. A thin town is likely exhausted; what happens next depends on scope:
- **Broad region** → append it to `clients/_pool/exhausted.md` (one line: `town — YYYY-MM-DD — N qualified`; a dud town is a re-roll, not a session failure), then re-roll with the same `random.choice` one-liner — don't pick the replacement by preference. **After 3 dud towns in one invocation, alert via `bash scripts/notify.sh` and stop** — that's a signal something is off (wrong scope, thin region, API trouble), not bad luck.
- **Operator-named town** → tell the user and stop rather than burning tokens on thin leads.

(Email-only installs: count only email-verified, rescue-qualified, or FB/IG-reachable candidates — email-verification happens in Step 3, so finalise this judgment after screening.)

### Step 3: Check contact info for top candidates
Work through your candidate list in priority order (tier first, then reviews — see Priority ranking). For each candidate:

**At least one contact method is required: phone (mobile), email, Facebook page, or Instagram page.** Most candidates will have a phone number from Google Maps — that's sufficient (email-only installs: NOT sufficient — see the section above). If they also have an email, great — record both.

**Quick contact check (don't spend long):**
If the Google Maps listing doesn't show an email or mobile phone, do a quick check (1-2 sources max):
1. **Facebook page** — visit with `npx playwright-cli -s=find-<region-slug>` (e.g. `find-leeds`; named because the unnamed default collides with parallel pipeline children), check the bio/about section for email. Also note the Facebook page URL itself as a contact method. When done with the browser in this skill — including on an early abort — run `npx playwright-cli -s=find-<region-slug> close 2>/dev/null || true` (no-op if you never opened one); leaked sessions hold a headless browser indefinitely.
2. **Instagram** — `node scripts/instagram-profile.js HANDLE` — check the business_email field. If it's reported `unavailable`, treat the email as unknown, not as "no email". Also note the Instagram handle as a contact method.

Don't spend more than 2 tool calls per candidate on contact discovery.

If the candidate has NO phone number, no email, AND no Facebook/Instagram presence: **SKIP** and try the next candidate.

**Social-media-only candidates:** If the only contact method is Facebook or Instagram (no phone, no email), the candidate is still valid. Record the Facebook URL in the `facebook` field and/or Instagram handle in the `instagram` field when adding to Supabase. These clients will be marked for manual DM outreach after deployment. (Email-only installs: deprioritise these behind email-verified and rescue candidates.)

### Step 4: Claim and proceed
Once you find a viable candidate (has phone, email, and/or Facebook/Instagram; email-only installs — viable per the section above; WhatsApp-reliant installs — number screened per the section above):
1. Run the duplicate check
2. **Already-built probe** — `node scripts/deployed-check.js "NAME" "TOWN"` (rescue leads: append their existing site URL as a third argument) checks whether another operator already deployed a site for this business. `taken` → skip: remove it from the pool file, move to the next candidate. `clear` (probe failures report `clear`) → proceed.
3. Add to Supabase, then atomically claim. **Both lines required** — `add_client` alone leaves `claimed_at` / `claimed_by` unset; `claim_client` is the only safe atomic-claim entry point (see CLAUDE.md Critical Rule #9):
   ```bash
   # (a) Insert the row at the schema's default `found` status:
   python3 -c "from scripts.db import add_client; add_client({'slug':'SLUG','name':'NAME','location':'LOC','industry':'IND','phone':'+CC...','email':None,'facebook':None,'instagram':None,'status':'found'})"
   # (b) Atomically claim it — transitions `found` → `claimed`, stamps `claimed_at`/`claimed_by`, returns True:
   python3 -c "from scripts.db import claim_client; print(claim_client('SLUG'))"
   ```
   Record every contact field you actually found — a screened/verified email goes in `email`, don't copy the snippet's `None` literally.

   If `add_client` raises `DuplicateClientError` or `claim_client` returns `False`, a parallel session got this business first — drop the candidate (remove it from the pool file too) and move to the next. Never claim a slug you didn't insert.
4. Create the client folder and status.md
5. Proceed to gather

## Market saturation
In any large metropolitan area, central / business-district businesses are over-served — they tend to have websites already. Outlying neighbourhoods, suburbs, outer boroughs, and second-tier towns have substantially higher hit rates for website-less businesses. Don't waste searches on the most-prominent commercial cores; target the periphery first.

## Target criteria
- NO website (hard requirement). Businesses with a dead or bad website qualify only through Rescue mode, gated by `scripts/site-check.js`; businesses whose "website" is a booking-platform page qualify only through Booking mode, gated by `scripts/booking-check.js` — never by eye in either case.
- Has a mobile phone number, email address, or Facebook/Instagram page (at least one required; email-only installs — see the section above)
- Has Google reviews (prefer 15+)
- Rating of 4.0+ stars
- Is genuinely active
- Located in the operator's target region (whichever country/area was passed via `$ARGUMENTS`)

## Rescue mode (only when `PIPELINE_MODES` in `.env` contains `rescue`)

When enabled, businesses WITH a website also qualify — if the site is verifiably bad. From the same Step 1 searches, gate each has-website candidate through:

```bash
node scripts/site-check.js "WEBSITE_URL"
```

Only verdicts `dead` or `bad` qualify. `not_own_site` disqualifies. `unknown` (bot-blocked fetch) NEVER qualifies — a 403 to a script says nothing about the site; don't override it by eye. Skip chains and franchises regardless of verdict.

> **`ok` sites: qualify them when `PIPELINE_MODES` includes `compete`.** Jeff, 2026-08-15:
> *"we spending API Places tokens, why not build"* and *"i would try to take that client all day."*
>
> The economics inverted. `ok` was written to disqualify when a build cost ~$5 of API credit, so
> spending it on a business whose site already works was waste. Klaudius generates on a Claude Code
> **subscription** at ~$0 marginal, while the Places call that surfaced the lead is **already paid
> for**. Discarding a contactable, well-reviewed local business because their site is *too good* now
> throws away the only spend in the transaction.
>
> A good site does not mean a happy customer. They are paying somebody, frequently more than
> $598 + $98/mo, and usually without hosting, a chat assistant, 20 blog posts a month or ongoing
> SEO in the price.
>
> **What changes is the PITCH, not the build.** Never tell an owner their working site is broken —
> they can see it is not, and one fabricated criticism loses the reader for good. `top_pain_point()`
> in `scripts/ghl.py` already carries the `ok` variant: it opens by conceding the site is fine and
> competes on what the money buys instead. Stamp `'extra': {'mode': 'compete', 'site_verdict': 'ok'}`
> at claim time so the copy picks that branch.
>
> Still disqualifying regardless of mode: chains, franchises, `not_own_site`, and `unknown`.

Rescue leads use the same tiers, contact requirements, dedupe, and claim flow. Rank them alongside no-website candidates by tier then reviews — mode doesn't outrank lead quality. (Exception: email-only installs work rescue leads first — see the section above.) Two extras at claim time:

- Stamp the mode at insert: include `'website': 'URL', 'extra': {'mode': 'rescue', 'site_signals': 'no-https, no-viewport-meta'}` in the `add_client` dict (the URL goes in the `website` column; signals comma-joined from the site-check output).
- Record verdict + signals in `status.md`. They feed `/gather`'s site capture and `/outreach`'s observation line — and must never appear on the built site itself.

## Booking mode (only when `PIPELINE_MODES` in `.env` contains `booking`)

Booking-native businesses often run everything through a booking platform (Fresha, Booksy, Square, Vagaro, GlossGenius...) and put that platform page in their Google listing's website field. They're paying for booking software but have no real website — pre-qualified leads. Two changes when enabled:

**1. Add booking-native searches to the Step 1 sweep** (same run, same pool — they join Layer 1, and Layer 2's rules apply on top). Beauty salon and barber are already in the core list; add, in natural `${OPERATOR_LANGUAGE}` terms:

```bash
node scripts/places-search.js "nail salon <town>"
node scripts/places-search.js "hair salon <town>"
node scripts/places-search.js "lash studio <town>"
node scripts/places-search.js "massage <town>"
node scripts/places-search.js "spa <town>"
node scripts/places-search.js "<med spa / aesthetics clinic> <town>"
node scripts/places-search.js "yoga studio <town>"
node scripts/places-search.js "pilates studio <town>"
```

(Industry-scoped runs: skip these extra searches — the operator's brief wins; the golden check below still gates every candidate.) Rescue/booking pool entries also carry their `website` URL and gate verdict — a cached-pool claim needs them.

**2. The golden check.** Every has-website candidate from ANY search (it's instant and offline) goes through:

```bash
node scripts/booking-check.js "WEBSITE_URL"
```

Only verdicts `booking_platform` and `dead_platform` qualify a booking lead — with one extra step: if the output's `classification` is `weak_embed_first` (Boulevard, Mangomint, bsport, Phorest), these platforms normally embed on a customer's OWN website, so run the own-website search from gather's Step 0a BEFORE claiming and qualify only if none exists. The other verdicts are mechanical outcomes, not judgment calls:
- `unclaimed_or_directory` — the business is NOT paying that platform (unclaimed listing / marketplace directory page). It effectively has no web presence it controls, so treat it as a classic no-website candidate — never pitch it as "you're paying for booking software".
- `social_as_website` — the listed "website" is their Instagram/Facebook/Linktree. No real website exists: treat as a no-website candidate (in booking-native verticals, stamp it a booking-mode `no_website` lead), and record the profile in the `facebook`/`instagram` contact field.
- `disqualified_platform` (enterprise/chain software) and `aggregator_listing` — skip.
- `has_website_platform` — treat as has-website (classic reject; rescue rules may still apply).
- `not_booking_platform` — not a booking page; if rescue mode is also on, continue into the rescue gate (`site-check.js`).

No-website businesses found by the booking-native searches are ALSO booking leads (stamp `booking_signal: 'no_website'`) — they get the booking-demo build variant.

Booking leads use the same contact requirements, dedupe, and claim flow (email-only installs: screened like classic candidates — see the email-only section above). Ranking: `booking_platform` and `dead_platform` hits count as **Tier 2**, not Tier 3 — one has proven it pays for software, the other has a broken link as its only web presence. **Within Tier 2, work high-ticket booking verticals first**: aesthetics/med spa/laser, PMU/microblading, health clinics (physio, chiro, massage therapy), lash studios, and full hair salons ahead of low-ticket walk-in shops (basic barbers, budget nail bars) — per-visit tickets differ ~10x and the high-ticket verticals carry the marketing budgets that buy websites. A low-ticket golden hit still qualifies, at the back of the queue. No-website booking-vertical leads stay Tier 3. At claim time:

- Stamp the mode at insert: `'website': 'PLATFORM_URL', 'extra': {'mode': 'booking', 'booking_platform': 'fresha', 'booking_signal': 'golden_check'}` in the `add_client` dict (platform id from the booking-check output; `booking_signal` is `golden_check`, `dead_platform`, or `no_website` — omit `booking_platform` and `website` for no-website leads).
- Record the verdict JSON (as printed) in `status.md` — it feeds gather, build, and outreach; fee lines are decided by the registry, never by eye.

A candidate satisfying both rescue and booking premises gets whichever stamp actually qualified it; booking wins ties.

## Duplicate check
```bash
ls clients/
grep -rl "PHONE_NUMBER" clients/*/data/ 2>/dev/null
python3 -c "from scripts.db import search_by_phone; print(search_by_phone('PHONE_NUMBER'))"
```

## Output
Create `clients/{business-name}/data/status.md` with the business details and pipeline progress.
When adding to Supabase, always store the MOBILE number (in E.164 form, e.g. `+12025550123`) in the `phone` field and the email in the `email` field.
Always store Facebook as a **full URL** (e.g. `https://www.facebook.com/PageName`) in the `facebook` field — this handles pages, profiles, and profile.php?id= variants consistently.
Always store Instagram as a **bare handle without @** (e.g. `examplebarbershop`) in the `instagram` field — the DM agent constructs the URL from this.
