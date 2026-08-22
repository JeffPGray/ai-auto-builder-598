# Stage: preflight
Read this file for THIS stage only. Do not re-read SKILL.md whole after compaction.

# Build Website for $ARGUMENTS

Create a bespoke Next.js site using ONLY the content in `clients/$ARGUMENTS/data/gathered-content.md`. Read `prompts/lessons/build.md` before starting.

### After a compaction: re-read narrow, never re-read whole

Measured 2026-08-16 (Fable token-cost review): a real build re-read `page.tsx` 5x and
`site-data.ts` 7x across its own auto-compactions — tens of thousands of redundant characters,
each one re-charged at fresh-read cost. **Never re-read a whole file you already authored this
session.** If you need to check something after a compaction: (a) re-read only the specific
section you're about to edit, with `offset`/`limit`, not the whole file; (b) never re-read a
file immediately after `Write`ing or `Edit`ing it — the tool already told you it succeeded, and
the content is what you just wrote; (c) if you genuinely lost track of overall state after a
compaction, `status.md` and the file list (`find clients/$ARGUMENTS/site/src -type f`) are
cheaper ways to reorient than re-reading generated code.

**Also re-read this SKILL.md's OWN section for your current stage after a compaction — narrow, not
whole.** A compaction can summarize away the exact rule you were mid-way through applying (a font
pairing constraint, a colour-precedence rule, a specific check's threshold) while leaving you
confident you remember it. `grep -n "^#"` this file to find the right heading, then `Read` with
`offset`/`limit` for just that section — never the whole 2,600+ line file. This is the same narrow-
read discipline as above, applied to the skill's own instructions instead of generated code.

## How to read this file (precedence — settled 2026-08-19 after five real failures)

This file has grown by accretion and its rules have, more than once, contradicted each other. When
that happened the model followed **whichever instruction sat nearest the work**, and the unenforced
one beat the enforced one. Three measured examples: a line saying `saturated` "is usually the right
answer" sat 15 lines below a table naming NEUTRAL-CANVAS as the default, and produced a mono-navy
site; a "skip the consult's font" instruction beat the precedence table that assigned typography to
the consult, and shipped a Vogue fashion didone on an HVAC contractor; a code example using
`Bodoni_Moda` beat the prose telling the model not to use display serifs. **Examples beat rules, and
proximity beats correctness.** So precedence is now explicit:

1. **A rule with a NAMED GATE outranks a rule without one.** If two instructions conflict and one is
   enforced by a script (`richness-check.mjs`, `verify-design-intent.mjs`, `contrast-check.mjs`,
   `design-ledger.mjs`, `font-check.mjs`, `ship-scan.mjs`), the enforced one wins — regardless of
   which appears later in this file or nearer to what you are doing.
2. **A NUMBER outranks an adjective.** "≥ 3.5× body size" beats "large". Where a rule states both,
   the number is the rule and the adjective is commentary.
3. **A code example is a MECHANISM demonstration, never a recommendation.** Substitute the values
   this client's consult returned. If an example's literal values would violate a rule in this file,
   the rule wins and the example is a bug — say so.
4. **If you can satisfy a rule while its gate still fails, the rule text is wrong.** Do not
   gesture at compliance. Record the discrepancy in `status.md` so the rule gets fixed.
5. **Silence is not permission.** If a step's instruction cannot execute — a skill you are told to
   invoke is not in `allowed-tools`, a script flag does not exist, a referenced file is missing —
   **stop and report it**. Five separate instructions in this pipeline were unexecutable for weeks
   and failed silently, because nothing errors when an instruction simply cannot run.

## Pre-build checks (MANDATORY - do these before writing any code)

### 0. Retrofit guard (CMS / booking system)
```bash
for m in cms.md cms-in-progress booking.md booking-in-progress; do test -f clients/$ARGUMENTS/data/$m && echo "STOP: retrofit marker $m present"; done; echo "check done"
```
If it prints any STOP, **do not rebuild.** This client's site has (or is mid-way through getting) a self-serve CMS (`/cms`) and/or a booking system (`/booking`); the rebuild below starts with `rm -rf clients/$ARGUMENTS/site`, which would destroy that wiring and orphan the owner's saved CMS edits in Vercel Blob. Edit the existing site in place instead (see the relevant skill's Maintenance section).

### 0.4 Re-designing an existing client? Reset its design state FIRST

If `clients/$ARGUMENTS/site` already exists and you are doing a fresh DESIGN pass (not a resume):
```bash
node scripts/reset-client-design.mjs $ARGUMENTS --yes
```
It clears `site/`, the design lines in `status.md`, AND this slug's row in
`data/design-fingerprints.json` — keeping gather, images and docs. A hand reset that clears
status.md but leaves the fingerprint stale makes the ledger LIE: QA then raises a CRITICAL
claim-vs-artifact drift against a record that is simply out of date (measured 2026-08-19).

### 0.5 Reachability (only when `OUTREACH_ENABLED=true`)
Confirm at least one channel in `OUTREACH_PRIORITY` is viable for this client — `email` needs an `email`, `whatsapp`/`sms` need a mobile `phone`. Check the Supabase row AND `gathered-content.md` (gather often finds an email late — if so, write it to the client row now). If no enabled channel is viable and the client has no `facebook`/`instagram` for the manual-DM lane: **STOP — do not build.** Record "on hold: no enabled outreach channel is viable" in status.md and the client's `notes`, leave status at `gathered`, and alert via `bash scripts/notify.sh`. Do NOT mark `unreachable` — the client may have a contact method on a channel the operator simply hasn't enabled (an email under a whatsapp-only install, a phone under an email-only one), and the lead becomes workable the moment they enable it. A site you cannot send is a wasted build.

### 1. Photos
Read `clients/$ARGUMENTS/data/gathered-content.md` and verify it contains at least one actual photo URL (e.g. `lh3.googleusercontent.com`, `/images/`, `img02.restaurantguru.com`). If the Photos section has zero usable URLs, **STOP and go back to gather photos** before building. A site without photos looks like a generic template and wastes the lead. Do NOT proceed with a gradient-only hero and no images anywhere — that is not a bespoke website.

**Hi-res for HF:** when scraping Squarespace/Wix/CDN photos, request the largest variant (e.g. Squarespace `?format=2500w`) into `data/images/` **before** optimise. HF `--image` reads originals; WebP in `public/` is for page weight only.

**🚨 Only use photos gather POSITIVELY CLEARED.** The Photos section carries a verdict per photo and
usually a `Usable hero candidates:` / `Usable work photos:` summary. **A photo marked
`(not yet verified)`, `too small`, `unclear` or similar is NOT available to you** — not as a hero,
not as a card, not as a blog image, not "just for texture".

This is not pedantry. On 2026-08-16 a build used `gmaps5`, marked `(not yet verified)`, as a home
page image. It was **a photograph of two people in horror-clown makeup with blood-spattered hands**,
on the site of a Houston plumbing company. It survived to the second QA round, 90 minutes in. The
verdict was sitting in `gathered-content.md` the whole time and the build used the photo anyway.

Before QA, prove it:
```bash
node scripts/verify-photos.mjs $ARGUMENTS      # prints PHOTO_CHECK=PASS / FAIL, exits non-zero on FAIL
```
A FAIL means you referenced a photo nobody cleared. Fix it by using a cleared photo — or, if you
genuinely believe the photo is fine, **Read the image yourself** and record that verdict in
`gathered-content.md` so the decision is on the record and auditable. Never silence it by deleting
the line. Running this here costs ~1 second and saves an entire QA round.

### 2. Design system from `/ui-ux-pro-max` (MANDATORY)

> ⛔ **RECORD THE OUTPUT OR IT DID NOT HAPPEN.** Write these lines into
> `clients/$ARGUMENTS/data/status.md` before writing any TSX. QA fails the build if they are absent.
>
> ```
> DESIGN_SYSTEM=ui-ux-pro-max query="<the exact query you ran>"
> - Layout pattern: <the pattern returned, and the one you actually used>
> - Palette family: <what it suggested>
> - Character: deep|vivid|muted|pale|dark  (why, in six words)
> - Harmony: <type>  (why this pairs with the character)
>
> DESIGN_IDEA=<ONE sentence: the single idea every choice on this site serves>
> - Hero archetype: <which of the five — full-bleed work-photo / split-diagonal / oversized-type-
>   over-duotone / video plate / stat-anchored — and why it fits this trade and business>
> - Signature move 1: <a specific, named, checkable choice — not a vibe>
> - Signature move 2: <ditto>
> - Signature move 3: <ditto>
> - Differs from recent neighbouring builds: <one line — what's structurally different here, not just
>   re-hued>
> ```
>
> **Why DESIGN_IDEA exists (2026-08-19 Fable design-elevation review).** Correct + rich + varied
> still isn't *stunning*. What real award-tier sites share, per a direct review of current Awwwards
> React winners, is that every type/color/grid choice visibly serves ONE idea — a visitor could name
> it. A build with no stated idea defaults to arranging correct pieces with no point of view, which
> is exactly what "technically passes every gate, still reads as generic" means. Writing the idea
> down FIRST, before any TSX, is what makes it survive contact with a hundred other rules while
> writing 14 routes — same reasoning as the Design Manifest checkpoint below, applied one level up:
> that manifest plans WHERE richness lands, DESIGN_IDEA is WHY any of it is there. The three
> signature moves must be specific enough to verify later (§ Design (HARD RULES) below extends the
> existing KEY-EFFECTS fidelity check to these three) — "make it feel premium" is not a signature
> move, "an isotherm-line SVG motif used as section dividers and the FAQ's list marker" is.
>
> **Why this is now a recorded artifact rather than an instruction.** Build 3's `status.md` recorded
> fonts and a palette line but **nothing from this step**, so there is no way to tell whether the
> design consult ran, was skipped, or ran and was ignored — and this skill is the difference between
> a considered layout and a generic one.
>
> The palette line it *did* record was `harmony=complementary (high energy / demolition)`. That is a
> deliberate choice, reasoned backwards: demolition reads heavy and serious, not high-energy. It
> then derived electric cyan, which the builder sensibly declined to use, and the site shipped mono.
> A wrong recorded reason is recoverable — QA can see it and argue. A missing one is not.
>
> An unrecorded design step is an unaccountable one, and this project has now watched two
> "mandatory" skills (anti-slop, and this) get read and not executed with nothing to show it.

Every build must consume a fresh design system. **Do not run search.py here.** One consult for
the whole build: `stages/consult-once.md`. If `clients/$ARGUMENTS/data/design-lock.md` is missing,
go there now. If it exists, do not re-run `--design-system`.

Use the copy inside `app/.claude/skills/`. The global `~/.claude/skills/ui-ux-pro-max` is a
React Native skill and will give mobile-app guidance for a web build.

### 3. Copy quality (checklist, not a Skill dump)
Do not `Skill(skill="anti-ai-slop")` as a full corpus load (compaction + gulf-coast stall). Apply
this checklist to every visitor-facing string: no em dashes; no elevate/leverage/unlock/delve;
no invented facts, prices, or permits; no fake author byline; no "we" that is Gray Reserve.
Full list remains in `prompts/lessons/build.md`. Scripts: `fix-dashes.mjs`, copy-fingerprint.

## Language: `${OPERATOR_LANGUAGE}` (mandatory)

Every site you build is written entirely in `${OPERATOR_LANGUAGE}` from `.env` (falls back to English if unset). This is non-negotiable — sites going to a `${OPERATOR_COUNTRY}` business owner must read like they were written by a native speaker of `${OPERATOR_LANGUAGE}`.

**Hard rules:**

- The `<html>` element in `layout.tsx` MUST have `lang="${OPERATOR_LANGUAGE_CODE}"` (substituting the actual code from `.env`, e.g. `lang="it"` for Italian, `lang="es"` for Spanish, `lang="en"` for English). Search engines and screen readers use this; getting it wrong is a critical QA failure.
- Every visitor-facing string is in `${OPERATOR_LANGUAGE}`: nav links, buttons and CTAs, eyebrow labels, body copy, taglines, form labels (Name/Email/Phone/Message), form submission success/error messages, footer copy, page `<title>` and meta description, and aria-labels on icons.
- Testimonials/quotes pulled from `gathered-content.md` are ALREADY in `${OPERATOR_LANGUAGE}` (gathered from local-language sources). Quote them verbatim with author name and star rating — do NOT translate, paraphrase, or "improve" them.
- Opening hours: use the day abbreviation conventions native to `${OPERATOR_LANGUAGE}` (e.g. Mon-Fri in English, Lun-Ven in Italian/Spanish/French, Mo-Fr in German). 24-hour time format unless the country specifically prefers 12-hour (Anglosphere only).
- Phone display: format numbers the way a native operator would write them. Always wire `<a href="tel:+CC...">` to the full E.164 international form regardless of what's shown.
- Currency: use the format and decimal separator native to the country (e.g. `€ 49,00` in continental Europe with comma decimal; `£49.00` or `$49.00` in the UK / US with period decimal).
- Contact form fallback message (when no email is wired): write the dummy success message in `${OPERATOR_LANGUAGE}` — never in English unless the operator's language IS English.
- Proper nouns (brand names like "Hair & Beauty" or "Pizza Express") stay verbatim — don't translate them. But all surrounding copy is `${OPERATOR_LANGUAGE}`.
- Never insert English boilerplate ("Welcome to...", "Get in touch", "About us") in a non-English site. Native speakers reading the finished site should never see foreign-language text that wasn't part of the business's own branding.

Pick natural CTAs and section labels in `${OPERATOR_LANGUAGE}` directly; don't translate word-for-word from English.

If any English boilerplate slips through, the QA reviewer will flag it as a critical issue.

## Setup
```bash
rm -rf clients/$ARGUMENTS/site
cp -r templates/trade-site clients/$ARGUMENTS/site
# Template ships privacy/terms scaffolding; after site-data is filled, author stage MUST run:
#   node scripts/generate-legal-pages.mjs $ARGUMENTS --write
mkdir -p clients/$ARGUMENTS/site/public/images
cp clients/$ARGUMENTS/data/images/* clients/$ARGUMENTS/site/public/images/ 2>/dev/null || true
cd clients/$ARGUMENTS/site
# Cache, not fresh install (2026-08-18, Fable's caching review): every prior build ran
# `rm -rf node_modules; npm install` from scratch — identical dependency set every time unless
# the template's own package-lock.json changed, at ~463MB and real install wall-clock PER CLIENT.
# node-modules-cache.sh builds the real node_modules ONCE per lockfile hash (via `npm ci`, which
# refuses a drifted lockfile rather than silently resolving around it) into a shared cache, then
# clones it via APFS copy-on-write — measured 2026-08-18: ~70s one-time build, ~5s per client
# after that (vs. a full fresh install every time). Falls back to a plain copy on a non-APFS
# filesystem — slower, but still skips re-running npm install.
../../../scripts/node-modules-cache.sh .

# Hero video render moved HERE 2026-08-18 (Fable, after a real build shipped with a static hero
# despite having 4 usable photos on disk). Depends only on the copied photos, nothing on TSX — so
# running it now, before a single page is written, means the render (and its OK/FAIL record) is
# LOCKED IN before any watchdog kill, compaction, or time pressure could cause it to be skipped.
# The old placement (as a discrete step deep in § Motion, chat and hero video) put it AFTER the
# work most likely to survive a truncated run and made it the easiest thing to silently drop.
cd ../../..
# Image plan: pick slots → HF thin/wide plates into data/images → KEEP lines for verify-photos.
# Rules: services/higgsfield/IMAGE-RULES.md · clients/<slug>/data/image-plan.json
node services/higgsfield/image-plan.mjs --slug $ARGUMENTS --all
node services/higgsfield/hero-prompt.mjs --slug $ARGUMENTS
cp -f clients/$ARGUMENTS/data/images/* clients/$ARGUMENTS/site/public/images/ 2>/dev/null || true
# Remotion lives in services/hero-video/node_modules (gitignored). A fresh worktree that
# never ran `npm ci` there fails every hero render with "@remotion/bundler not installed"
# and ships poster-only — unequal vs hillards. Ensure deps before render.
if [ ! -d services/hero-video/node_modules/@remotion/bundler ]; then
  (cd services/hero-video && npm ci) || (cd services/hero-video && npm install)
fi
# Hero BEFORE optimise-images — HF --image reads data/images/ originals (hi-res gather).
# Auth: `higgsfield auth login` once. Do not pass --skip-hf in production preflight.
node services/higgsfield/render-hero.mjs --slug $ARGUMENTS
# Tier 2: optional service/about micro-loops (720p, hf-loop slots in image-plan)
node services/higgsfield/render-loops.mjs --slug $ARGUMENTS || true
# Optimise rasters → WebP in public/images (richness weight/webp). Required for BOTH
# single /build and parallel run-lane — author stage also runs it; this makes a truncated
# run less likely to skip it before first next build.
node scripts/optimise-images.mjs $ARGUMENTS
# Logo nav chrome (BOTH lanes): white-plate → light nav + logo-only; writes data/logo-nav.json
# and patches site-data when --write. Run after logo.webp is in public/images.
node scripts/inspect-logo.mjs $ARGUMENTS --write
cd clients/$ARGUMENTS/site
```
Record the exact `IMAGE_PLAN=OK …` and `HERO_VIDEO=OK …` or `HERO_VIDEO=FAIL …` lines into
`status.md` NOW, before writing any TSX — this is what `verify-hero-video.mjs` and the build
Verify gate check for, and doing it here means a kill at any later point cannot erase the fact that
the attempt happened. A `FAIL` (both HF and Remotion failed, or Remotion alone with &lt;3 photos) is a
legitimate, recorded degradation — carry on with the poster-only `<HeroVideo>` form, § Motion, chat
and hero video below. `source=higgsfield mode=t2v|ref|lock-still` is generative; Remotion path has
no `source=` tag. Never invent a hero without that line. Cleared photos are REFERENCES for HF by
default — do not treat them as a locked start frame unless the brief demands product fidelity.
Author binds images only from `clients/$ARGUMENTS/data/image-plan.json` (`source !== "none"`).
Roles `metrics` / `dense-copy` / `faq` / `spec-ledger` must stay `source: none` (no photo veils).
Atmosphere: `services/media-surface/ATMOSPHERE.md` (hatch accent ≤1/page; frost/planes/plates menu).
Parallel `run-lane` workers: same commands with that slug only — never write another client's plan/images.
Surface CSS ships in the template (`lift-panel`, `cinema-grade--dealer`, soft `hero-overlay--split`,
`band-go-mesh`/`go-frame`, `cta-primary--on-ink`). Do not re-author muddy overlays. Both shared
(multisite) and dedicated deploys use this artifact; only `assetPrefix` / `SITE_URL` change at deploy.

This removes any stale site directory, copies the template fresh, then copies gathered photos from `data/images/` into the site. The `data/images/` directory is the source of truth for photos — never download directly to `site/public/images/` as the template copy would overwrite them. You then write `globals.css`, `layout.tsx`, the shared chrome, and one `page.tsx` per route in § Site structure below.

### 🚫 Files that SHIP IN THE TEMPLATE — do not re-author them

`cp -r templates/trade-site` already brings these, finished:

| File | You supply |
|---|---|
| `src/app/_components/schema.ts` | the `seo` export in `site-data.ts` |
| `src/app/sitemap.xml/route.ts` | the `ROUTES` export in `site-data.ts` |
| `src/app/robots.txt/route.ts` | nothing — `SITE_URL` only |
| `src/app/llms.txt/route.ts` | the `llms` export in `site-data.ts` |

**Why:** measured on a 14-route build, the pipeline spent **47.8 of 55.8 minutes generating tokens**
and these four files are ~280 lines carrying **zero design surface** (`grep -c className` returns 0
on all four). They were being retyped, at high effort, on every build — along with the reasoning
needed to re-derive schema.org and canonical invariants this skill already states. Authoring them
once gives the AEO gates one chance to be right instead of one fresh chance to be wrong per client.

**Templated chrome (speed-cut 2026-08-21 — bluegrass 1:1 floor):** `layout.tsx`, `SiteNav.tsx`,
`SiteFooter.tsx`, and the full lift `globals.css` (hero-overlay, gauge-*, signature-spine, photo-ground,
grain, heavy CTAs, palette utilities). Opus fills `:root` + `site-data.ts` + fonts; does **not**
rewrite chrome structure or invent per-page nav. Pages are content only (`<main>` children).

**Still deliberately NOT templated:** marketing `page.tsx` routes and the blog article *copy*
(blog shells may ship; article bodies are unique). Freezing home/services/about/contact markup
across clients is the template-look failure the Anti-slop rules exist to prevent.

**Deviation is allowed, silence is not.** If a client genuinely needs a different graph — a trade
with no schema.org type, a real multi-location `LocalBusiness` split — override the file for that
client and write one line in `status.md` saying which and why.

#### The `site-data.ts` contract these four depend on

`next build` fails with a type error if any of these is missing, which is the enforcement — there is
no runtime fallback on purpose. A build that dies loudly beats a site that deploys with an empty
graph.

```ts
export const ROUTES: string[]            // every static indexable path, root-relative, incl. "/".
                                         // NOT /blog/<slug> (derived from POSTS). NOT noindex routes.

export const seo = {
  schemaType: "Plumber",                 // schema.org type for the trade
  schemaTypeWikidata: "https://www.wikidata.org/wiki/Q252924",  // optional; omit if unsure, never guess
  description: "...",                    // 1-2 sentences, sourced from gathered-content.md
  serviceCatalog: ["Water Heaters", ...],// real named offerings only, never padded
  primaryImage: "/images/gmaps2.webp",   // root-relative
  openingHours: OPEN_24_7,               // import { OPEN_24_7 } from "./schema"; OMIT if hours unknown
};

export const llms = {
  summary: "...",                        // one paragraph, renders as a blockquote
  keyFacts: ["Founded: 2003 by ...", ...],
  services: ["Plumbing repair, water heaters, ...", ...],
  notes: ["Do not invent prices...", ...],   // MUST be non-empty — see below
  routeLabels: { "/services/water-heaters": "Water Heaters" },  // optional, else derived from the slug
};
```

**`llms.notes` must never ship empty.** It is the only place we tell an assistant what NOT to say
about this business — prices it must not quote, warranties it must not promise, response times it
must not invent. An assistant that fabricates a price on the owner's behalf creates a real
commercial problem for a real person who never agreed to it.

**`seo.openingHours` — omit it rather than guess.** Invented hours are a false statement published
under the business's name, and Google surfaces them. Same rule as § Legal pages.

