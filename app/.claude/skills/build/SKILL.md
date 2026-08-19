---
name: build
description: Build a bespoke Next.js website from gathered content for a business
argument-hint: [business-name]
effort: high
allowed-tools: Bash(npx *), Bash(npm *), Bash(node *), Bash(python3 *), Bash(cd *), Bash(mkdir *), Bash(cp *), Bash(kill *), Bash(sleep *), Bash(*/notify.sh *), Read, Write, Edit, Glob, Grep

> ⚠️ **Terminal events only.** `NOTIFY_CHANNEL` fans out to two channels, so one call is two
> messages. Alert here ONLY if this failure stops the pipeline or needs a human now. Stage
> progress must stay silent — see CLAUDE.md § Alerting.
---

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

## Pre-build checks (MANDATORY - do these before writing any code)

### 0. Retrofit guard (CMS / booking system)
```bash
for m in cms.md cms-in-progress booking.md booking-in-progress; do test -f clients/$ARGUMENTS/data/$m && echo "STOP: retrofit marker $m present"; done; echo "check done"
```
If it prints any STOP, **do not rebuild.** This client's site has (or is mid-way through getting) a self-serve CMS (`/cms`) and/or a booking system (`/booking`); the rebuild below starts with `rm -rf clients/$ARGUMENTS/site`, which would destroy that wiring and orphan the owner's saved CMS edits in Vercel Blob. Edit the existing site in place instead (see the relevant skill's Maintenance section).

### 0.5 Reachability (only when `OUTREACH_ENABLED=true`)
Confirm at least one channel in `OUTREACH_PRIORITY` is viable for this client — `email` needs an `email`, `whatsapp`/`sms` need a mobile `phone`. Check the Supabase row AND `gathered-content.md` (gather often finds an email late — if so, write it to the client row now). If no enabled channel is viable and the client has no `facebook`/`instagram` for the manual-DM lane: **STOP — do not build.** Record "on hold: no enabled outreach channel is viable" in status.md and the client's `notes`, leave status at `gathered`, and alert via `bash scripts/notify.sh`. Do NOT mark `unreachable` — the client may have a contact method on a channel the operator simply hasn't enabled (an email under a whatsapp-only install, a phone under an email-only one), and the lead becomes workable the moment they enable it. A site you cannot send is a wasted build.

### 1. Photos
Read `clients/$ARGUMENTS/data/gathered-content.md` and verify it contains at least one actual photo URL (e.g. `lh3.googleusercontent.com`, `/images/`, `img02.restaurantguru.com`). If the Photos section has zero usable URLs, **STOP and go back to gather photos** before building. A site without photos looks like a generic template and wastes the lead. Do NOT proceed with a gradient-only hero and no images anywhere — that is not a bespoke website.

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
> ```
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

Every build must consume a fresh design system from `/ui-ux-pro-max` (skipping it is the biggest AI-generated tell — generic palette, predictable pairings, thin pages). Don't invent palette/fonts/layout ad hoc.

Run before writing any TSX/CSS:
```bash
# The OUTPUT IS THE ARTIFACT. Redirect it — a design consult whose result was never written
# down cannot be distinguished from one that never ran, and QA fails the build if this file
# is missing or thin. Run it BEFORE any TSX exists.
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<industry> <style keywords from gathered content>" --design-system -p "$ARGUMENTS" \
  | tee "clients/$ARGUMENTS/data/design-system.md"
```

**⚠️ Use the copy inside `app/.claude/skills/`, which is what this relative path resolves to
with `cwd=app/`. There is a second `ui-ux-pro-max` in the operator's global `~/.claude/skills/`
and it is a **React Native** skill — "this project's only tech stack" — with one data
directory. The vendor copy here carries 11 data CSVs and 13 stacks including `nextjs`,
`astro`, `html-tailwind` and `shadcn`. For a Next.js marketing site the vendor copy is the
correct one; the global copy would give mobile-app guidance for a web build. Verified
2026-08-16 — do not "fix" this path to point at the global skill.

Pick keywords from the business's actual personality — a Victorian-era barber, a sustainable landscaper, a fine-dining bistro all need different style keywords. Capture the returned palette (hex codes), heading + body fonts, and layout pattern. These become the inputs to globals.css and tailwind.config.ts below — do NOT hardcode Georgia/cream or any default.

If the recommended fonts feel safe (Fraunces/Outfit, Instrument Serif/Sora, Syne/Plus Jakarta Sans, Familjen Grotesk/Karla, etc.), do not blindly accept them — re-search the typography domain for something with more personality (see "How to pick fonts" below). The design system is a starting point, not a final answer.

### 3. Copy quality system from `anti-ai-slop` (MANDATORY — a tool call, not a preference)
`/ui-ux-pro-max` above is the design half of "does this look like a human made it". This is the writing half, and it is the half that ships in every headline the owner reads.

**Do this now, before writing a single visitor-facing string:**
```
Skill(skill="anti-ai-slop", args="ENFORCE mode (job A) — website copy for $ARGUMENTS")
```
That is a literal Skill tool call. Reading this paragraph is not the same as making it, and neither is remembering that em dashes are banned. The skill carries the 10 AI fingerprints, ~30 named slop patterns and 80+ banned phrases; the dash rule restated under "Anti-slop rules" below is one line out of all of that. Invoke it and hold the finished copy against its `eval.md` checklist before you consider the build done.

In scope: every headline, eyebrow, service name and description, About paragraph, review intro, FAQ answer, form label and CTA. Out of scope: component names, class names, comments, and anything the visitor never reads.

**This step runs even when the run is constrained.** A short run, a copy-only run, a rebuild of one section, a "just fix the hero" request — the copy still reaches a real business owner, so the gate still applies. The only way to skip it is if the run produces no visitor-facing text at all.

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
node services/hero-video/render.mjs --slug $ARGUMENTS
cd clients/$ARGUMENTS/site
```
Record the exact `HERO_VIDEO=OK …` or `HERO_VIDEO=FAIL …` line the render script prints into
`status.md` NOW, before writing any TSX — this is what `verify-hero-video.mjs` and the build
Verify gate check for, and doing it here means a kill at any later point cannot erase the fact that
the attempt happened. A `FAIL` (fewer than three usable photos) is a legitimate, recorded
degradation — carry on with the poster-only `<HeroVideo>` form, § Motion, chat and hero video below.

This removes any stale site directory, copies the template fresh, then copies gathered photos from `data/images/` into the site. The `data/images/` directory is the source of truth for photos — never download directly to `site/public/images/` as the template copy would overwrite them. You then write `globals.css`, `layout.tsx`, the shared chrome, and one `page.tsx` per route in § Site structure below.

### 🚫 Four files SHIP IN THE TEMPLATE — do not author them (added 2026-08-16)

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

**Deliberately NOT templated:** `blog/page.tsx`, `blog/[slug]/page.tsx`, `SiteNav`, `SiteFooter`,
`layout.tsx`. Those carry real visual design (the blog article renderer alone has 25 `className`s),
and freezing them across clients is exactly the template-look failure § Anti-slop rules exists to
prevent. **Do not "finish the job" by templating them too.**

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

## Site structure (MANDATORY — decide the page count before writing any TSX)

**Multi-page is the default, and the gate is CONTENT SUFFICIENCY — not the lane and not the prospect type.** A classic-lane business with no website at all gets `/services`, `/about` and `/contact` on exactly the same terms as a rescue-lane one: what earns a page is whether the gathered content genuinely fills it. A landscaper with eight named services and twenty photos gets the pages whether or not they ever had a website.

The two failure modes are symmetric and both are real:

- **Compressing rich content into a one-pager** gives the business one URL to rank, one `<title>`, one meta description and one H1 for their whole trade, and an owner comparing it against a competitor's site sees a brochure with no depth. This is the common failure and the one this section exists to stop.
- **Padding four thin pages out of one page's worth of material** is worse than one good page. It is the doorway-page pattern `/seo` warns about, it dilutes the copy, and the owner can tell. An honest one-pager beats four pages of filler.

### Incremental per-file check (run immediately after EACH page.tsx, not once at the end)

**Fable consult, 2026-08-19 — the pipelined-teams question.** The operator asked whether writer/
auditor work could pipeline (one page audited while the next is written). Verdict: full QA can't
— it needs the whole site (nav, shared components, cross-page duplication) and a fresh agent per
Rule 10/11, so pulling it page-by-page is net-negative. But a narrow slice of it IS free and real:
a handful of deterministic, PER-FILE text patterns need zero cross-page context and zero rebuild —
running them the instant each page.tsx is saved, instead of waiting for the full QA battery to
find them, deletes an entire fix-and-rebuild round when they'd otherwise be the only defect. On a
real live build the same night this was written, exactly this class of issue (an AI self-reference
phrase repeated on two pages, an em-dash pattern repeated across all five blog articles) was 4 of
6 total QA findings and the reason round 1 FAILed.

Run this after every single page.tsx (and blog-data.ts) you write — it's a few grep calls against
one file, not a rebuild, not an agent, seconds not minutes:
```bash
FILE=src/app/<route>/page.tsx   # substitute the file you just wrote (also run on blog-data.ts)
grep -inE "as an AI|I'm an AI|language model" "$FILE" && echo "FIX: AI self-reference — reword to e.g. 'automated chat software'" || echo "OK: no AI self-reference"
grep -nE $'\xe2\x80\x94|\xe2\x80\x93' "$FILE" && echo "FIX: em/en dash present — house style bans both, use a comma/period/restructure" || echo "OK: no em/en dashes"
IMGS=$(grep -o '<img' "$FILE" | wc -l); W=$(grep -oE 'width[={"]' "$FILE" | wc -l); H=$(grep -oE 'height[={"]' "$FILE" | wc -l); if [ "$IMGS" -gt "$W" ] || [ "$IMGS" -gt "$H" ]; then echo "FIX: $IMGS <img> but only $W width / $H height attrs — every img needs explicit width+height"; else echo "OK: img dimensions ($IMGS img / $W width / $H height)"; fi
grep -oE '[A-Z][^.!?<>{}]{40,}[.!?]' "$FILE" | sort | uniq -d | grep . && echo "FIX: the sentence above appears twice in this file — replace one instance with distinct copy" || echo "OK: no duplicated sentences"
```
Every line prints an explicit OK or FIX, so a clean file never leaves a failing exit code in the
transcript. Note the dash check catches en-dashes (U+2013) as well as em-dashes — both are banned.
This is NOT a substitute for the full ship-scan/richness/QA battery later — it only catches the
subset of defects that are genuinely per-file and pattern-matchable. Cross-page issues (shared-nav
contrast, whole-site gradient count, copy fingerprint against prior builds) still need the real
gates and still only run once, against the finished site — see § Verify and the QA Loop.

### Per-service pages — `/services/<slug>` (the commercial-intent lane)

**Ship a dedicated page for any service that can carry ≥120 words of TRUE, non-duplicated,
service-specific detail.** Services that cannot clear that bar stay as sections on `/services`.
Never split a service list just to multiply URLs — that is the doorway pattern, and `/seo` flags it.

**Why this exists (Jeff, 2026-08-16: "none of the services have their own page? is that a logic
thing that was worth reducing to one page?").** On demolition-okc the one-page call was CORRECT:
nine services were gathered, but with 4-25 words each ("Interior Demolition — Full interior
demolition services."), nine pages would all have been thin. The threshold worked.

**The miss was elsewhere, and it is the point of this section.** That same build wrote FIVE blog
articles of genuine depth on pool removal, land clearing, concrete breakup, interior demolition and
storm cleanup. The depth existed; it just landed on `/blog`, which serves research intent, instead
of on a service page, which serves BUYING intent. Someone searching "pool removal Oklahoma City"
wants a page that sells that service, not an article about it.

So when the blog research surfaces enough substance for an article, that same substance almost
always clears 120 words for a service page. Decide the two together:

| Service has | `/services` section | `/services/<slug>` page | Blog article |
|---|---|---|---|
| <25 words of real detail | yes | no | no |
| ≥25, <120 words | yes | no | maybe |
| ≥120 words of true, specific detail | yes (short, links to the page) | **yes** | yes, on a distinct angle |

A per-service page must carry: what the job actually involves, what the customer should expect
(sequence, access, mess, duration), at least one real photo of that work if one was gathered, and a
CTA. It must NOT invent prices, permit rules, timelines or regulated numbers — the same bar as the
blog. If it needs invention to reach 120 words, it does not qualify.

> 🚨 **A card grid quoting the gathered bullet verbatim is NOT a page — caught live 2026-08-16
> ("on AC it just ends up with 4 blocks and no text").** The-woodlands-plumbing-and-air's four
> dedicated service pages each shipped a hero + a 3-card grid where every card's body was the
> ~20-word gathered-content.md line, restated, and nothing else — real routes, real cross-links,
> but no actual page underneath the cards. **Apply § Blog's three-bucket truth rule here too, not
> just to articles**: bucket 1 (facts about THIS business — years, licence numbers, named
> equipment) stays gathered-only as above; bucket 3 (prices, permits, regulated numbers) stays
> forbidden as above; but **bucket 2 — trade craft, general knowledge of how the work is actually
> done, safe to state plainly — is not invention, and a light-content page needs it just as much
> as an article does.** Every sub-service on the page gets 2-4 sentences of genuine trade-craft
> prose under its heading (how the job is typically approached, what a homeowner should watch for,
> why it matters, how it's different from a related job) — not a caption restating the gathered
> line, an actual paragraph a reader learns something from. This is exactly the substance a blog
> article on the same service already contains; a page this thin next to a 700-950 word article on
> the identical topic is the tell that the card grid, not the content, was the shortcut.

Cross-link both ways: `/services` section → the page, and the page → the related article. Two pages
about the same job that ignore each other read as generated.

> 🚨 **This exact contradiction recurred the very next build after the paragraph above was
> written (the-woodlands-plumbing-and-air, same night, 2026-08-16) — now caught mechanically by
> `richness-check.mjs`, not just written down: a status.md with a real blog article and
> `/services/slug: no` on the SAME service is an automatic FAIL.** Do not count words twice with
> two different answers. If you are writing a genuine blog article for a service, that substance
> making it into 500+ words of article prose IS proof it clears 120 words — go write the service
> page from the same research, do not separately re-tally a shorter "combined" figure for the
> `/services` section and let that smaller number decide the page question. The two decisions are
> ONE decision, made once, from the deepest content you gathered for that service — never twice,
> against two different word counts.

**Record the per-service decision and counts in `status.md`** alongside the route decision, so QA
can check the judgement rather than re-derive it.

### The threshold (apply it literally, against `gathered-content.md`)

Run this decision before writing anything, and **write the outcome and the counts into `clients/$ARGUMENTS/data/status.md`** so QA and every later skill can see it was a decision rather than an accident.

| Route | Ships when | Otherwise |
|---|---|---|
| `/` | Always. | — |
| `/services` | **≥4 distinct named services**, each supporting **≥25 words** of true, non-duplicated detail from gathered content (what it covers, who it is for, how they do it). Counting "Landscaping" and "Landscape design" as two is padding — count distinct offerings, not synonyms. | Fold the services into a section on `/`. |
| `/about` | **≥2 of:** years trading or a founding year; a named owner or team; a credential, licence, insurance or accreditation; an origin/values passage in the business's own words; awards or press. Plus **≥150 words** of real narrative material. | Fold the story into a section on `/`. |
| `/contact` | The business is contactable at all (phone, email, or address). This is nearly always true and a contact page is never padding — it is the page a ready-to-buy visitor looks for by name. | Fold contact into a section on `/`. |
| `/blog` + 5 articles | **Always.** This is the one route with no content threshold, because its content is written rather than gathered — see § Blog. The outreach email sells "20 new blog posts a month, written for your business", so a site with no blog contradicts the pitch the owner is reading. | Never omitted. |
| `/privacy` and `/terms` | **Always, both of them.** No content threshold — see § Legal pages. Linked from the footer (or sub-footer) only, never from the main nav. | Never omitted. |
| extra routes | Only for genuinely rich content — a rescue target with distinct per-service or history pages (see § Rescue parity), or a service line with enough depth for its own page. | Omit. |

**If `/services` and `/about` both fail, ship a one-pager** — that is the correct output, not a failure. Record it: `Structure: one-pager. /services failed (2 distinct services), /about failed (no years, no credential, 80 words).` Never drop a route silently, and never drop one because it was more work.

**Never pad to hit the threshold.** Inventing a service, stretching one paragraph into three, or repeating the home page's copy on `/about` are all worse than the one-pager. Content comes only from `gathered-content.md` — that rule does not relax because a page looks short.

Whatever the count, write one `page.tsx` per route:

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Hero, the strongest photos, a services *overview* (linking to `/services` when it exists), proof/reviews, a short about teaser, contact CTA |
| `/services` | `src/app/services/page.tsx` | Every gathered service in full — what it covers, who it is for, the real detail from gathered-content.md |
| `/about` | `src/app/about/page.tsx` | The business's story, years trading, credentials/licences, area covered, team/owner, the photos that suit narrative rather than sales |
| `/contact` | `src/app/contact/page.tsx` | The contact form/mailto, full NAP block, opening hours, the CID Google Maps embed |
| `/blog` | `src/app/blog/page.tsx` | Index of the five seed articles: title, date, word count, standfirst, photo, link |
| `/blog/<slug>` | `src/app/blog/[slug]/page.tsx` | One article, rendered from `_components/blog-data.ts` via `generateStaticParams()` |
| `/privacy` | `src/app/privacy/page.tsx` | What this specific site does with a visitor's information — see § Legal pages |
| `/terms` | `src/app/terms/page.tsx` | Who runs the site, what it is and is not, whose words the reviews are — see § Legal pages |

**Shared chrome lives in components, never copy-pasted per page.** Create `src/app/_components/SiteNav.tsx` and `src/app/_components/SiteFooter.tsx` (the `_` prefix keeps the folder out of the router) and import them into every page. Duplicating the nav markup four times guarantees the four copies drift, and every later skill (`/cms`, `/booking`, `/qa-fix`) then has to patch it four times. If the sticky mobile CTA or an info strip is site-wide, it belongs in the chrome components too.

The template also ships three components you do NOT write yourself — `Motion.tsx`, `SiteChat.tsx` and `HeroVideo.tsx`. Mount the first two once in `layout.tsx` and use the third in the hero. Full instructions in § Motion, chat and hero video below.

**Hard rules:**

- **Nav links are real hrefs, not anchors.** `<Link href="/services">`, not `<a href="#services">`. In-page anchors are fine *within* a page (e.g. `/#contact` from the hero), but the primary nav must navigate. Use `next/link`, not bare `<a>`, for internal routes.
- **When ≥3 dedicated `/services/<slug>` pages ship (previous section), the nav's Services entry becomes a dropdown, not a flat link.** Caught live 2026-08-16 (the-woodlands-plumbing-and-air, 4 dedicated pages): shipping the pages without exposing them in the nav makes the site feel like it "collapsed to one page" even though the routes are real — a visitor has no way to discover them except clicking through `/services` first. With 1-2 dedicated pages a flat `Services` link to the overview is still correct — the dropdown earns its complexity only once there's a real submenu's worth of destinations.
  - **Never build the dropdown as a same-sized icon-card grid.** Four independent design-review passes (2026-08-18: ui-ux-pro-max, frontend-design, impeccable, taste-skill) converged on banning exactly that pattern — `impeccable`'s absolute-bans list names "identical card grids — same-sized cards with icon + heading + text, repeated endlessly" and `taste-skill` separately bans "3-column card layouts... the generic 3-equal-cards-horizontally feature row." It is the single most obvious AI-generated-dropdown tell, and it is also the first thing most people build.
  - **Branch on whether the services have distinct, real per-service photography** (check `SERVICE_CATEGORIES`/`services` entries in `site-data.ts` for an `image` field pointing at genuinely different files — not the same photo reused across every entry).
    - **Distinct imagery exists**: asymmetric two-panel split. Left: services as a plain vertical text list (name + one-line description, no icon-in-a-box). Right: a single image area that cross-fades to the hovered service's real photo (150-300ms, transform/opacity only). Directional hover feedback (thin underline sliding in from the side the cursor entered) instead of any per-item icon.
    - **No distinct imagery** (the common case — most clients reuse one hero photo across every service page): typographic list, numbered (`01`/`02`/`03`…) in a muted accent tint, generous row padding, no card/box background, a thin accent-colored underline that scales in on hover (`scale-x-0` → `scale-x-100`, `origin-left`), and a staggered fade-in on open (`transitionDelay: i * 30-40ms`).
  - Either way: desktop gets a chevron and `onMouseEnter`/`onMouseLeave` (or `onFocus` for keyboard) panel; mobile gets an expandable inline group (button + chevron toggling `max-h-0`/`max-h-[Npx]`, not a second-level route) listing the same links, no photo panel on mobile (screen too narrow for the split). Keep the category list itself in `site-data.ts` (e.g. `SERVICE_CATEGORIES`) so `SiteNav`, the `/services` overview cross-links, and each dedicated page draw from one array rather than three hand-maintained lists. Never gradient text on the service name, never a side-stripe accent border on the active row, never glassmorphism on the panel — all separately banned by `impeccable`.
- **Every page exports its own `metadata`** — a distinct `title` and `description` naming that page's subject plus the town. Four pages sharing one title is the same SEO failure as one page.
- **Exactly one `<h1>` per page**, specific to that page ("Landscaping services in Frisco", not the business name repeated).
- **Every page is a real page.** No route may be a thin stub or a redirect to a homepage anchor. A route that exists must clear its threshold above; if it cannot, fold the content into a sibling page and **do not create the route at all** — a 404 is more honest than a 60-word placeholder. Record the drop and the counts in `status.md`. **Working floor: any marketing page under ~120 rendered words is a stub** — QA hard-fails on that number, so treat it as the line, not a guideline.
- **Cross-link between pages** in body copy, not just in the nav — the services page links to contact, the about page links to services. Orphan pages reachable only from the nav read as filler.
- **`/privacy` and `/terms` ship on every build** and both live in the footer or sub-footer, never in the main nav. They are not marketing pages and the ~120-word stub floor is not the test for them; § Legal pages is.
- **Every page still obeys every rule in this skill** — photos woven through, no anchor-nav cliché, contrast, mobile CTA, the anti-slop pass. A polished home page in front of three thin subpages is worse than an honest one-pager.

Route additions from other skills (`/book` from the booking facade, `/admin` from `/cms`) sit alongside the marketing routes and are never counted toward the threshold.

## Legal pages (MANDATORY — `/privacy` and `/terms` on every build; full spec: `reference/legal-pages.md`)

**Jeff, 2026-08-16: "on every single build we need to port over our terms and conditions and privacy policy to be in the footer or sub footer, built for each site."** Both routes ship every time, no exceptions, no threshold.

**Read `reference/legal-pages.md` in full before writing either page** — it has the disclosure inventory (what to grep for and what each finding means for the copy), the chat-widget disclosure template, the per-page content spec, and the wiring checklist (canonical URLs, footer links, sitemap/llms.txt entries). This is not a section to skip or paraphrase from memory: these pages make legal representations on behalf of a business that never reviewed them, and a fabricated clause is a liability we manufactured for them.

**Kept here verbatim as a floor, never skip even under time pressure — the full never-write list, with reasoning, is in the reference file:** company registration number, VAT/EIN/tax number, a named data-protection officer, a statutory-rights recital (GDPR/CCPA), data retention periods, international transfer clauses, "we may share your data with trusted partners", a cookie table for cookies the site doesn't set, children's-privacy clauses, arbitration/venue/jurisdiction beyond the business's own state, indemnities, a money liability cap, prices/deposits/refund terms, guarantees or SLAs, licence/accreditation claims not in `gathered-content.md`, "your continued use constitutes acceptance", and any promise about what the business does with an enquiry after it reaches them. **The rule that covers the whole class: if you cannot point at the fact in `gathered-content.md`, `site-data.ts`, or code you just read, it does not go on the page.**

---
## Blog (MANDATORY — `/blog` plus five articles, on every build)

**Render article dates with a GUARDED anchor:**
```ts
new Date(/T/.test(post.published) ? post.published : post.published + "T12:00:00")
```
⚠️ **Do NOT append unconditionally.** An earlier version of this rule said to always concatenate
`"T12:00:00"`, and when the data already carried a time it produced `"2026-08-15T12:00:00T12:00:00"`
-> **Invalid Date**, which then shipped as visible copy on /blog and every article page until a
design audit caught it. `ship-scan`'s `[raw]` class now fails the build on it.
A bare `"2026-08-15"` is parsed as UTC **midnight**, so in every US timezone it renders as the
PREVIOUS day — every article on build 3 displayed 14 August for a 15 August date. Anchoring at local
noon sits far enough from both midnights that no UTC offset, and no DST transition, can push it
across a day boundary. A blog whose dates are all one day off is a small thing that reads as
carelessness on a site sent to a stranger.

**Why this is not optional.** ${PRICING} ${PRICING_TERMS} is sold partly on content: the outreach
email promises the owner "20 new blog posts a month, written for your business". A prospect who
reads that line, clicks the preview and finds no blog at all has been shown the product
contradicting the pitch in the same minute. Five real articles are the proof that the sentence
means something.

The blog is also the only route in § Site structure with **no content threshold**, and the reason
is structural: every other page is limited by what `gather` found, while an article is written.
There is no such thing as "not enough gathered content for a blog". There is only writing that is
worth a homeowner's time or writing that is not.

### Who the articles are for

**The business's CUSTOMERS. Never other businesses, never marketing, never us.** A landscaper's
blog answers the questions a homeowner types at 9pm: why water stands in the same corner of the
yard, how long to water new sod, what a stone patio needs after it is built. A barber's blog is
about hair. A blinds fitter's is about measuring a bay window and what happens to fabric in a
south-facing room. If an article would read as useful to a marketing agency, it is the wrong
article.

Derive the five topics from the business's own service list in `gathered-content.md`, one per
strong service where possible, and phrase each as the problem the customer has rather than the
service we sell. "Sprinkler checks you can do yourself before calling anyone" beats "Our
irrigation services".

### The three-bucket truth rule (this is the one that keeps you out of trouble)

Every sentence in an article falls into one of three buckets, and the handling differs:

1. **Facts about THIS business** — years trading, towns served, licence numbers, the free
   consultation, hours, financing. Only from `gathered-content.md`, exactly as § Photos and the
   rest of this skill already require. "They have twenty employees" when nothing says so is the
   same lie on a blog page as on the About page.
2. **Trade craft** — how clay soil takes water, why joints in a patio matter, what mulch depth
   does. General knowledge of the trade, safe to state plainly and the whole reason the article is
   worth reading. This is where the substance comes from, and it is why an article can be long
   when the gathered content is thin.
3. **Anything municipal, priced, dated or regulated** — watering-day schedules, permit rules,
   licensing bands, what a job costs. **Never assert a number.** Point the reader at the
   authority: "watering days are set by your city and change with drought stage, so check the
   current schedule for your address". A confident wrong ordinance is worse than no article.

**Publish dates are the build date.** Do not backdate five articles to fake a publishing history.
The owner opens the blog, sees five posts dated across the last six months that they know they
never wrote, and every other claim on the site becomes suspect.

### anti-ai-slop enforcement on blog prose — ONE real invocation, not two (Fable consult, 2026-08-18)

**Do NOT have the blog sub-agent invoke `anti-ai-slop` itself before drafting.** The prior version
of this section told it to — a second full ENFORCE-mode Skill call, on top of the one you already
ran for site copy at § Copy quality system above, re-injecting the same skill text a second time
for zero net gain: the sub-agent's draft still gets checked for real, just once, by the step below
instead of twice.

**The real gate is the mandatory post-hoc review**, unchanged and still load-bearing:

```
Skill(skill="anti-ai-slop", args="ENFORCE mode (job A) — blog articles for $ARGUMENTS")
```

Run this YOURSELF, after the sub-agent returns, against its actual finished prose (see "Then
review before you commit it" below) — checking real output against the real checklist is strictly
better evidence than trusting a sub-agent's own upfront self-certification, so nothing is lost by
moving this from "before drafting" to "after drafting, before committing."

Brief the sub-agent's prompt with a short inline summary instead (not the full skill): no
three-item-default lists (vary 4/5/6 to fit content), no identical section shapes across the five
articles, no closing recap or "Conclusion" heading, no rhetorical-question closers, end on the
phone number and free consultation, avoid AI-fingerprint openers like "In today's fast-paced
world...". Five formulaic listicles do more damage than no blog: an owner who skims one paragraph
of AI-openers has learned exactly what built the rest of the site. Article copy is the largest
block of prose on the whole site and therefore the largest slop surface on it — which is exactly
why the REAL check (your post-hoc eval pass) must not be the one that gets skipped.

Concretely, the failures that show up in blog copy specifically: three-item lists that were
three because AI defaults to three (make list length follow the content, 4/5/6 items are normal);
identical section shapes across all five articles; an ending that recaps the article the reader
just read; a "Conclusion" heading; questions as closers. End on the concrete next action, which
here is the business's phone number and the free consultation.

### Shape of an article

- **700 to 950 words each.** Long enough to be worth reading and to clear every extractability
  floor with room to spare, short enough that five of them do not double the build. (Gray
  Reserve's own marketing blog targets 1,500 to 2,500. That is a different job with a different
  economics: these are speculative builds at 50 to 100 a day and wall-clock is the binding
  constraint.)
- One `<h1>`, the article title. Four to seven `<h2>` sections. A standfirst under the title.
- One photo from `data/images/` (already gathered, already in `public/images/`). **Never generate
  or download a new image for an article** — no new bytes, no licence risk.
- A closing block that names the business, the licence or years if gathered, and the phone.
- A "more articles" list at the foot linking two siblings, plus a link back to `/blog`.

### Files — the TYPES and PAGE TEMPLATES ship in the template (2026-08-16); you write `POSTS`

**`blog-data.ts`'s `Post`/`Block` types, `blog/page.tsx`, and `blog/[slug]/page.tsx` are now
template files — copy them from `templates/trade-site/src/app/blog/` and
`templates/trade-site/src/app/_components/blog-data.ts` rather than authoring them fresh.** Added
after a real build hand-authored the types, exported `Block` inconsistently between files, and
shipped 5 articles with a broken build **and zero JSON-LD** — 26 AEO failures, caught by QA, that
a template removes the possibility of. `schema.ts` (already a template file) gained two new
exports for this: `blogPostingSchema()` and `blogIndexSchema()` — read them before touching the
article schema block.

| File | What it holds | Yours to write? |
|---|---|---|
| `src/app/_components/blog-data.ts` | `Post`/`Block` types + helpers ship in the template. **You fill in `export const POSTS: Post[] = [...]`** — slug, title, description, dek, published, image, `blocks` (`p` / `h2` / `list`). The single source of truth for article text; `wordCountOf()`/`readMinutesOf()` are computed, never typed by hand. | Content only |
| `src/app/blog/page.tsx` | Ships in the template — the index, cards from `POSTS`, full JSON-LD wiring. Restyle to match this client's design system; do not touch the schema/metadata block. | Restyle only |
| `src/app/blog/[slug]/page.tsx` | Ships in the template — the article, `generateStaticParams()`, `generateMetadata()`, full JSON-LD wiring. Restyle typography/spacing; do not touch `generateStaticParams`, `generateMetadata`, or the schema block. | Restyle only |

`generateStaticParams()` is load-bearing: under `output: 'export'` a dynamic segment without it
emits **no article HTML at all**, and `npx next build` still exits 0. The template ships it
correctly; do not remove it while restyling.

**Blog goes in the main nav.** Add `{ href: "/blog", label: "Blog" }` to `NAV_LINKS` and a footer
link. A blog nobody can reach from the nav is filler, and the breadcrumb `name` must match the
visible nav label character for character.

### AEO wiring (all of it, or the blog is invisible to the thing that pays for it)

Blog routes are routes: `aeo-check.mjs` walks every emitted HTML file, so a blog that skips any of
this fails the gate rather than passing quietly.

- **`BlogPosting`** per article, `@id` `<SITE_URL>/blog/<slug>/#article`, with `headline`,
  `description`, `url`, `mainEntityOfPage` pointing at that page's `WebPage` `@id`, `image`,
  `datePublished`/`dateModified`, `author` and `publisher` both `{ "@id": BUSINESS_ID }` (the
  business publishes it; **never invent a human byline**), `isPartOf` the `Blog` node, and
  `wordCount` computed from the blocks rather than typed.
- **One `Blog` node**, defined once on `/blog` (`<SITE_URL>/blog/#blog`), listing every article by
  `@id`. Defining it on each article instead gives you five `Blog` nodes and a duplicate entity.
- **`WebPage` per blog route too**, with the path in its `@id`. Reuse `pageGraph()`.
- **`BreadcrumbList` on every blog route**: Home > Blog on the index, Home > Blog > <article title>
  on an article. The article crumb name is its visible `<h1>`.
- **`alternates: { canonical: "/blog/<slug>" }`** in each article's `generateMetadata`, and
  `"/blog"` on the index. Without it every article declares itself a duplicate of the home page.
- **`sitemap.xml` and `llms.txt` need NOTHING from you here.** Both ship in the template
  (§ Setup) and derive the blog section from `POSTS` and `ROUTES` automatically — the sitemap
  stamps each article with its own `published` date, and `llms.txt` emits the `## Blog` list. Your
  only job is that `POSTS` is correct and `/blog` is in `ROUTES`. Do not hand-write either file, and
  do not hand-list article URLs anywhere: that is how the sitemap, the nav and `llms.txt` used to end
  up with three copies of the same link list and three chances to disagree.
- **`noindex` still applies** on a spec build. It is inherited from `layout.tsx`; do not add an
  index override on blog routes.
- **The shared chrome carries NAP onto every article.** `aeo-check` requires the business name and
  phone in the rendered text of **every** route, so an article page that drops `SiteFooter` fails
  the NAP check even though the article itself is fine.

### Cost, honestly (measured 2026-08-16 on a 10-route build)

| | Without blog | With `/blog` + 5 articles |
|---|---|---|
| Routes | 4 | 10 |
| `npx next build` | 5.12s | 6.05-6.57s |
| Exported `out/` on disk | 6,208 KB | 7,684 KB |
| An article page over the wire | — | 96-99 KB raw, **14.6 KB gzipped** (`/about` is 12.5 KB) |
| New images / fonts / JS | — | **none** (articles reuse gathered photos) |

`next build` is not the constraint. The constraint is **agent wall-clock**: five articles is
roughly 4,000 words of generated prose, which on the measured 39.6-minute default-effort build
adds an estimated 4 to 7 minutes, more at high effort. Budget for it before promising throughput,
and note that the marginal cost is nearly all writing time, not build time or page weight.

### Write the articles CONCURRENTLY with the pages (added 2026-08-16)

Those 4-7 minutes are serial time spent on prose that touches no design surface. Recover them:
once you have picked the five topics and `gathered-content.md` exists, spawn **one** sub-agent to
draft the article prose while you write `globals.css`, the chrome and the route pages.

This is the **only** build-stage delegation permitted — `CLAUDE.md` Critical Rule 10, Exception 2.
Read that rule before using it; it is bounded on purpose.

**`model="sonnet"`, not the parent's opus/high (Jeff, 2026-08-18 — "this is probably fine to do, we
use sonnet for Gray Reserve blogs").** This is the single largest remaining per-build token lever:
~4,000 words of prose at opus/high vs sonnet is real cost, and the safety net that makes a cheaper
drafting model tolerable is unchanged — you fact-check every claim against `gathered-content.md`
and run the real `anti-ai-slop` eval yourself on the returned prose either way (see above and "Then
review before you commit it" below). This is a quality tradeoff on drafting only, not on review.

```
Agent(subagent_type="general-purpose", model="sonnet", prompt="""
Draft 5 blog articles for {Business Name} as a `POSTS: Post[]` array for blog-data.ts.

TOPICS (already decided — do not substitute):
  1. ... 2. ... 3. ... 4. ... 5. ...

SOURCE OF TRUTH: clients/{slug}/data/gathered-content.md — read it first, in full.

THE THREE-BUCKET TRUTH RULE (verbatim from the build skill § The three-bucket truth rule —
paste the section into this prompt, do not paraphrase it):
  <paste>

SHAPE: <paste § Shape of an article>
TYPES: <paste the Post and Block types from the template's blog-data.ts>

Write in ${OPERATOR_LANGUAGE}. Return ONLY the POSTS array as TypeScript. No commentary.
""")
```

**Then review before you commit it.** Run `anti-ai-slop`'s eval over the returned prose exactly as
you would over your own, and check every factual claim against `gathered-content.md` yourself. The
sub-agent has less context than you do, not more — delegating the typing does not delegate the
responsibility, and a fabricated claim about a real business is the worst thing this pipeline ships.

If the sub-agent fails or returns something you would not send, **write the articles yourself**. A
lost 5 minutes is not a reason to ship prose you have not vouched for.

## Font
Do NOT use Inter, Geist, or system-ui (the Next.js defaults) - they scream "template". Remove any Inter/Geist imports from layout.tsx. **Read "How to LOAD the fonts" below before you write a single line of `globals.css`** — the loading mechanism is where this step silently fails. NEVER use `style={{ fontFamily: "system-ui, sans-serif" }}` or any inline fontFamily override - let globals.css cascade to all elements.

> 🚨 **`font-800` / `font-900` / `font-700` are NOT real Tailwind v3 classes — caught live on a real
> build, 52 occurrences across every page, every heading silently rendering at the browser default
> weight instead of the designed one.** This section and § Trade personality both describe heading
> weight numerically ("weight >=800") because that's how typography specs work — but numeric weight
> **in a Tailwind `className`** needs the NAMED utility, not the number as a class suffix:
> `font-thin`(100) `font-extralight`(200) `font-light`(300) `font-normal`(400) `font-medium`(500)
> `font-semibold`(600) `font-bold`(700) `font-extrabold`(800) `font-black`(900). So "weight >=800"
> means `font-extrabold` or `font-black` in a className — never `font-800`/`font-900`. This is a
> DIFFERENT axis from `next/font/google`'s own `weight: ["400","700","900"]` array (that one
> correctly takes numeric strings — it's a font-loading argument, not a Tailwind class, and is not
> what broke). Verify after any heading-weight change: `grep -c 'font-[0-9]00"' src/app -r` must be
> `0`, and `grep -c '\.font-[0-9]00{' out/_next/static/chunks/*.css` (the compiled artefact) must
> also be `0` — a source grep alone can look clean while the compiled CSS still has no rule for it.

### The font test: "Would a business owner think a human designer picked this?"
Before committing to any pairing, ask: would anyone guess AI picked this? If maybe, pick again.

### Mandatory: pick ONE typography formula, trade-masked (not always serif+sans)

**Corrected 2026-08-16 — this section used to contradict § Trade personality below it.** It said
every site MUST pair serif/slab heading + sans body; the trade-personality rule then correctly
FORBIDS a heavy trade from taking a serif and requires a grotesque instead — which is not serif or
slab at all. The rule and the example disagreed, and every build followed the rule, which is why
heavy trades kept shipping soft editorial serifs anyway. One formula, wearing different fonts per
client, is not variety — it is the same font-pairing bug the palette ladder had before `--ground`
existed, just in a different axis.

**Five named formulas.** Every one still bans two sans-serifs together with no contrast (flat, reads
AI-generated) — the contrast requirement survives, it just now has more than one valid shape:

1. **Display serif + humanist/geometric sans body.** The original formula. Soft trades — food,
   salons/spas, clinics, boutique retail, premium/DTC.
2. **Slab + sans.** Home services, general trades — a slab reads sturdy without the "wonky editorial"
   softness a high-contrast serif carries.
3. **Condensed/extended grotesque heading at weight >=800 + neutral grotesque body (400).** Heavy
   trades — demolition, excavation, roofing, concrete, towing, automotive, fabrication. Needs
   tightened tracking and all-caps or small-caps discipline on the heading to avoid reading generic;
   headings stay >=28px so a condensed face never goes illegible.
4. **Serif display + serif text, strong size/weight contrast (>=2.5x).** Heritage, law, editorial,
   established/legacy positioning. Only safe with a workhorse text serif (Source Serif, Literata
   text cuts) — two decorative serifs together is illegible, not distinctive.
5. **Any of 1–3, plus a mono accent confined to eyebrows/stat figures/nav labels only, never body.**
   Fabrication, tech-adjacent trades, anything wanting a technical/precise register.

**Pick the formula from the same evidence + seed logic as § Ground** — trade masks the field (heavy
trades: formula 3, never 1 or 4's soft serifs; soft trades: 1 or 2; heritage/legacy: 4), then seed
from the business name for variety within the allowed set. Record `TYPOGRAPHY_FORMULA=<n>` in
`status.md` next to `GROUND=`. Deviating from the trade mask is fine — deviation is allowed, silence
is not — but say why.

### How to LOAD the fonts — MANDATORY, and the one that breaks silently
**NEVER put `@import url('https://fonts.googleapis.com/...')` in `globals.css`.** Turbopack (the
Next 16 default builder) silently DROPS any remote `@import` whose URL contains a literal comma,
and every real Google Fonts pairing URL has one — an axis tuple (`Bodoni+Moda:opsz,wght@6..96,400`)
or a comma-separated weight list. The entire at-rule vanishes from the artefact. No build warning
fires, `globals.css` still greps perfectly, and the site ships in Georgia + Helvetica with the whole
typography step discarded. `/ui-ux-pro-max` hands you the pairing as a literal `CSS Import: @import
url(...)` line — **do not paste it in.** (A comma-free URL survives, which is why this looks random
rather than systematic. It is not random.)

Load fonts with `next/font/google` in `layout.tsx`. It self-hosts the woff2 into the build, so
there is no third-party request, no FOUT, and nothing that can go missing:

```tsx
// src/app/layout.tsx
import { Bodoni_Moda, Space_Grotesk } from "next/font/google";

const display = Bodoni_Moda({ subsets: ["latin"], display: "swap",
  weight: ["400", "600", "700"], variable: "--font-display-src" });
const body = Space_Grotesk({ subsets: ["latin"], display: "swap",
  weight: ["300", "400", "500", "700"], variable: "--font-body-src" });

// ...
<html lang="en" className={`${display.variable} ${body.variable}`}>
```

```css
/* src/app/globals.css — no @import, ever */
:root {
  --font-display: var(--font-display-src), Georgia, serif;
  --font-body: var(--font-body-src), 'Helvetica Neue', sans-serif;
}
```

The import name is the family with spaces as underscores (`Libre_Caslon_Display`, `Zilla_Slab`).
Only list weights the site actually uses. Variable-axis families still take a `weight` array here.

**Gate — run it after every build, it is not optional:**
```bash
node scripts/font-check.mjs clients/$ARGUMENTS/site
```
It fails the build if the artefact carries no webfont, or if any of `body`/`h1`/`h2`/`p`/`nav a`
renders in a fallback. Note that `getComputedStyle().fontFamily` alone CANNOT catch this — it
returns the declared stack whether or not the face ever loaded, so the script width-probes the
rendered glyphs instead. Do not declare the build done until it prints `FONT_CHECK=PASS`.

### How to pick fonts
1. Skip the `--design-system` font recommendation — go straight to typography domain search: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "INDUSTRY KEYWORDS" --domain typography -n 5`
2. Pick a pairing with serif/slab heading + sans body
3. Check both fonts against the banned lists below
4. **Uniqueness rule**: pass `--heading-font "<Family Name>" --body-font "<Family Name>" --town "<city>"` into the § Convergence check's `design-ledger.mjs check`/`record` calls below (once ground/formula/harmony/character are also decided) — don't invent a second, separate invocation. The ledger checks font-name reuse deterministically across full build history: `FONT_LEDGER=REUSE` on a heading-font match is a hard stop (never reuse the same heading font as another site, no exceptions); a same-town body-font match prints `FONT_LEDGER=WARN` (don't reuse the body font for neighbouring-town clients either, but it isn't a hard stop yet). This replaces the old "scan 3-4 recent client `globals.css` files" ad hoc skim — the ledger already has the full history, so there's nothing left for a manual scan to add.

### Banned fonts (never use in any position)
Inter, Geist, Roboto, Arial, system-ui, sans-serif, Barlow, DM Sans, Poppins, Open Sans, Montserrat, Raleway, Nunito, Syne, Plus Jakarta Sans, Familjen Grotesk, Karla, Manrope, Bricolage Grotesque

### Banned heading fonts (overused by AI — no longer look bespoke)
DM Serif Display, Playfair Display, Young Serif, Lora — every ChatGPT/Wix AI site uses these now. They are the new Inter.

### Avoid as body font (too invisible)
Space Grotesk, Figtree, Outfit — only acceptable when paired with a genuinely uncommon serif heading.

### Good heading fonts (distinctive, not yet overused by AI)
Bitter, Fraunces, Literata, Bodoni Moda, Zilla Slab, Vollkorn, Crimson Pro, Cormorant Garamond, Spectral, Eczar, Newsreader, Libre Caslon Display, Petrona, Brygada 1918, Instrument Serif

## Design rules
- Use the colour palette from `/ui-ux-pro-max` - never pick colours arbitrarily. **Brand-colour override**: if gathered-content.md's `## Brand` block has a `primary` colour, use it as the site **accent hue** so the site matches the business's real identity — but the accent NEVER goes on the page as one hex doing every job. Run it through § Colour roles below, which derives a compliant value per job from the same hue. No banned combos (e.g. purple-on-white). `/ui-ux-pro-max` still drives the overall system.
- Hero section with pt-20 for fixed navbar clearance
- **A fixed navbar must never be able to end up with NO background.** Own the solid
  state in the component's own React state (`useState` + a `scroll` listener in
  `SiteNav`), and set the class from it. Do NOT style it purely off the
  `data-scrolled` attribute `<Motion />` stamps — a pattern like
  `data-[scrolled=true]:bg-x data-[scrolled=false]:bg-transparent` matches NEITHER
  class when the attribute is absent, which is what happens under
  `prefers-reduced-motion` or any Motion failure. That shipped: on an iPhone you
  could read the page straight through the header. `data-nav` still goes on the
  `<header>` (the parallax and Motion's own sync use it); it is just not the only
  thing driving the background.
- **An open mobile menu is always opaque, at every scroll position.** The drawer
  painting a solid panel under a still-transparent top strip is the exact defect
  Jeff reported: "the nav bar doesn't have the color in the whole iPhone viewport,
  you can see content behind it". Compute `const solid = scrolled || isMobileMenuOpen`
  and use one class off that. Avoid `/95` + `backdrop-blur` on the drawer too —
  fully opaque reads as deliberate, 95% reads as broken.
- **Fixed navbar with a top offset requires every element above it to also be fixed** — otherwise the strip above (info strip: phone, hours, "Est. XXXX") scrolls away and exposes a gap of that offset (background bleeds through, looks broken). Fix: pin the strip `fixed top-0 left-0 right-0 z-50` too, or drop the offset and put the navbar at `top-0`.
- Mobile-first, responsive design
- Sticky mobile call button, but **hide it while the hero is visible** (hero has its own call button). `IntersectionObserver` on the hero → set `heroVisible`, and on the sticky CTA div `style={{ opacity: heroVisible ? 0 : 1, pointerEvents: heroVisible ? "none" : "auto" }}` with `transition-opacity duration-300`. Else two call buttons show on first load.
- **Sticky mobile CTA must be flush to the viewport edges, never a floating pill.** Always `fixed bottom-0 left-0 right-0` (no `bottom-4 left-4 right-4` margins) — a floating pill leaves body content bleeding above and below it on iOS Safari and looks broken. Add `paddingBottom: "calc(1rem + env(safe-area-inset-bottom))"` to clear the iOS home indicator. Full-width dark bar is the canonical pattern.
- **Card grids (service cards AND reviews/testimonials)**: `flex flex-wrap justify-center gap-6` with explicit widths `w-full md:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)]` + `flex flex-col` per card. NEVER `grid grid-cols-N` or CSS `columns` for cards — both strand an uneven last row (grid left-aligns it; `columns` voids). Applies to reviews too, where it ships most.
- **`grid grid-cols-12` MUST split the gap.** A bare `gap-10` adds 11×40=440px of column gap (wider than a 393px mobile viewport), so `col-span-12` items render 440px+ wide and text wraps off-screen. Write `gap-y-N md:gap-x-N md:gap-y-N` so column gap is 0 on mobile and only kicks in at md+. Never a bare `gap-N` on a 12-col grid.
- **Never combine `h-full` with `aspect-[X/Y]` on the same image wrapper** — they fight (aspect sets height from width; h-full from parent), and on mobile the image overshoots and overlaps the next sibling's caption. Use just the aspect class on the wrapper, `<img class="w-full h-full object-cover">` inside.
- **Marquee/ticker animation duration: 18–28s for a 2x-duplicated track.** 40s+ feels stuck and reads as broken. Default to ~22s.
- **Always set `html, body { overflow-x: clip; }` in globals.css.** Belt-and-braces against any stray wide element ever creating horizontal scroll. Use `clip` (preferred) over `hidden`; `hidden` creates a containing block for fixed children which can break sticky CTAs.
- **Hero background photo? Apply a uniform dark wash across the WHOLE image**, not an edge-only gradient (`from-char via-transparent to-transparent` leaves the middle bright and washes out cream/white text). Layer: (1) image, (2) solid `rgba(dark, 0.72)` full-image wash, (3) optional directional gradients for specific text zones. Photo is atmospheric texture, not competing with text.
- **Register palette colours in `tailwind.config.ts`, not only in globals.css.** Gradient utilities (`from-ochre`, `to-char`, `via-plaster-80`) need the colour in `theme.extend.colors`; a `.bg-char` class alone silently no-ops gradient stops, so overlays render nothing. Mirror every palette colour into tailwind.config.ts as a concrete hex. (globals.css utilities still serve opacity variants.)
- **NEVER add a "Scroll" indicator / chevron / blinking dot at the bottom of the hero.** AI-template cliché, and it breaks silently when its utility classes aren't defined (orphaned floating word). To hint at more content, use a bottom fade or let the next section peek at the fold.
- isMobileMenuOpen checked FIRST in navbar component
- Hex colours, SVG icons
- **Motion comes from `<Motion />` and the `data-` hooks below. Never hand-roll scroll animation.** The old rule here was "no scroll-triggered animations, content should be visible immediately", and the reasoning behind it still stands: hand-rolled reveals look janky and, worse, they hide content when they break. What changed is that the template now ships a provider (Lenis smooth scroll + GSAP ScrollTrigger) that is built to fail open, so the reveal is safe. Do not write your own IntersectionObserver fade-ins, do not add `opacity-0` + `animate-` utility pairs, and above all **never put a hidden state like `[data-reveal]{opacity:0}` in `globals.css`** — that is one JS failure away from shipping a blank page. See § Motion, chat and hero video.
- NEVER use `bg-opacity-XX` or `border-opacity-XX` Tailwind utilities - use slash syntax: `bg-white/15`, `border-white/30`
- **Special characters in strings**: NEVER use `\uXXXX` unicode escapes (e.g. `\u2019`, `\u2013`) — they get mangled when mixed between JS strings and JSX, rendering as literal `\u2019` on the page. Instead, just type the actual character directly: `'` (curly apostrophe), `–` (en dash), `—` (em dash). Modern JS handles UTF-8 natively. Also: `&apos;` only works in JSX text content (between tags), not inside JS strings where it renders literally.
- **Google Maps embed**: ALWAYS use the CID-based embed URL from gathered-content.md (`https://www.google.com/maps?cid=XXXXX&output=embed`). NEVER use search-based embeds (`maps/search/...&output=embed`) - they can pin the wrong location or show search results instead of the business.
- Content ONLY from gathered-content.md - never hallucinate services, reviews, or claims
- Press & story content (when gathered): re-express facts in the site's voice — short attributed quotes only, NEVER republished article prose (copyright sits with the outlet). On conflict, the business's own copy and Places data beat press (press goes stale; newer beats older). "As featured in <outlet>" only for verified coverage ABOUT the business; mere mentions support community-embeddedness copy only
- **Reviews displayed as social proof MUST carry a verified OVERALL star rating of 4 or 5 stars.** If a gathered review doesn't explicitly record the overall stars (e.g. it only shows a per-category sub-score from Restaurant Guru/TripAdvisor like "Food: 5/5", or the stars were never captured), do NOT include it. Mis-rating a 2-star review as 5-star social proof burns the lead the moment the owner sees it.
- Only include social media links (Instagram, Facebook, TikTok) if the business ACTUALLY has that profile. Never show an icon linking to a platform they're not on.

## iOS safe-area, one-line requirements (full story: `reference/ios-safe-area.md`)

Three requirements, all mandatory, all independently required — missing any one reproduces a
real shipped bug (a white/light strip above a dark fixed nav on a real iPhone, invisible in any
desktop browser or 1440x900 screenshot). Read `reference/ios-safe-area.md` before touching any of
this code; the condensed form below is not enough context to debug it if something looks wrong.

1. **Never a bare `env()` for clearance — always floor it**: `padding-top: max(env(safe-area-inset-top, 0px), 48px);`
2. **`html` background paints the strip, not `theme-color`**: `html { background-color: <the nav's surface colour>; }` in `globals.css`, PLUS the fixed nav needs a `before:` pseudo-element projecting its own fill upward (see reference file for the exact class string) so the strip revealed mid-scroll-collapse is nav colour, not page background.
3. **`theme-color` still required in every `layout.tsx`, but it does NOT fix #2 alone**:
   ```tsx
   export const viewport = { viewportFit: "cover", themeColor: "#<nav's surface colour, LITERAL hex — a CSS var resolves to nothing here>" };
   ```
   and the fixed nav pads itself: `style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}`.

Use the **NAV's** surface colour for both `html` background and `theme-color`, never the page's.

---
## Colour: choose CHARACTER first, harmony second

⚠️ **Corrected 2026-08-16 against the `color-expert` skill** (meodai's 171-file colour-science
reference, now installed at `~/.claude/skills/color-expert`). An earlier version of this section
said "pick the harmony deliberately, default analogous for trades". That is better than taking the
default, but it is still **hue-first**, and hue-first is the weak heuristic:

> "Complementary, triadic, tetradic intervals are weak predictors of mood, legibility, or
> accessibility on their own. Every hue plane has a different shape in perceptual space."
> "Organize by character (pale/muted/deep/vivid/dark), not hue — hue is usually a weaker predictor
> of emotional response than chroma and lightness."
> "Hue didn't matter. A pale or muted or dark palette — no matter what hue — people responded to
> it as calm."

**So decide CHARACTER from the business, then let harmony pick the hue inside it.**

| Character | Chroma / lightness | Fits |
|---|---|---|
| **Deep** | dark, HIGH chroma | demolition, excavation, roofing, automotive, security — weight and capability |
| **Vivid** | high chroma, any lightness | emergency/24-7 trades, kids, food, sports — urgency and energy |
| **Muted** | medium lightness, low chroma | clinics, law, accounting, funeral, wellness — calm and trust |
| **Pale** | high lightness, low chroma | salons, spas, boutique retail, interiors — airy and premium |
| **Dark** | low lightness, low-medium chroma | luxury, bespoke fabrication, high-end services — restraint |

The character must hold across the WHOLE palette. A deep accent beside a pale secondary reads as
two different sites, which is what a mismatched harmony produces and why it then goes unused.

**Then run the deriver with a harmony that stays inside that character** — the canonical, complete
invocation (all five decision flags together) lives at § Convergence check below, once ground/
ground-hue/formula are also decided; don't invent a partial call here. (Corrected 2026-08-19 —
Fable consult: this example previously showed `--light`/`--dark`, which § Colour roles below
explicitly forbids passing by default since it opts out of the derived tinted-neutral ladder
entirely. Two sections gave contradictory example commands; this is the one that was wrong.)

**`--character` is the flag that decides whether the site looks diverse or "all brown".**
Harmony picks the secondary's HUE; character places its lightness and chroma. Without it the
secondary inherits the ACCENT's character, so a vivid brand colour makes every derived option
vivid too — which is why one business produced either brass (reads mono) or electric cyan
`#00C5D9` (reads like a toy), with nothing usable between them.

Measured on Mike's Bobcat Service, brand `#FF8D13`:

| harmony | `vivid` (old default) | **`deep`** |
|---|---|---|
| `split` | `#00C5D9` electric cyan | **`#005861` deep teal** |
| `triadic` | `#2CC9AE` mint | `#005B4D` deep green |
| `analogous` | `#D1A93F` brass | `#614900` deep bronze |

`#005861` is genuinely a different colour from the orange — not a tint, not brown — while
being serious enough for demolition and grounded enough to sit on the warm surface ladder
without fighting it. **That is the combination to reach for: a real second hue, placed in the
site's character band.**

The brand accent is never re-characterised — it is their identity and stays as gathered.
Character governs the SECONDARY and the surfaces around it.

Mike's Bobcat Service is **Deep** — heavy demolition work. The default complementary harmony gave
`#52baf7`, an electric blue: correct arithmetic, wrong character, and the builder silently declined
to use it anywhere, so the site shipped mono. Analogous inside the same character gives `#D1A93F`,
a warm brass that sits beside construction photography instead of fighting it.

**Apply 60/30/10** (also from `color-expert`): 60% dominant surface, 30% secondary, 10% accent —
"one colour dominates to prevent three equally-sized gorillas fighting". That ratio is also the
answer to "how much secondary is enough": roughly a third of the coloured surface area, not a
token gesture.

**Invoke the skill for the actual choice.** `Skill(skill="color-expert")` at the design step, once
per build — it carries APCA guidance, token-graph structure, and perceptual-ramp technique that
this file only summarises. Do NOT bulk-load its `references/`: 212,000 words is a real cost at 50
builds a day. The 4,200-word SKILL.md answers most questions; individual references load on demand.

**Record the CHARACTER and the harmony in `status.md`**, so QA can judge the choice rather than
re-derive it.

## Ground: WHICH hue tints the neutral ladder, and WHICH lightness family (mandatory since 2026-08-16)

**This is the fix for "every site is the same white page with a rotated accent."** Measured across
two shipped clients: the neutral ladder was identical to three decimal places — because the ladder's
tint hue was hard-wired to the accent hue and its lightness family was a hardcoded constant. A
plumber's gold accent and a demolition contractor's orange accent both produced the exact same warm
cream-to-brown page, just relabelled. `derive-palette.mjs` now exposes both as independent choices
(`--ground-hue` and `--ground`), but the SCRIPT ONLY EXECUTES what you tell it — this section is
where the choice actually gets made, and skipping it silently reproduces the old behaviour (ground
defaults to the accent's own hue, family defaults to `light`).

### `--ground-hue`: evidence first, never a rotation

**Do not derive the ground tint from the accent by default.** Rank evidence in this order and use
the first that exists:

1. **The client's own live website**, if one exists (compete/rescue mode). One `npx playwright-cli`
   `eval` reading computed `background-color` on a few real sections is exact and free — this is a
   real business's own colour decision, already made.
2. **A second colour from the logo itself.** `brand-logo.py colours` returns a `dominant` list, not
   just one hex — read past the first entry instead of discarding it.
3. **A colour recurring across ≥2 gathered photos** (vehicle livery, signage, uniforms) — Read the
   photos yourself (you already do this for § PHOTO VISION GATE) and note any colour that repeats.
   One photo's colour is lighting noise; a colour appearing on the van AND the uniform is real.
4. **No real second colour anywhere.** Do not fall back to the accent hue by default — that
   silently reintroduces the bug this section exists to fix. Instead pick a hue **seeded from the
   business name** (same deterministic-per-business, varied-across-fleet mechanism the font picker
   already uses), constrained to a **cool-or-neutral arc (180°–260°)** when the accent itself is
   warm (0°–100°), and to a **warm-or-neutral arc** when the accent is cool. The constraint is not
   arbitrary: a warm accent on a warm ground is where "always brown" comes from, so the fallback's
   only job is to not repeat that specific failure while still being reproducible and non-uniform.

```bash
# Evidence found (their site's real background is navy):
node scripts/derive-palette.mjs '#FFC80E' --harmony split --character deep --ground-hue '#1B2040'

# No evidence — seeded fallback, warm accent (~88deg) forces the ground into the cool/neutral arc:
node scripts/derive-palette.mjs '#FFC80E' --harmony split --character deep --ground-hue 210
```

### `--ground`: the lightness family

Four families: `light` (the original — every site defaults here if you pass nothing), `cream`
(compressed light end, higher chroma — a warm editorial page, chosen deliberately, not arrived at
by accident), `deep` (mid-dark dominant ground, light relief bands), `dark` (near-black dominant
ground, more range than deep). **Every family still passes the exact same contrast machinery** —
`solveL` and the WCAG verification run identically regardless of family, so accessibility is never
the trade-off for choosing a non-light ground.

**What changes on `deep`/`dark`:** the semantic meaning of `--ink` vs `--on-dark` inverts in
practice. On `light`, most of the page uses `--ink` on light rungs and `--on-dark` is the exception
(footer, CTA bands). On `deep`/`dark`, most of the page IS a dark rung, so **`--on-dark` becomes the
default body-text token** and `--ink` is reserved for the light relief rung (surface-5 in that
family). Get this backwards and body copy is unreadable against its own ground.

**Long-form routes stay light-family regardless of the site's ground.** `/blog/*`, `/privacy`,
`/terms` run 700–950 words; light-on-dark at that length is a real readability regression, not a
stylistic choice. On a `deep`/`dark` build, author those specific routes against the `light` rungs
even though the rest of the site uses `deep`/`dark` — pass `--ground light` a second time for just
the tokens those routes need, or hand-place them on the family's relief rung.

**Photos need a plate on dark grounds.** An image with no border blooms against a near-black
surface. Add a 1px `--surface-4`-toned border or a subtle plate behind photos when `--ground` is
`deep` or `dark`.

**Which family suits which trade is judgement, not a lookup table** — a fixed trade→family mapping
would just be a different way of driving down the middle. Use the same evidence ladder as the hue
(their real site's actual mood, their signage) and let CHARACTER (above) narrow the field: `deep`/
`dark` character trades are the natural candidates for `deep`/`dark` ground; `pale`/`muted` suit
`light`/`cream`. Deviating from that is fine — deviation is allowed, silence is not — but say why in
`status.md`.

**Record `GROUND=<family>` and the ground-hue source in `status.md`**, next to the character and
harmony record. QA reads it to know which rungs are the "default" text ground before judging
readability.

### 🚨 Convergence check (mandatory, once all four decisions above are made, before ANY TSX)

Every axis above — ground family, ground hue, typography formula, harmony, character — is now
decided, and so is the font pairing from § How to pick fonts. Before writing a single `page.tsx`,
check the choice against the last builds — this same call also carries the font-uniqueness check
(§ How to pick fonts step 4), so don't invent a second, separate invocation.

**This is also the point to run the ONE canonical `derive-palette.mjs` call** that produces the
`:root` block you actually paste into `globals.css` — every decision it needs is now made, so this
is the single complete invocation; § Colour character and § Colour roles above both point here
rather than giving their own (previously contradictory) partial examples:
```bash
node scripts/derive-palette.mjs '<accent hex>' --harmony <type> --character <band> \
  --ground <family> --ground-hue <deg>
```

Then run the ledger check:

```bash
node scripts/design-ledger.mjs check $ARGUMENTS \
  --ground <family> --ground-hue <deg> --formula <1-5> --harmony <type> --character <band> \
  --heading-font "<Family Name>" --body-font "<Family Name>" --town "<city>"
```

**`DESIGN_LEDGER=TWIN` means this exact combination reads as the same site as a recent build** —
pick a different option from the trade-masked set (a different ground family, a different
typography formula, or a materially different ground hue) and check again. Up to 2 forced re-picks;
if still a twin on the 3rd attempt, proceed anyway and write `TWIN_ACCEPTED: <reason>` in
`status.md` rather than looping forever — the ledger is a steer, not a hard wall.

**`FONT_LEDGER=REUSE` is a separate, hard stop — no forced-re-pick allowance, no "proceed after 3
attempts."** It means the heading font collides, name-for-name, with a font already claimed by
another recent build. Pick a different heading font from the shortlist and check again; this axis
has no calibration period because the underlying rule is already mandatory prose (never reuse a
heading font) and the fix is free at this point (zero TSX written yet). `FONT_LEDGER=WARN` (a
same-town body-font match) is not a hard stop — note it in `status.md` and prefer a different body
font if practical, same posture as a `TWIN_ACCEPTED` deviation.

**Why this runs HERE and not after the site is built:** a twin (or a font collision) caught before
any code exists costs one more `node` call to re-check. Caught after `/build` finishes it costs a
full rebuild — and this pipeline's own measured cost is 86% output-token generation, so anything
that risks a rebuild directly fights the wall-clock target. Never skip straight to writing TSX "to
save time" — that is the one sequence that turns a free check into an expensive one.
`font-uniqueness-check.mjs` (part of the QA battery) re-verifies both the font pairing and this
uniqueness rule against the shipped artefact after `/build`, so a discrepancy still gets caught —
but catching it there costs a rebuild, whereas catching it here costs nothing.

`DESIGN_LEDGER=CLEAR` and `FONT_LEDGER=CLEAR` (or accepted after 3 attempts): run the record call
once the build is genuinely finishing, not before — recording before the site is confirmed to
actually use these choices would poison the ledger with a decision that was never built:

```bash
node scripts/design-ledger.mjs record $ARGUMENTS \
  --ground <family> --ground-hue <deg> --formula <1-5> --harmony <type> --character <band> \
  --heading-font "<Family Name>" --body-font "<Family Name>" --town "<city>"
```

### 🚨 Design manifest (mandatory, immediately after convergence, still before ANY TSX)

Added 2026-08-18 after a real build (aot-mechanical) shipped flat and generic despite the ground/
typography/harmony/character decisions above all being made correctly — the failure wasn't a bad
decision, it was that richness and motion were never planned as concrete commitments before writing
started, so under any time pressure (a watchdog kill, a long session) they were the first things
silently dropped. A decision that exists only as intent in a long session's context is exactly what
compaction (§ top of this file) discards first; a decision written to `status.md` survives a kill, a
resume, or a compacted re-read.

Before writing `globals.css` or any `page.tsx`, write a `## Design manifest` section to `status.md`
answering these five questions concretely — this costs a few hundred output tokens, not a
meaningful fraction of the build:

```
## Design manifest

- Photo-grounded sections (need 2+, richness-check hard-fails under 2): which TWO+ sections,
  using which specific photo from data/images/, at what wash opacity.
- Gradient plan (need 4+ declarations, richness-check hard-fails under 4): hero scrim + which
  section transition(s) + which card/panel wash(es), all `in oklch`.
- Section treatments (need 4 distinct — light, alt-light, dark, image/gradient-backed): which
  section gets which.
- Hero video: read back the `HERO_VIDEO=` line § Setup already wrote — confirm here which
  `<HeroVideo>` form this build uses.

Grain target: <opacity, per § Visual richness's ladder>.
```

This is a plan, not a promise — if a section's real content genuinely can't support a photo ground
once you're looking at the actual page, deviate and say so in the same status.md section (deviation
is allowed, silence is not, same rule as everywhere else in this file). The point is that richness
is DECIDED before the first `<section>` is typed, not discovered as a gap by QA forty minutes
later — the HARD-BLOCKER CONTRACT
below is what QA grades the finished site against; this manifest is what makes clearing it the
default outcome of writing the site once, not a second pass.

## Trade personality — the design must LOOK like the trade

An independent design audit of a live build, 2026-08-16, returned this verdict and it is the most
useful sentence written about this engine:

> "A clean, competent, **completely anonymous** small-business template wearing a coffee-shop
> typeface. Nothing about the design says *demolition*. Swap the copy and photos and it could sell
> candles, physiotherapy, or estate law."

The build had shipped **Fraunces** — a soft, high-contrast editorial serif, the font of bakeries and
DTC skincare — as the display face for a company that demolishes swimming pools, and had sanded the
client's loud safety-orange logo down into "burnt caramel". Every mechanical gate passed.

**RULE — typeface class by trade.** Heavy trades (demolition, excavation, roofing, concrete, towing,
automotive, fabrication) take a **condensed or extended grotesque, or a slab**, at weight >=800.
They must NOT take a high-contrast "wonky" editorial serif (Fraunces, Recoleta, Canela and
relatives). Soft trades (salons, spas, clinics, florists) invert this. Record the class and the
reason in `status.md`.

**RULE — honour the logo's colour.** If the client logo has a dominant saturated colour, the site's
primary accent must be recognisably that colour, not a tasteful reinterpretation of it. A logo that
visibly disagrees with the CTA in the same header bar is a defect, not a palette choice.

**RULE — no verbatim repetition across surfaces.** No sentence may appear word-for-word in more than
one place on a page (the audit found the hero subhead repeated in the footer and the services intro).

**RULE — stat strips carry externally meaningful numbers only.** Years trading, jobs completed, tons
hauled, response time, review score. **"9 Services offered" and "7+ Towns served" are banned** —
nobody hires a demolition contractor because he offers nine services, and it reads instantly as
generated scaffolding. Fewer than three real stats means show two, never pad.

**RULE — an image may hold at most ONE role per site** (hero | service card | gallery | blog cover).
The audit found 4 of 6 "Recent Work" photos were the same files used on service cards and blog
covers, i.e. stock presented as portfolio to a 30-year local operator's prospects. A repeated
filename across roles is a build failure.

**RULE — "our work" means client photos.** A section labelled recent work/projects may contain only
client-supplied imagery. Fewer than 4 available means one featured project block, or drop the
section. Every gallery image gets a caption: service + neighbourhood.

**RULE — galleries render a complete rectangle.** If the item count does not fill the last row,
change the column count or crop the set. More than one empty cell reads as a bug, and the audit
found exactly that: a 4-column grid with 6 items leaving a dead field.

**RULE — call-first businesses show the phone at display scale** (>= H2) at least once per page. The
number IS the CTA for a trade audience. **This means ONE CTA object, not a pair** — a display-scale
phone link plus a plain text secondary link (e.g. "or send a message ↓"). A solid accent button next
to a `border-2` ghost-outline button is the single most common AI-landing-page tell there is; if the
phone is the CTA, nothing should be visually competing with it for primacy. Caught live 2026-08-18
(Fable design-lift sweep): the identical solid-pill + ghost-outline two-button pair appeared in
every hero and every closing band across every shipped client, silently contradicting this rule the
whole time it existed — a rule with no gate checking for the pattern it forbids doesn't stop it.

**RULE — banned CTA headlines**: "Ready to get started?", "Get in touch today", "Let's work
together". Reference the trade or the owner instead — "Got something that needs to come down?"

**RULE — no single section-opener formula repeated across the page.** Caught live 2026-08-18
(Fable design-lift sweep): every section on every shipped client opened with the identical anatomy
— uppercase `text-sm font-semibold tracking-widest` eyebrow, then `<h2>`, then a muted paragraph —
18 instances on one build, 11 on another. Two prospects comparing sites see identical section
skeletons wearing different words; it is as fleet-wide a tell as the CTA-pair one above. Rotate
across at least 3 of these per page, chosen by section content rather than applied in fixed order:
(a) the eyebrow+h2+paragraph formula, used sparingly, not as the default; (b) an oversized section
numeral (`01`, `02`…) beside the heading instead of an eyebrow; (c) a side-rail label — a short
vertical or inline tag running along the section's edge rather than centered above the heading; (d)
an inline-accent headline where the emphasized word carries the accent color directly, no separate
eyebrow line; (e) for a photo-grounded section, a caption-style opener sitting over or beside the
image rather than a stacked eyebrow/heading block. Record which openers were used per section in
`status.md` so a future build can check against it, the same way font/palette uniqueness is tracked.

**RULE — services are not a uniform icon-chip grid; ground them in real photography when it
exists.** Caught live 2026-08-18 (Fable design-lift sweep): both shipped clients rendered every
service as an identically-sized card — small generic SVG icon, name, one-to-two sentence blurb —
while real gathered photos for those same services never reached the section. Uniform icon cards
with no imagery is as recognizable an AI-landing-page tell as the icon-grid nav dropdown banned
above, and for the same reason: it is the first thing anyone builds without thinking about it.
Check each service entry in `site-data.ts` for a distinct `image` field (not the hero photo or
another service's photo reused). If distinct photos exist for at least half the services: build
photo-grounded tiles (gathered image + the heavy colour-wash treatment from § Section treatments
below) sized so at least one tile visibly breaks the grid (spans two columns, or sits taller) rather
than every tile matching. If no distinct photography exists: do not fall back to icon chips either —
use the typographic numbered-list treatment (see the nav-dropdown "no distinct imagery" case above)
adapted to full-width rows instead of a dropdown panel, one row per service, no icon, no card
background.

**RULE — the footer is not the generic three-column template.** Caught live 2026-08-18 (Fable
design-lift sweep): despite `SiteFooter` being marked "deliberately NOT templated" (§ above), both
shipped clients independently converged on the same default anyway — logo+blurb column, a "Quick
Links"/"Pages" link column, a contact/hours column, plus a © + Privacy/Terms sub-bar. That
convergence without a template means the model's own unprompted default IS this pattern, so it has
to be named and forbidden explicitly, not left to "don't templatize it" alone. Build a
contact-dominant footer instead: the phone number at display scale (matching § call-first businesses
above), the service area written as a short prose line rather than a bulleted list, and a single
link row (not a labeled column) for the handful of real nav destinations. Generic column headers
("Quick Links", "Pages", "Resources") are themselves a tell — if a link row is needed, it needs no
header at all.

**RULE — link labels are verbs + object, <=3 words.** Not "View selective interior demolition
details". And icons must be literal for the trade: a pool outline for pool removal, not a generic
wave; a broken branch for storm cleanup, not a weather-app cloud.

**RULE — one photographic treatment across all imagery.** Stock and client phone photos must be
graded to cohere. A portrait-orientation source may never fill a landscape container wider than 2:1.

## Section treatments: photo grounds, overlays and texture (the missing "ingredients")

Operator, 2026-08-16: *"I don't see photos with color overlay in section backgrounds, that's like
ghosted in — you know where the background is 80% or 85% opacity over a photo. I don't see textures
in sections as needed."* He is right, and it is the single biggest reason a page reads flat even
with a good palette: **every section is a flat fill.** Six surface rungs give you six flat colours.

**At least TWO sections per page must be PHOTO-GROUNDED**, using a gathered photo behind a heavy
colour wash so the image reads as texture rather than as a picture:

```html
<section class="relative isolate overflow-hidden grain-dark">
  <img src="/images/work2.webp" alt="" aria-hidden="true"
       class="absolute inset-0 -z-10 h-full w-full object-cover" width="1200" height="800" />
  <!-- 80-88% wash. Below ~78% the copy fights the photo; above ~92% the photo is wasted. -->
  <div class="absolute inset-0 -z-10 bg-[--surface-6]/85"></div>
  …content…
</section>
```

Rules that make this work rather than look muddy:
- **Wash opacity 80-88%.** Contrast is still governed by `contrast-check.mjs`, which composites the
  alpha — so the wash must be dark enough to carry `--on-dark` text at 4.5:1. Verify, do not guess.
- **`aria-hidden` + empty `alt`.** It is texture, not content; a screen reader must not announce it.
- **Use a WORK photo, not the hero.** Reusing the hero image as a background reads as running out of
  material.
- **Pair it with `grain-dark`.** Photo + wash + grain is what gives the "ghosted in" depth; photo +
  wash alone still looks like a flat overlay.
- **Never put a photo ground behind a form or a dense table.** Legibility beats atmosphere.

**And every flat section still carries `.grain` / `.grain-dark`** at 0.12 / 0.16. A page where only
one or two sections have texture reads as inconsistent rather than restrained.

## Typography variation — pick by SEED, not by top match

The type pool is 65 pairings and **the picker is deterministic**, so every demolition contractor in
the fleet ships Fraunces / Albert Sans. Verified 2026-08-16: three different phrasings of the same
industry returned the same pairing twice. That is the "same font every time" the operator sees, and
it is a fleet-level tell — two prospects who compare their sites see the same typeface.

**Take the top 3-5 matching pairings and choose among them by SEED**, the same way `<Motion />`
derives its character from the business name:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<industry> <keywords>" --domain typography -n 5
```

Then pick deterministically from that shortlist using the business name — same business always gets
the same fonts (builds stay reproducible), different businesses in the same trade get different
ones. **Every candidate on the shortlist is already trade-appropriate**, so this buys variety at no
cost to fit. Record the shortlist and the chosen pair in `status.md` so QA can see it was a choice.

If a trade returns fewer than 3 credible pairings, widen the query (add tone words: "bold",
"editorial", "utilitarian", "premium") rather than accepting the single top hit.

## ⛔ HARD-BLOCKER CONTRACT (mandatory — the QA gate below grades against this exact text)

**Your output is auto-FAILED by an independent judge if any of these are TRUE.** This is the exact
text `qa-reviewer.md` checks the built site against — verbatim, not paraphrased, so there is zero
drift between what you are asked to build and what grades it afterward. Build to clear all 5 as
FALSE, not merely to look good to yourself.

1. **HERO** — TRUE if the hero is blank or type-only on a business whose work is visual (no
   dominant photo/video moment filling the frame).
2. **SERVICES/PRICING LIST-TELL** — TRUE if services/pricing is a plain numbered or bulleted list of
   name+price rows, OR if any service shows a specific dollar figure ("$" + a number — real service
   facts never include a price).
3. **IMAGERY** — TRUE if any photo reads as generic stock, an unrelated illustration, or a
   mismatched screenshot rather than genuinely belonging to this business.
4. **LAYOUT** — TRUE only if the ENTIRE page is a centered stack / equal-width grid throughout with
   no structural idea anywhere (one strong asymmetric moment elsewhere clears this).
5. **COLOR** — TRUE if the most-saturated accent hue does more than 3 distinct jobs (functionally
   monochrome), OR if there is no genuine second tone doing real structural work and the page never
   shifts temperature while scrolling.
6. **RICHNESS** (added 2026-08-18, verbatim-shared with `richness-check.mjs`'s own hard-FAIL
   thresholds) — TRUE if any of: fewer than 4 gradient declarations shipped; fewer than 2
   photo-grounded sections (a gathered photo behind an 80-88% wash); grain opacity below the
   visible threshold (~0.10 light / ~0.14 dark). This is the item a build clears by following the
   § Design manifest checkpoint BEFORE writing TSX, not by patching it in after — catching it here
   costs nothing, catching it in QA costs a full re-review because a richness fix touches
   `globals.css`/`_components/`, which are escalation triggers.

**Why prose rules alone don't work here, and why this is a contract rather than more guidance:**
measured directly tonight — the design-consult tool (`ui-ux-pro-max`) recommended Playfair Display +
Inter for a live build, both already on this file's own banned-overused list two sections down. A
tool that is SUPPOSED to prevent sameness recommended the sameness. Prose guidance degrades under
exactly this pressure; a small set of TRUE/FALSE checks, shared byte-for-byte with the grader, does
not — there is nothing to interpret generously on either side.

This pattern is proven, not invented for tonight: `gr-no-website-builds`'s `art-director.mjs` ships
the identical mechanism, and its own code comment states the result plainly — *"Zero added wall-clock
or Opus cost — this is a prompt-only change, prevention instead of catch-and-refine after the fact."*
That matters here specifically because output-token generation is 86% of this pipeline's wall-clock
(measured 2026-08-16) — a fix that adds ~zero output tokens is the only kind of design fix that does
not fight the 35-minute build-time target.

## Composition: the difference between a 7 and a 10

The gates below make a page *correct and rich*. They cannot make it *striking*, and a build that
satisfies every one of them can still read as competent-but-safe — which is what the operator meant
by "design needs a big lift too". These are the compositional moves that separate the two, measured
against what a 7/10 build actually shipped.

**1. ONE dominant scale contrast per page.** The design consult returns a headline scale like
`clamp(3rem, 10vw, 12rem)` for a reason: a hero headline that is merely large reads as a template,
one that is *enormous* reads as art direction. The 7/10 build shipped headlines at ordinary sizes
and dropped the clamp. If the consult hands you a scale, USE IT — on the hero, and once more
somewhere below the fold (a stat figure, a pull quote, a section number).

**2. Break the grid exactly once per page.** Everything else can be a tidy 3-up. One element should
escape it: a photo that bleeds off the right edge, a card offset vertically from its rowmates, a
quote that overhangs its container. A page where every row is the same shape reads as generated no
matter how good the palette is.

**3. Asymmetry in the hero.** Centred hero + centred subhead + two centred buttons is the single
most recognisable AI-site signature. Push the headline to a 7/12 column, let the media take the
remainder, and let them overlap slightly.

**4. Section transitions, not just section colours.** Six surface rungs give you grounds; what
makes them feel authored is how they MEET. Use an angled or curved divider, an overlapping card
that straddles the boundary, or a gradient that resolves into the next ground — at least once.

**5. Type pairing must actually contrast.** The consult returns a serif/sans pair. Use the serif at
display weight for headlines and the sans at 400 for body — do not level them to the same weight and
size class, which throws away the pairing that was chosen for the trade.

**6. Photography needs varied crops.** A grid of six identically-cropped 4:3 photos is a contact
sheet. Mix one tall portrait crop, one wide establishing shot, and let one image be significantly
larger than its neighbours — the same "density and interaction, not palette size" principle the
colour reference applies to hue.

**7. Numbers deserve emphasis.** Real figures from `gathered-content.md` (years trading, jobs done,
review count) carry `data-count` and should be set at display scale in the accent or secondary, not
as body text. A "30+ years" set at 16px is a wasted proof point.

⚠️ **None of this licenses inventing content.** Every one of these is a treatment of facts already
in `gathered-content.md`. If the gather is thin, the answer is a shorter page, not a padded one.

## Visual richness (MANDATORY — the design system must reach the page)

**Gated by `node scripts/richness-check.mjs clients/$ARGUMENTS/site`, which runs in QA and FAILS the
build.** Prose here is not enough — that is the whole lesson of the build this section came from.

Measured on the live demolition-okc build, 2026-08-16. Every skill RAN and every existing gate
PASSED — contrast was 934/934, ship-scan clean, PageSpeed desktop 100/100/100. The operator's verdict
on seeing it was **"2 out of 10"**, and he was right, because correctness and richness are different
questions and nothing was asking the second one:

| what the system produced | what reached the page |
|---|---|
| 38 palette tokens, incl. a derived complementary `--secondary: #52baf7` | **used 0 times** |
| a gradient system | **1 gradient** on the whole site (the hero scrim) |
| a `.grain` texture overlay | shipped at **opacity 0.05** — below human perception |
| 6 sections | **3 distinct** background treatments, all neutral |

Nothing was broken. The build painted a rich system with four crayons.

### Section rhythm comes from the SURFACE LADDER, not from more hues

`derive-palette.mjs` now emits `--surface-1` through `--surface-6`: six brand-tinted grounds walking
LIGHTNESS while holding chroma fixed and low, at the brand hue.

This exists because the palette previously offered three surfaces, and three is not enough to
compose rhythm from. The measured result was 6 sections / 3 treatments / all neutral, and the
operator's "i dont see section backgroudns". **The build was not being lazy — it had run out of
surfaces.**

Straight from the colour-science reference, and it is the answer for a mono-brand client too:

> "Tight constraint, then variation — variety comes from **density and interaction, not palette
> size**." / "**Lightness variation at fixed chroma** — depth and atmosphere without losing palette
> identity (use OKLCH)."

So you never need to invent a second hue to make a page feel rich. You build the ladder.

**Compose a long page from at least four rungs**, and never place two adjacent sections on the same
one:

| Rung | Use |
|---|---|
| `--surface-1` | hero / first section — the lightest ground |
| `--surface-2` | default page background |
| `--surface-3` | alternating section, card grounds |
| `--surface-4` | recessed band — quotes, stat strips |
| `--surface-5` | mid-dark band, to break a long light run |
| `--surface-6` | deepest ground — footer, final CTA |

`--surface`, `--surface-alt` and `--surface-dark` remain as aliases so existing markup keeps
working; prefer the numbered rungs on new work.

Contrast still governs everything on top: `contrast-check.mjs` runs against whatever you place, and
`--ink` / `--on-dark` are the solved text colours for the light and dark ends of the ladder.

### Canvas mode: FULL-TINT (default) vs NEUTRAL-CANVAS (the luxury lever)

**Every rung above is brand-tinted, including the ones the code calls "neutral."** That is
deliberate — FULL-TINT is the right default for most trades, where a colour-forward page reads
warm and approachable. But it means the page's *base* — hero, body copy sections, the default
ground a visitor sits on for most of a scroll — always carries the brand hue, never a true white
or true dark. **Caught live 2026-08-16** (Jeff, looking at a blue-brand HVAC build): "the AC is
cool, but I think would look more luxury with a white background and colored sections vs all blue
variants... think Ritz-Carlton." He is describing a second, real mode this system did not yet have
a name for:

| | FULL-TINT (default) | NEUTRAL-CANVAS |
|---|---|---|
| `--surface` / `--surface-alt` (page base, most sections) | drawn from the tinted ladder (`--surface-1`/`-2`) | **true neutral** — `#ffffff` / near-white for a light-first brand, true near-black (`#0a0a0a`-ish, not a tinted `--surface-6`) for a dark-first one |
| The 6-rung tinted ladder | used everywhere, is the whole rhythm system | **demoted to an accent device** — used only on a minority of sections (a stat strip, a testimonial band, the footer) as deliberate colour punctuation against the neutral base |
| Reads as | warm, colour-forward, approachable — right for most everyday trades | restrained, premium — restraint IS the signal, same reasoning § Colour CHARACTER already gives for `none` harmony on jewellers/tailors/galleries/funeral masons |

**Choosing it is a CHARACTER decision, made once, at the same point you pick harmony** — not a
per-section toggle. Default FULL-TINT for everyday service trades. Consider NEUTRAL-CANVAS when
the gathered content itself signals premium positioning (high-end brands serviced, decades of
awards, a heritage/family narrative, premium pricing already implied) even inside an "ordinary"
trade like HVAC — a colour-saturated page under-sells a business the content says is upmarket.
**Record the choice in `status.md`** next to the harmony decision, same as CHARACTER.

### Motion usage floors (the engine now offers six hooks — use them)

Amplitude was only half the problem. The other half was REACH: for a long time the engine offered
four hooks, so a page could be fully compliant and still animate in two places, which is why the
live site drew "motion is low ... i mean usage in the site".

Per page, the floor is:
- **every section below the hero** carries `data-reveal`
- **every multi-item grid** carries `data-reveal-group` on its wrapper
- **the hero media** carries `data-hero-media`
- **`data-count` on every real figure** the gather produced — years trading, jobs completed, review
  count. The attribute holds the TRUE number and the text is only replaced while animating, so a JS
  failure leaves the authored figure in place. Never invent a statistic to animate.
- **`data-parallax` on at least one mid-page image** if the gather returned photos. The second half
  of a page is where motion historically died.

Amplitude was lifted at the same time (rise 18-34px -> 36-64px, duration 0.55-0.85s -> 0.7-1.0s,
stagger 0.05-0.11s -> 0.09-0.16s, parallax 8-16% -> 14-24%, plus a 0.985 scale settle). An 18px
rise over 0.55s is below the threshold at which a visitor registers that anything moved. These are
still seeded per business, so fleet variety and reproducibility are preserved.

### The floors

1. **Use the secondary.** `derive-palette.mjs` computes `--secondary` precisely so a page has a
   second hue. Deploy it on eyebrows, stat figures, icon strokes, dividers, link hovers, or one
   section wash. Never on body text — it is derived for contrast in *accent* roles, and
   `contrast-check.mjs` still governs anything textual.
2. **Four gradient declarations minimum** (promoted 2026-08-18 to match `richness-check.mjs`'s hard
   FAIL threshold — a build that follows a "two" floor now fails QA on instructions it obeyed),
   built from tokens rather than hand-picked hex: a hero scrim, at least one section transition,
   and at least one card or panel wash. A page of flat fills reads as stacked slabs.
3. **Grain must be visible**: ~0.10-0.14 on light surfaces, ~0.14-0.20 on dark. Shipping an
   invisible texture costs the same to render and buys nothing, while *looking* finished.
4. **Four distinct section treatments** across a long page — light, alt-light, dark, and one
   image- or gradient-backed. Alternating two neutrals is a stripe, not rhythm.
5. **Stagger the grids.** `data-reveal-group` on every multi-item wrapper (service cards, photo
   grids, review cards, FAQ lists). Whole-section fades read as a slideshow; stagger reads as craft.

**HyperUI is deleted from this pipeline (2026-08-19) — see § Verify's note further below for the
full reasoning.** Every section here is authored directly against the design system, richness
rules, and composition guidance in this file, with no external component library involved.

## Photo art direction (mandatory) — the real ceiling on "premium"

**Scraped Google Maps/Facebook photos are inconsistent raw material — customer-uploaded, uneven
light, no art direction.** Award-tier sites art-direct their photography; this pipeline cannot
commission new photography, but it CAN treat what it has the way a designer would. Right now it
doesn't: every photo across every measured client ships as a bare `<img>` in a plain rounded
rectangle — literally `aspect-[X/Y] overflow-hidden rounded-lg` and nothing else. Even the hero's own
overlay is `bg-surface-6/75` — a **uniform** darkening scrim, which is the specific pattern this
section bans.

**Every hero-weight and section-anchor photo (not every incidental thumbnail) must commit to ONE of
three treatments**, tied to the derived palette so it varies per client automatically instead of
being one more thing every site does identically:

**1. Duotone / tonal grade** — grayscale the photo, then blend a brand token over it:
```css
/* globals.css */
.photo-duotone { position: relative; }
.photo-duotone img { filter: grayscale(1) contrast(1.08); }
.photo-duotone::after {
  content: ""; position: absolute; inset: 0;
  background: var(--accent);       /* or --secondary for a second family of photos */
  mix-blend-mode: color;           /* luminosity also works — try both, pick what holds the subject */
  opacity: 0.7;
}
```

**2. Graphic containment** — break the plain rectangle with a shape or a brand-coloured plate offset
behind the image, instead of a uniform `rounded-lg`:
```tsx
<div className="relative">
  <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-lg bg-accent/25" aria-hidden />
  <div className="relative aspect-[4/5] overflow-hidden rounded-lg" data-photo-treatment="contained">
    <img ... />
  </div>
</div>
```
An asymmetric `clip-path` polygon is the other valid form of this — either way the point is the same:
the photo is no longer a plain rectangle floating on the page.

**3. Directional scrim** — for text-over-photo (hero, section dividers): a gradient, never a flat
overlay. `bg-surface-6/75` uniformly darkening the whole frame is the exact defect; the fix is a
gradient that's strongest where the text sits and clear elsewhere:
```tsx
<div className="absolute inset-0 bg-gradient-to-t from-surface-6/90 via-surface-6/30 to-transparent" aria-hidden />
```

**Mark every treated photo** with `data-photo-treatment="duotone|contained|scrim"` on the wrapper —
this is what the gate below checks, and it is far more reliable than trying to infer treatment from
arbitrary Tailwind class soup. An untreated incidental thumbnail (a small icon-adjacent image, not a
hero or section-anchor photo) does not need the attribute — treating every single image would read
as heavy-handed, not designed.

**Gate:** `richness-check.mjs` fails a build whose hero-weight photos carry zero `data-photo-treatment`
attributes anywhere in the site. Deviation is allowed (a genuinely strong photo can stand alone) —
document which photo and why in `status.md` if you deliberately leave one untreated.

## Images: WebP + responsive variants are STANDARD (never ship a source photo)

**Run before every build, no exceptions:**

```bash
node scripts/optimise-images.mjs $ARGUMENTS
```

`output: 'export'` means **`next/image` optimisation does not exist** — there is no server to resize
on request. Whatever `/gather` downloaded is byte-for-byte what a phone pulls over cell data, and
nothing else in the pipeline shrinks it.

Measured, and the diagnosis matters more than the fix: PageSpeed gave demolition-okc **desktop 100
and mobile 77**, LCP 5.3s, "Est savings of 748 KiB". `hero.jpg` was 790 KB. But it was already
1920px wide, so resizing did nothing, and WebP at q82 saved **2%** — the photo was high-entropy
rubble that simply does not compress.

**The waste was never the format. It was a phone downloading a 1920px hero to paint a 390px
viewport.** The ladder fixes it: hero at 640px is **72 KB against 790 KB, a 91% cut** on the exact
asset driving LCP.

So the script emits `640/1024/1600/1920` WebP variants, and **the TSX must use them**:

```html
<img src="/images/hero.webp"
     srcset="/images/hero-640.webp 640w, /images/hero-1024.webp 1024w,
             /images/hero-1600.webp 1600w, /images/hero.webp 1920w"
     sizes="100vw" width="1920" height="1285" alt="..." />
```

- **`width` and `height` are mandatory on every `<img>` — and MUST be the file's REAL pixel
  dimensions, not the CSS box.** They exist to reserve the correct ASPECT RATIO; a guessed pair
  distorts the image. Measured 2026-08-16: a 325x116 logo (2.80:1) shipped as `width="180"
  height="32"` (5.63:1) because the numbers were taken from the Tailwind classes `h-8 max-w-[180px]`
  — exactly double the correct ratio, so the logo rendered squashed. Read the dimensions from the
  file (`sips -g pixelWidth -g pixelHeight`, or sharp's metadata) and let CSS do the sizing. Lighthouse flags their absence; without
  them the browser cannot reserve space, which costs CLS and delays LCP. The last build shipped
  **51 of 51** images without them.
- **Logos stay PNG.** They carry alpha and sit on varying surfaces; a WebP logo that loses
  transparency is far more visible than the few KB saved.
- **Originals stay in `data/images/`**, so a re-run is idempotent and a bad conversion is recoverable.

## Two Lighthouse rules that cost real points

- **`theme-color` — see the section above.** Without it an iPhone paints a white band above a dark
  navbar. Invisible on desktop and in every 1440x900 screenshot.
- **Descriptive link text.** "Learn more" tells neither a crawler nor a screen reader what is on the
  other side; the last build shipped 6. Write "Learn about pool removal", not "Learn more".

**Expect SEO ~61 on a spec build and do not chase it.** Lighthouse caps SEO when a page is
`noindex`, which spec builds are deliberately. It resolves to ~100 when `/seo` lifts the noindex at
conversion. Performance, Accessibility and Best Practices have no such excuse and should be 95+.

## Precedence when the design consult and the colour system disagree

Two systems now hand you colour, and they will conflict. The order is settled (Jeff, 2026-08-16:
"but color theory should probably win i think") and it is not a tie-break — each owns what it is
actually good at:

| Decision | Owner | Why |
|---|---|---|
| **The brand accent itself** | the business's real logo colour | identity. Never overridden, never re-characterised. |
| **Every other colour** — secondary, surfaces, text, semantics | `derive-palette.mjs` + `color-expert` | it solves for CONTRAST and CVD arithmetically and is verified by `contrast-check.mjs`. A recommendation cannot promise 4.5:1 against this client's actual surfaces; the deriver proves it. |
| **Layout pattern, section order, STYLE, KEY EFFECTS** | `/ui-ux-pro-max` | it holds 161 product types and reasoning rules for exactly this. |
| **Typography pairing** | `/ui-ux-pro-max` | its pairings are matched by trade and mood, and it returns a literal CSS import. |

So on Mike's Bobcat the consult returned "Industrial grey + safety orange (#64748B / #94A3B8 / CTA
#F97316)". Overriding that with the client's real `#FF8D13` and a derived deep-teal secondary is
**correct** — it is their brand, and the derived pair is contrast- and CVD-verified against the
actual surfaces, which a generic palette cannot be.

**But dropping the STYLE and KEY EFFECTS was not correct**, and that is the distinction. The same
consult returned `clamp(3rem, 10vw, 12rem)`, `font-weight: 900`, `letter-spacing: -0.05em` under
"Exaggerated Minimalism", and the build silently ignored all of it. That is the difference between
a page that commits to a look and one that is merely tidy.

**Deviating is allowed; silence is not.** Any recommendation you do not apply must be named in
`status.md` with a reason. `richness-check.mjs` fails the build on an undocumented drop, and a
colour deviation justified by this precedence table is a one-line note, not an argument.

## Colour roles (mandatory — derive, don't validate)

**Every accent that ever touches text is DERIVED by `scripts/derive-palette.mjs`, never picked
and then checked.** The failure this kills was measured, not imagined: three consecutive builds
shipped a mid-tone saturated accent (blue #10a0e0, gold #ca8a04, green #6ab42f) as link text on
white AND as a fill under white text, at 2.5-2.9:1 — and none of them *looked* broken, because
blue-on-white reads as tasteful link styling. A mid-tone saturated colour essentially never clears
4.5:1 against white in either direction; that is arithmetic, and no reviewer catches arithmetic in
a screenshot. So the compliant values are computed up front and the raw accent is barred from
text jobs entirely.

Run it once per build, from the repo root, with the accent hue (brand `primary` if gathered,
else the `/ui-ux-pro-max` primary) and the harmony chosen from the industry table below. **Use the
one canonical, complete invocation at § Convergence check** (carrying `--character`/`--ground`/
`--ground-hue` alongside `--harmony`) to produce the `:root` block you paste — not a bare
`--harmony`-only call. (Corrected 2026-08-19 — Fable consult: this section previously showed a
bare `--harmony`-only example and told you to paste ITS output, which silently re-derives with
`character=vivid, ground=light, ground-hue=accent` — exactly the defaults § Ground exists to
override. The design-ledger convergence check records the *decision*, not which flags the
paste-producing call actually carried, so this drift was invisible to every other gate.)

**Do NOT pass `--light`/`--dark` by default.** With no surface flags the script DERIVES the
surfaces from the brand hue at very low chroma (page C 0.006, card C 0.010, dark section
C 0.014 in OKLCH) — tinted paper instead of stock grey. A warm gold brand on a cold grey-white
is one of the clearest generated-vs-designed tells this pipeline can ship; the tint band is
chosen so it reads as temperature, never as a colour cast (above ~0.015 at L≥0.95 a surface
reads "stained"; below ~0.004 sRGB rounding erases the tint entirely). Use the emitted
`--surface`, `--surface-alt`, `--surface-dark`, `--ink`, `--ink-muted`, `--on-dark`,
`--on-dark-muted` as THE site neutrals — never introduce a freehand grey or a `#ffffff` page
background alongside them. The flags remain ONLY for the rare build whose design genuinely
needs a specific surface (e.g. pure white product cards): pass them and every text role re-solves
against what you passed. It prints a `:root` block — paste it into `globals.css` verbatim and
mirror the values into `tailwind.config.ts` like any palette colour. It must end
`PALETTE_DERIVE=PASS`; a FAIL means an override surface is wrong (e.g. a mid-grey as "light").

**Choosing `--harmony` — by industry and gathered tone, never a coin flip.** The secondary hue
is a named relationship on the OKLCH hue wheel, executed deterministically by the script. Pick
the row that matches the trade, then let the TONE of `gathered-content.md` override one step
toward calm (bold choice → its calmer neighbour) if the business reads heritage/family/quiet,
or one step toward bold if it reads loud/modern/performance:

| Trade family | `--harmony` | Why |
|---|---|---|
| Care, trust and quiet authority: funeral homes, medical/GP, accounting, law, physio | `analogous` | Adjacent hues carry no tension; the palette says calm competence. Never complementary — a funeral home does not want colour drama. |
| Home services: plumbing, electrical, locksmith, cleaning, HVAC | `split` | Contrast enough to look confident, without complementary's vibration. The default when unsure. |
| Outdoor and land: landscaping, gardening, tree surgery, fencing, pools | `split` or `analogous-warm` | A green brand's split partner is a berry/crimson (garden colours); its literal OKLCH complement is violet, which reads generated, so complementary is wrong for green brands specifically. |
| Food and hospitality: cafés, restaurants, bakeries, catering | `analogous-warm` | Appetite lives in the warm arc; a cool secondary next to food photography kills it. |
| High energy: gyms, auto performance, demolition, martial arts | `complementary` | Maximum hue tension is the point. Best from blue/orange or red/teal brands. |
| Children and play: children's dentists, nurseries, party services, tutors | `triadic` | Three-hue playfulness without random rainbow; the script caps secondary chroma so it stays grown-up. |
| Premium/heritage: jewellers, tailors, galleries, funeral masons | `analogous` or `none` | Restraint IS the luxury signal; `none` (single hue + tinted neutrals) is legitimate here and only here. |

Record the row you used (one line in `data/status.md`: `harmony=split (home services)`), so the
choice is auditable. The script also tie-breaks the two possible rotations of
analogous/split/triadic away from violet (280–330°, the AI-slop band) and away from the error
anchor (27°) — that logic is documented in the script header, not repeated here.

The derivation keeps the brand HUE exactly and moves only lightness, in OKLCH, so the darkened
gold is still unmistakably that gold — this is invisible to a reader and is NOT flattening the
design. What it forbids is one hex doing three jobs:

| Token | Job | Rule |
|---|---|---|
| `--accent` | decorative: borders, icon strokes, glows, plates, rules, focus rings | **NEVER text, never a surface under text.** The brand value untouched — this is where full brand brightness lives. |
| `--accent-text` | accent-coloured words on light surfaces (links, eyebrows, price, stats) | use INSTEAD of `--accent` wherever text is accent-coloured |
| `--accent-text-dark` | accent-coloured words on dark sections | same, for dark surfaces |
| `--accent-fill` + `--on-accent-fill` | deep accent surface + its text: solid CTAs, chat bubble, badges | the pair travels together |
| `--accent-fill-bright` + `--on-accent-bright` | the brand value as a block + a deep same-hue ink | the OTHER pair. **Never white text on the bright fill** — that is the exact measured failure. |
| `--secondary` / `--secondary-text` / `--secondary-fill` + `--on-secondary-fill` | the harmony hue: secondary buttons, tags, alternating section accents, chart second series | same laws as the accent family — `--secondary` is decorative-only, the fill pair travels together. Use it so the site has a REAL two-hue scheme; a one-hue site with grey everything else is the template look. |
| `--surface` / `--surface-alt` / `--surface-dark` | page, card/section, dark-section backgrounds | the site's ONLY neutral surfaces — brand-tinted, see above |
| `--ink` / `--ink-muted` / `--on-dark` / `--on-dark-muted` | body text, muted text, and their dark-section counterparts | the ONLY neutral text colours. `--ink-muted` is solved ≥4.5 on both light surfaces — never write a freehand grey again. |
| `--success`/`-text`/`-text-dark`/`-surface`, same for `warning` `error` `info` | form validation, toasts, booking confirmations, stock/availability badges | anchored to convention hues (error stays red, always). `--X` is icon/border strength (≥3:1), `--X-text` passes on the light surfaces AND on `--X-surface`. |

**Semantic collision rule.** If the brand hue sits within 20° of a semantic anchor the script
reports `SEMANTIC COLLISION` (a red-branded business collides with error; gold with warning;
green with success; blue with info). The semantic KEEPS its convention hue — a teal "error" to
dodge a red brand would be worse, because users read state by colour before words — and
separates by lightness (the colliding `--X-text` solves to 6.0:1, measurably darker than
`--accent-text`'s 4.6) and by FORM: on a collision, that semantic never ships as bare coloured
text. It always appears in the full semantic pattern — icon + `--X-surface` tint + `--X`
border — and that pattern is barred from any brand/marketing use, so the shape alone
disambiguates. (Colour is never the only indicator anyway, WCAG 1.4.1; on a collision that
rule is the answer, not belt-and-braces.)

**Ground/secondary separation.** `derive-palette.mjs` also prints `⚠️ GROUND/SECONDARY TOO CLOSE`
when the ground-hue (§ Ground above) and the harmony-derived secondary land within 60° of each
other — added 2026-08-16 after a real build (ground-hue 210, split-harmony secondary at 178,
only 32° apart) drew the operator verdict "color theory seems a bit off". Both are correct in
isolation — the ground-hue fallback rule and the harmony rotation off the accent have never known
about each other — but a ground and a secondary that close read as one muddy neutral family
instead of a deliberate two-hue scheme, even though nothing is technically wrong. If you see this
warning, change the harmony type (moves the secondary) or the `--ground-hue` (moves the ladder)
and re-run before treating the palette as final; the script does not auto-correct this because
either change needs its own contrast/CVD re-check.

Pairs never mix: `--on-accent-bright` on `--accent-fill` is unchecked and not allowed (same for
the secondary pair). Set
`--chat-accent: var(--accent-fill); --chat-on-accent: var(--on-accent-fill);` so the chat widget
inherits a compliant pair automatically. Muted/secondary text colours are not exempt: any
non-derived colour used as text must itself be checked against its real surface — the backstop
gate in § Verify computes every rendered element, so a freehand 4.4:1 grey will fail the build.
Additionally, `node scripts/contrast-check.mjs --tokens src/app/globals.css` audits the token
set STATICALLY — it fails if any derived token is missing from `:root` or any declared pair
no longer passes, which catches tokens that only render on interaction (error states, toasts)
and can't be caught from a screenshot of a resting page. Run it right after pasting the palette;
it must print `TOKEN_CHECK=PASS`.

## Anti-slop rules (from frontend-design)
- **Copy passes the `anti-ai-slop` skill before it ships.** Invoke `Skill(skill="anti-ai-slop")` in ENFORCE mode (job A) once before writing any visitor-facing string, and run its `eval.md` checklist over the finished `page.tsx` copy. Every headline, eyebrow, service description, About paragraph, FAQ answer and CTA is in scope; component names, class names and comments are not. It kills the 10 AI fingerprints, ~30 named slop patterns and 80+ banned phrases — the writing-quality equivalent of the `/ui-ux-pro-max` mandate above, and skipping it produces the same "an AI spat this out" tell. The dash ban below is one of its rules, restated here because it is the one that ships most.
- NEVER use em dashes (`—`) or en dashes (`–`) anywhere a reader sees them (body copy, hero, eyebrow labels, service descriptions) — they're a recognisable AI-output fingerprint. Use commas, full stops, colons, or parentheses. Time ranges use a hyphen `-` (e.g. `Mon-Fri 07:30-17:00`). Dashes are acceptable only inside JSX comments or technical strings the user never reads.
- NEVER use purple/violet gradients on white backgrounds - the #1 AI slop tell
- NEVER use predictable, cookie-cutter layouts - break visual monotony with asymmetry and variety
- DO use dominant colours with sharp accents, not timid evenly-distributed palettes
- DO add atmosphere: the § Texture, depth & iconography pass below is the concrete, mandatory form of this rule

(Font bans and the serif/sans-contrast + ui-ux-pro-max mandates live in the Font and Pre-build sections above.)

## Texture, depth & iconography (mandatory — the anti-flat pass)

Flat colour blocks with hard edges between them, one icon repeated across every service card, and
un-framed photo rectangles are the three loudest "AI template" tells after fonts. Every build ships
the three treatments below. The whole pass is CSS/SVG only — no image assets, no new network
requests, roughly 1KB of CSS plus ~0.3KB per inline icon (measured +6.3KB across a full four-route
site) — and every colour in it derives from the `/ui-ux-pro-max` palette variables in `:root`.
Never hardcode a hue in a treatment, and never pick a motif that reads as one industry (leaves for
everyone is a landscaping tell on a barber's site). Vary the expression per client — grain
strength, glow hue and corner, plate colour — so two sites in the same town don't share a
fingerprint. Restraint wins: the failure mode is a site that looks *decorated* rather than
*designed*, and uniform maximal decoration is a worse tell than flatness.

**1. Grain on every flat section.** Every solid-colour section carries an SVG-noise overlay via a
`::after` data URI (~340 bytes, feTurbulence). The section needs `relative overflow-hidden`.

> ⚠️ **Opacity raised 2026-08-16 — the old numbers shipped an invisible texture.** This said ~0.05
> light / ~0.08-0.10 dark, the build followed it exactly, and the live result measured 0.05/0.09
> with the operator reporting "i dont see ... textures". Below roughly 0.08 the noise is under the
> perceptual floor on a flat fill: it renders, it costs the same, and nobody sees it — which is
> worse than shipping none, because the page *looks* finished. Light **0.10-0.14**, dark
> **0.14-0.20**. `richness-check.mjs` fails a build under 0.08.

```css
.grain::after, .grain-dark::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.12;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}
.grain-dark::after { opacity: 0.16; }
```

**2. Depth on dark sections: a corner-pooled accent glow.** A dark block reads as a flat colour
switch until something pools light in it. One low-alpha radial of the palette accent, in a corner:

```css
.glow::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(80% 65% at 85% -5%, rgba(ACCENT_RGB, 0.18), transparent 60%);
}
```

The glow MUST pool in a corner the section's text does not occupy (usually top-right, since text is
left-aligned). This was measured, not guessed: on a real build a glow peaking under the text zone
dropped a passing muted eyebrow from 5.03:1 to 4.45:1 — an AA fail introduced by the decoration
itself. After adding it, re-measure the smallest/lowest-contrast text in that section against
**rendered pixels** at the glow peak.

**3. One icon per service, drawn from the service's actual name.** Never repeat a single glyph
across the service cards — eight cards sharing one leaf is the sameness a scanning eye catches
first. In `_components/Icons.tsx`, draw one 24x24 stroke icon per named service (consistent family:
`fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"`),
derived from what the service IS — pickets for fencing, a droplet over spray arcs for irrigation,
shears for a barber, a pan for a caterer. Export a name-keyed `ServiceIcon` lookup with a fallback
so site-data stays plain strings. Sit each icon on a low-opacity accent chip so cards anchor on
colour, not bare glyphs (`.icon-chip { display:inline-flex; height:2.6rem; width:2.6rem;
align-items:center; justify-content:center; background: rgba(ACCENT_RGB, 0.12); }`, ~0.3 alpha on
dark sections). A repeated decorative *bullet* in a checklist is fine; repeated service-card
identity icons are not.

**4. Frame editorial photos.** Standalone photos (intro, about, beside process steps) get a quiet
offset plate instead of sitting as bare rectangles:

```css
.frame-plate { position: relative; }
.frame-plate::before { content: ""; position: absolute; inset: 0.75rem -0.75rem -0.75rem 0.75rem;
  background: rgba(ACCENT_RGB, 0.18); pointer-events: none; }
.frame-plate > * { position: relative; }
```

```tsx
<div className="frame-plate aspect-[4/3] rounded-sm">
  <div className="h-full w-full overflow-hidden rounded-sm"><img ... /></div>
</div>
```

On dark sections use a lighter palette tone for the plate (e.g. the muted/sage tone at ~0.26).
Gallery grids stay unframed — plating every cell of a grid is busy, not designed. No drop-shadow
soup: the plate IS the depth.

**Contrast gate for this pass:** any overlay, tint or glow under text changes the effective
background. The treatments draw from `--accent` (decorative — the one place the raw brand value
belongs), but at low alpha over a surface they shift that surface's luminance, so § Verify's
`contrast-check.mjs` run is what proves the treated result; it composites alpha layers from the
rendered page. For the glow specifically also confirm against rendered pixels (screenshot
sampling) at the glow peak — ancestor-walk background resolution has produced false failures on
these sites before. Nothing below 4.5:1 ships.

### Skill wiring for this pass (all gated non-interactive)

Consult these skills where they genuinely help; the recipe above is the deterministic floor that
ships even when a skill adds nothing. This pipeline is headless: NEVER use any skill's interactive
steps (theme pickers, showcase PDFs, AskUserQuestion), and never let one emit runtime JS, metered
API calls, or raster assets into the site.

- `algorithmic-art` — character for the texture: vary the noise recipe per client (baseFrequency,
  octaves, tile size, seeded by the slug) so grain isn't one global fingerprint. Output MUST be a
  static SVG data URI in CSS; its p5.js/.html/.js deliverables are banned from the site.
- `theme-factory` — judgement for deriving surface-treatment strength (grain opacity, glow hue and
  alpha, plate tone) from the client palette. Its 10 preset themes and choose-a-theme flow are
  banned: palette authority stays with `/ui-ux-pro-max` + the client's own brand colour.
- `design-system` / `ui-styling` — token discipline: every treatment colour references the `:root`
  palette variables; no orphan hexes in treatment CSS.
- `canvas-design` — composition judgement for photo framing and section balance; expressed as the
  CSS plate/caption treatment, never as a generated raster.
- `web-asset-generator` — favicon and og:image sizing from a real gathered logo only. Note honestly:
  it does NOT draw service icons (it resizes logos and renders text images) — service icons are
  hand-drawn per rule 3. Skip its interactive question step; take sizes/HTML-tag guidance only.
- `taste-skill` — the judgement pass: after the build, hold the rendered desktop + mobile
  screenshots against it. If any treatment reads as uniform decoration rather than something a
  designer chose for THIS business, dial that treatment down before QA. Its motion defaults do not
  apply (the Motion component owns animation).

## Design quality (IMPORTANT - avoid template look)
The site must look bespoke and hand-crafted, not like an AI-generated template:
- **Photos woven throughout** - don't isolate in one gallery. Use as section backgrounds, alongside About text, in review cards
- **Generous spacing** - sections need breathing room, not crammed together
- **Visual variety** - alternate layouts (full-width photo, then cards, then split text+image). Don't stack identical card grids
- **Aim for 700+ lines across the four route files plus the shared chrome** (`src/app/**/page.tsx` + `_components/`) — shorter sites look thin and generic. The home page carries the most of it; a subpage under ~90 lines is almost certainly the "thin stub" § Site structure forbids. Measure it: `find src/app -name 'page.tsx' | xargs wc -l`

## Motion, chat and hero video (every site ships all three)

The scaffold provides these; you wire them up. They are three of the things the
${PRICING_MONTHLY} recurring fee is sold on, so a site missing them is a site that
cannot be sold at the advertised price.

> 🚨 **Scrolled-state nav background must be on the full-width `<header>`, never the inner
> `max-w-7xl` content div — caught live 2026-08-16 ("navbar on scroll isnt edge to edge").** A
> fixed nav is commonly built as `<header className="fixed inset-x-0 ..."><nav className="mx-auto
> max-w-7xl ...">`, and it's tempting to put the scrolled `bg-surface-dark` conditional on the
> INNER `<nav>` since that's where the visible content lives — but that div is width-constrained
> and centred, so the solid background only fills the centre column, leaving visible gaps at both
> edges on any viewport wider than the content max-width. Put the conditional background class on
> the OUTER `<header>` (genuinely full-width, `left-0 right-0`); the inner `<nav>` stays a plain
> layout container with no background of its own.

### 1. `<Motion />` — Lenis smooth scroll + GSAP ScrollTrigger

Mount it once, first thing inside `<body>` in `layout.tsx`:

```tsx
import Motion from "./_components/Motion";
// ...
<body>
  <Motion seed="Impact Landscapes LLC" />
  {children}
</body>
```

**Always pass `seed`** — the business name or the client slug. It derives this
client's motion character (travel distance, duration, stagger, parallax depth,
scroll inertia) from narrow, restrained ranges using `gsap.utils`. Omit it and every
site in the fleet animates with byte-identical numbers, which is the motion
equivalent of every site shipping in Inter. Same seed always gives the same motion,
so builds stay reproducible.

Then mark elements. These four attributes are the entire API:

| Attribute | Put it on | Effect |
|---|---|---|
| `data-reveal` | every section **below the hero** | fades and rises in as it scrolls into view |
| `data-count="1994"` | a real figure: years trading, jobs done, review count | counts up once when scrolled into view |
| `data-parallax` | any mid-page image or photo block | drifts gently as it passes — depth below the fold |

> ⛔ **COVERAGE IS COUNTED, AND SO IS STAGGER — measured 2026-08-16.** The operator's first
> reaction to build 3 live was *"i dont see much motion"*, and the first diagnosis (mine) was wrong
> and worth recording: I counted 5 `data-reveal` elements against 6 `<section>` tags and called it
> under-marking. It was not. Section 1 was the HERO, which is correctly excluded, so sections 2-6
> were all revealed — **5 of 5 eligible, full coverage.**
>
> The real gap was `data-reveal-group`: **zero** on the entire site. Every section faded in as one
> solid block, so a 6-card service grid moved like a single slab and the page read as flat despite
> being fully compliant. **Stagger is what reads as craft; whole-section fades read as a slideshow.**
>
> So check BOTH numbers, and never report the first without the second:
>
> ```bash
> # Sections below the hero vs. elements actually marked. Run per page, in the SOURCE.
> SECS=$(grep -c '<section' clients/$ARGUMENTS/site/src/app/page.tsx)
> MARK=$(grep -cE 'data-reveal(-group)?' clients/$ARGUMENTS/site/src/app/page.tsx)
> echo "$MARK marked / $SECS sections"
> ```
>

> **The stagger rule: every multi-item grid gets `data-reveal-group` on its WRAPPER** — service
> cards, photo grids, review cards, FAQ lists, stat rows. Put it on the wrapper, never on the
> children (the provider staggers direct children itself; marking both double-animates them).
>
> ```bash
> # Both numbers. A site with full data-reveal coverage and ZERO groups is the flat case.
> echo "reveals: $(grep -c 'data-reveal[ =]' <page>)  groups: $(grep -c 'data-reveal-group' <page>)"
> ```
>
> A page with two or more multi-item grids and no `data-reveal-group` has not finished its motion
> pass, whatever its section coverage says.
>
> **Target: every `<section>` below the hero is either marked `data-reveal` itself or sits inside a
> `data-reveal-group`.** One unmarked section is a miss, not a rounding error — an unrevealed
> section between two revealed ones reads as a bug, because the eye notices the one thing that
> did not move.
>
> Apply the same standard on EVERY route, not just `page.tsx`. Subpages are where coverage silently
> collapses, and they are exactly the pages a business owner clicks into when deciding whether the
> site is real.
>
> **What NOT to do to hit the number:** do not mark a whole page body as one reveal, do not mark
> nested children individually inside a group (that is what `data-reveal-group` is for), and do not
> add sections purely to have something to animate. Coverage is a floor on craft, not a target to
> game.
| `data-reveal-group` | a card/photo grid wrapper | staggers its direct children instead of itself |
| `data-hero-reveal` | the hero's TEXT/CTA content wrapper | settles into place on load (transform/scale ONLY, never opacity) — the LCP-safe entrance the hero is otherwise excluded from |
| `data-hero` | the hero `<section>` | the parallax measures against it |
| `data-nav` | the fixed `<header>` | gains `data-scrolled="true"` past 80px, so you can style a solid state |

**Never put `data-reveal` on the hero section.** An element at `opacity: 0` is
excluded from being an LCP candidate, so revealing the hero silently pushes LCP to
some much later text block. The hero is visible from the first paint, always.

> 🚨 **That rule got over-applied into "the hero gets no motion at all," and a real operator
> caught it (2026-08-16): "no hero motion" on an otherwise-improved build. The hero's own
> background media already proves an LCP-safe pattern works — `data-hero-media`'s parallax
> scales/translates without ever touching opacity — so the fix is `data-hero-reveal` on the
> hero's text/CTA wrapper: same never-touch-opacity discipline, applied to the copy instead of
> just the media. It fires on mount, not on scroll (the hero is already in view), tweening only
> `y`/`scale`, so the element is `opacity: 1` from first paint through the whole animation and
> never loses LCP eligibility. Put it on the wrapper div immediately inside the hero's content
> column (the one holding the eyebrow, `<h1>`, dek and CTA row) — its direct children stagger the
> same way `data-reveal-group`'s do. Confirmed present in `Motion.tsx`; every hero must use it —
> a static hero next to a page that moves everywhere else reads as unfinished, not restrained.**

`Motion.tsx` carries the failure handling and you should not weaken it: the hidden
state is applied from JS only after the libraries load, the reveals are **rebuilt on
every `usePathname()` change**, a watchdog that **never stops sweeping** reveals
anything that passes its trigger line and stays invisible, and
`prefers-reduced-motion` disables the whole thing. **Do not "optimise" GSAP with a
deferred or async script tag** — it is an ordinary bundled import on purpose. A
defer/async change to GSAP is what froze WooCommerce Cart blocks on a previous Gray
Reserve build.

> ⚠️ **The route-aware rebuild and the endless watchdog are load-bearing. Measured
> on two live sites, 2026-08-15.** These are App Router sites: tapping a nav
> `<Link>` is a CLIENT navigation, and the layout — including `<Motion />` — never
> unmounts. A mount-only effect therefore built ScrollTriggers for the first route
> only, while the `html[data-motion="ready"] [data-reveal]{opacity:0}` rule kept
> applying to every route after it. Result: **every subpage reached from the menu
> rendered as a hero, a tall white void, and a footer, permanently** — a direct URL
> load of the same route was perfect, the route returned 200, and the copy was all
> there in the DOM. The old watchdog gave up after ten sweeps (15 seconds), so a
> visitor who read the homepage before tapping a menu item had no safety net at all.
> If you ever touch `Motion.tsx`, the two regression tests are:
> **(a)** load `/`, wait 20 seconds, tap a menu link, scroll — every section appears;
> **(b)** `document.querySelectorAll("[data-reveal]")` filtered to
> `getComputedStyle(el).opacity < 0.05` must be empty for everything above the
> scroll position, on 375x812, in WebKit, after a soft navigation.

### 2. `<SiteChat />` — the assistant, plus `public/chat-kb.json`

Two pieces. Mount the widget once in `layout.tsx`, after `{children}`:

```tsx
import SiteChat from "./_components/SiteChat";
// ...
<SiteChat
  businessName="Impact Landscapes LLC"
  phoneDisplay="(972) 849-6443"
  subtitle="Ask us about your yard"
  greeting="Hi. Ask me anything about Impact Landscapes and I'll help if I can."
/>
```

Set `--chat-accent: var(--accent-fill)` and `--chat-on-accent: var(--on-accent-fill)`
in `globals.css` (the derived pair from § Colour roles), so the bubble matches the
palette AND is compliant by construction — the raw accent with white text is the
measured 2.9:1 failure.

**Then give the widget room. Three markup hooks, all of them mandatory on mobile.**
The launcher is `position: fixed` in the bottom-right corner, which is the same
corner a sticky call bar and a footer copyright line live in. On two live sites it
sat straight on top of the "Call" button and clipped the copyright, and the open
panel needed scrolling and pinching to use.

| Hook | Put it on | Why |
|---|---|---|
| `data-sticky-bottom` | any site-wide bar pinned to the bottom of the viewport (sticky call bar, booking bar) | `SiteChat` measures it and lifts the launcher above it. Measured, not guessed, so it tracks a bar whose height changes with the type scale or the safe-area inset. |
| `data-chat-gutter` | the footer's last row (the copyright / legal line) | reserves the bubble's corner so that text never runs underneath it |
| `footer { padding-bottom }` in `globals.css`, under `@media (max-width: 767px)` | — | a fixed bottom bar overlays the document; without this the footer's last line can never be scrolled clear of it. Use `calc(4.5rem + env(safe-area-inset-bottom, 0px))`. Put it on the **footer**, not on `<body>` — body padding paints the page background below the footer and reads as a stray light strip under a dark one. |

A sticky bottom bar's own visibility logic must **show** the bar when there is no
`[data-hero]` on the route. `if (!hero) return;` leaves it hidden on every subpage,
which is where a call button is most useful.

`SiteChat` handles the rest itself and you should not weaken it: below 640px the
open panel stays a bounded FLOATING CARD (rounded corners, border, shadow, margin
from the screen edges — the same shape as desktop, just narrower), not a full-screen
sheet (changed 2026-08-18, Jeff comparing against EuroLuxe Detailing's mobile chat
framing, which he called out as the bar to match). The real iPhone bug that
originally motivated going full-screen — a `bottom`-anchored card at a fixed rem
height gets measured against iOS Safari's LARGE (chrome-hidden) viewport, so its top
and send button can end up behind the browser chrome once it reappears — is fixed
properly instead of worked around: the card's height is capped with `100svh` (SMALL
viewport height, the guaranteed-visible area with chrome fully shown), never `100dvh`
or a bare rem value, so it can never be taller than the worst-case visible area no
matter which viewport state it was measured against. The launcher hides while the
panel is open so nothing overlaps. The text input is **16px** for a separate iOS
reason: it auto-zooms any focused input under 16px — that zoom is what a visitor
experiences as "I had to zoom in". If you ever touch this again, verify the panel at
375x812 with the browser chrome genuinely visible (not just a fixed-size emulated
viewport, which can't reproduce the chrome-collapse bug) before deciding it's fixed.

Then **write `clients/$ARGUMENTS/site/public/chat-kb.json`**. This is the knowledge
base. The site is a static export and has no server, so a single shared service
answers for every site: it reads this file from the site's own origin and builds the
system prompt from it. No KB, no chatbot.

```json
{
  "name": "…", "town": "…", "trade": "…",
  "phoneDisplay": "…", "email": "…", "address": "…",
  "areaServed": "…", "hours": "…",
  "services": ["…"],
  "facts": ["…"],
  "reviews": [{ "author": "…", "stars": 5, "text": "verbatim" }],
  "doNotClaim": ["…"],
  "greeting": "…"
}
```

Rules for the KB, and they are the same rules as the rest of the site:

- **Every field comes from `gathered-content.md`.** The assistant can only say what
  is in here, so an invented fact here becomes an invented fact said out loud to a
  customer.
- **`doNotClaim` is not optional.** List every trap this specific business has: no
  published prices, no weekend hours, no email address, no reviews, no founding
  year. This is what stops the assistant being helpful in the wrong direction.
- **Reviews go in verbatim** with the real author and star rating, or not at all.
- Omit a field entirely rather than writing "unknown" or "N/A" into it.

### 3. `<HeroVideo />` — motion in the hero, from the photos already gathered

**MANDATORY ATTEMPT — already done, in § Setup, before you reach this point.** Moved there
2026-08-18 so the render (and its recorded OK/FAIL result) is locked in before any TSX exists,
rather than being a late, easy-to-drop step. Do NOT run `node services/hero-video/render.mjs`
again here — check `status.md` for the `HERO_VIDEO=` line Setup already wrote and use its result:

```tsx
// HERO_VIDEO=OK in status.md — public/hero.mp4 and public/hero-poster.jpg exist
<HeroVideo poster="/hero-poster.jpg" src="/hero.mp4" alt="…" />
// HERO_VIDEO=FAIL in status.md — legitimate degradation, poster-only,
// identical layout, no video request
<HeroVideo poster="/images/hero-photo.webp" alt="…" />
```

Put it where the hero `<img>` would have gone, inside the `data-hero` section and
underneath the section's existing dark wash. Do **not** wrap it in your own
`data-hero-media` element — it sets that attribute internally and deliberately keeps
its pause control outside the parallax-transformed subtree.

Do not add a scrim to the clip; the hero section's own uniform wash already darkens
it, and doubling up turns the photography to mud.

## Logo & favicon
A bespoke site shouldn't wear a generic icon, and if the business has a real logo it should appear in the **nav/header, footer, favicon, and og:image** -- not just the browser tab. The scaffold's placeholder `favicon.ico` is identical on every build and is a visible "AI template" tell (it's the tab icon and the link-preview thumbnail in WhatsApp/iMessage/SMS).

**If gathered-content.md has a `## Brand` block with a `Logo:` line** (captured + graded by the gather "Social harvest" step):
- The build setup copies `data/images/logo.png` into `site/public/images/` like any photo. Use it in the **nav/header** (`<img src="/images/logo.png" className="h-16 w-auto max-w-[280px] object-contain">`) and **footer** (`<img src="/images/logo.png" className="mb-4 h-14 w-auto max-w-[260px] object-contain">`) and for **og:image**; use it as the **favicon** (`app/icon.png`) only when its `shape` is roundel/square (a horizontal-wordmark/stacked logo letterboxes into an unreadable square -- keep the monogram `app/icon.svg` favicon for those, while still using the logo in the nav).
- **Size the container to the `shape` field, nav height minimum `h-16` (64px), footer minimum `h-14` (56px)**: roundel/square -> fixed square box (`h-16 w-16`); horizontal-wordmark/stacked -> `h-16 w-auto` with a `max-w` sensible for the wordmark's aspect ratio (e.g. `max-w-[280px]`). Always `object-contain`, never stretch. **This floor has been raised TWICE off the same live complaint ("tiny"): `h-8` (32px) -> `h-11` (44px) on 2026-08-16 -> `h-16` (64px), same day, same client, after `h-11` was screenshotted live and still called tiny.** Do not undershoot a third time — when in doubt against a full-bleed hero, go bigger, not smaller. `h-16`/`h-14` is the new floor, go larger still if the nav itself is taller or the logo is a wide horizontal wordmark that reads small at this height.
- **Respect the `background` field for contrast**: a transparent or light logo sits fine on a dark nav; a dark-on-transparent logo on a dark nav needs a small light chip behind it (and vice-versa). A text wordmark beside a roundel is fine but optional.

**Otherwise (no `Logo:` line, or `grade: rejected`)**: make a simple **monogram** -- the business's initial on a colour from the design-system palette, as a static `app/icon.svg` that App Router wires up automatically. This is the guaranteed fallback; a clean monogram always beats a wonky real logo.

Either way, replace the scaffold's default `favicon.ico` (overwrite it, or add `app/icon.png` / `app/icon.svg` and delete the stale `.ico`).

## Book Now button (if applicable)
If the business is on a booking platform (Booksy, Fresha, Treatwell, Vagaro), add a prominent "Book Online" button linking to their booking page. Check gathered-content.md for booking URLs. **Exception:** booking-mode leads (`extra.mode` = `booking`) get the built-in booking facade below as the PRIMARY booking UI. `golden_check` leads ALSO get a visibly secondary "or book on {Platform}" link to their claimed platform page — it keeps real bookings working from the preview (the facade delivers none) and shows coexistence. The facade stays the hero; the platform link is never the CTA. `no_website` AND `dead_platform` leads get the facade only — never link a platform that doesn't exist or has shut down.

## Booking facade (booking-mode leads only; full spec: `reference/booking-facade.md`)

**Only relevant when this client's `extra.mode` is `booking` (status.md or Supabase) — if it isn't, skip this entire section, do not read the reference file.** When it is: read `reference/booking-facade.md` in full before building the flow. It specifies the 5-step client-side facade (service/staff/date-time/details/confirmation), and the hard rules that are each their own QA fail: zero network requests, no "demo"/"preview" labels anywhere, `noindex` while the facade is live, never ships to a live client domain unmodified, credential ceiling by silence for regulated-adjacent verticals, home-based businesses get area-only treatment, and per-platform review counts never get conflated with Google's.
## Contact form (always include)
Every site MUST have a contact section.

**Default pattern (2026-08-18) — POST to the shared previews-app endpoint, never `mailto:`.**
`mailto:` (either an `<a href="mailto:">` or a form building a `mailto:?subject=...` URL) fails
silently for any visitor without a configured native mail client — common on mobile browsers,
Chromebooks, and work devices locked to webmail. The click either does nothing or opens an
app-picker the visitor didn't expect, and the lead is lost with no error shown to anyone. Every
Klaudius tenant is served through `gr-no-website-builds`'s shared previews app
(`{slug}.grayreserve.agency`), which already runs a production-grade, same-origin contact endpoint
at `apps/previews/src/pages/api/preview/[slug]/contact.ts` — CSRF/honeypot/rate-limiting, Slack
alert, an operator queue, AND an orphan-lead queue for tenants with no email on file yet. It already
resolves a Klaudius tenant's email from `site.json`'s `business.email` (`loadKlaudiusManifest`,
added 2026-08-18) — no per-client wiring, no API key, no third-party service to stand up.

Build `_components/ContactForm.tsx` as a client component (`"use client"`) whose submit handler:
1. Reads the tenant slug from `window.location.hostname.split(".")[0]` — matches the deployed
   subdomain, never hardcode it.
2. POSTs JSON to `` `/api/preview/${slug}/contact` `` with `Content-Type: application/json` and
   `Accept: application/json`.
3. Sends `name` (required) + either `phone` (7+ digits, Schema A) or `email` + `message` (Schema B)
   — see the endpoint's own docstring for the exact two accepted schemas; extra/unknown field names
   400. Map any locally-named field (e.g. a "Subject" input) onto the endpoint's real names
   (`service`, not `subject`) before sending.
4. Includes a hidden honeypot field named `_gr_hp_kx` (visually + tab-order hidden, must stay empty)
   — required by the endpoint, a filled value silently drops the submission.
5. Shows a `sending` → `sent`/`error` state from the real JSON response (`{ok:true}` /
   `{ok:false, error}`), not an optimistic instant success. A `warning` field on a 200 response
   means the tenant has no email on file yet (orphan queue) — still show success to the visitor
   (the lead reached Slack + the operator queue, it isn't lost), no different UI needed.

This is a same-origin fetch (the Klaudius tenant IS served by the previews app), so no CORS
configuration is needed. The old two-branch spec (real `mailto:` if email known, fake
`preventDefault()`+success if not) is retired — the endpoint's own orphan-queue path already covers
the no-email case correctly, with the lead actually preserved instead of silently discarded.

## Photo selection (hero image matters most)
Not all photos work in all positions. Choose the hero/lead image carefully:
- **Good hero images**: finished results (completed bathroom, styled hair, plated food, shopfront exterior), team/owner portraits, interior ambiance shots
- **Bad hero images**: close-up treatment-in-progress (waxing, threading, drilling), before-only shots, blurry photos, photos of equipment/tools
- **Never use**: Street View of residential houses for home-based businesses. Only use Street View if it shows a real shopfront with signage.

## Image containers
**Match each container's aspect ratio to the photo's native orientation.** Most gathered Google photos are portrait 3:4 (`places-photos.js` prints `WxH orientation` per photo — check it; a trailing `(source WxH)` is what Google holds, NOT what is on disk, so never size against it). Portrait photos → portrait boxes (`aspect-[3/4]` / `aspect-[4/5]`), landscape → wide boxes (`aspect-[4/3]` / `aspect-[16/10]`), `<img className="h-full w-full object-cover object-center">` inside. **Prefer `aspect-[X/Y]` wrappers over fixed `h-[...]` heights** — a fixed height on a wide container slices a portrait into a thin band (the "why is this so cropped" failure; `h-[420px]` is the trap). If you must set a fixed height, size it to the orientation and keep `object-center`; never let a mobile image collapse below ~420px visible height. When most photos are portrait, prefer an editorial layout (tall feature image beside a text list, a portrait "work" trio, photos woven through sections) over a uniform image-top card grid.

**Lazy-load below-fold images.** A static export has no `next/image` or `srcset`, so nothing defers unless you say so. Every `<img>` below the fold: `loading="lazy" decoding="async"`. Above-fold images stay eager — nav logo untouched, hero `<img>` gets `fetchPriority="high"`.

**Photo galleries: use a CSS `grid`, never CSS `columns`.** CSS multi-column balances by *count*, not height, voiding the short column when the photo count doesn't divide evenly (a June 2026 scan found it on ~20% of live sites). Build galleries as `grid grid-cols-2 lg:grid-cols-3` (or `-4`) with uniform-aspect cells (`aspect-square` / `aspect-[4/3]` / `aspect-[4/5]`, majority orientation so fewest crop) and `<img className="h-full w-full object-cover object-center">`; pick a column count the photo count fills so the last row is full or a deliberate partial, never a void (e.g. 8 photos to 4x2 or 2x4). Masonry *look*: grid + portrait `row-span-2` + `grid-auto-flow: dense`, still never `columns`. CSS-column masonry stays fine for *text* cards like testimonials. QA hard-fails a voided gallery.

## Photos (CRITICAL - check gathered-content.md)
Before writing any code, read gathered-content.md and count the photo URLs under ## Photos. Every listed photo URL or downloaded file MUST appear somewhere on the site unless it's clearly bad quality. If gathered-content.md has 6 photos and your site only uses 1, something is wrong.
- Old-site photos (rescue leads): use ONLY those gather classified as genuine/reusable — a stock-classified or unclassified old-site image never ships (licence risk)
- Instagram photos: reference as `/images/filename.jpg` (downloaded during gather step)
- Google Maps (`lh3.googleusercontent.com`): hotlink directly, append `=w2048`. Never `=w0-h0` — that serves the 3-4MB original, usually straight into the hero.
- Restaurant Guru (`img02.restaurantguru.com`): hotlink directly. Do NOT use `img.restaurantguru.com/reviews/` URLs.
- Booksy / other CDNs: hotlink directly

## Rescue parity (only when `clients/$ARGUMENTS/data/parity-checklist.md` exists)
- Every checklist atom gets placed on the site, or a `WAIVED: <atom> — <reason>` row appended to the checklist (leave the original row in place) — never silently dropped. Regulated/legal `TEXT:` atoms go in verbatim, never reworded.
- `ASSET:` rows: copy `data/docs/` files into `site/public/` preserving each one's original URL path, and link them. Copy BEFORE `npx next build` — files added to `public/` afterwards never reach the static export.
- If the old site has real structure beyond the four standard routes (distinct per-service pages, a history page, a proof/case-study page), mirror that structure with extra route segments rather than compressing it into the four — judgment call, but the default flips for rich sites. Never mirror *downward*: the four routes in § Site structure are a floor, not a target, and a thin old site does not license a one-pager.
- If an `UNCAPTURED:` row's title suggests high-value content (stories, prizes, history), fetch that one page on demand before building.

## AEO baseline (every build — the site must be machine-readable before it is pitched)

**AEO/GEO is not `/seo`'s job alone.** `/seo` runs on CONVERSION. Before this section existed, every
speculative site shipped with **zero JSON-LD, no `robots.txt`, no `sitemap.xml` and no `llms.txt`** —
the demo we email a business owner had no machine-readable identity at all, and the recurring fee is
sold partly on AI-search work. The baseline below ships on every build; `/seo` then *deepens* it at
go-live (canonical domain, Places-verified `geo`, IndexNow, search-console handover).

It costs nothing at runtime: everything here is static-export compatible and adds no server code.

**Generate all of it from ONE object.** Put the facts in `src/app/_components/site-data.ts` and build
the graph, the rendered NAP and `llms.txt` from that object — never type a phone number or an address
twice. A number that is right on the page and wrong in the schema is the most common local-entity
defect there is, and the only reliable cure is making the two physically incapable of diverging.

Four files, then the FAQ section:

1. **`src/app/_components/schema.ts`** — the entity graph, split:
   - **Shared nodes in `layout.tsx`**: the business (most specific schema.org subtype; `additionalType`
     with a Wikidata URI when no subtype fits the trade — landscaping, for instance, has none), its
     `Service` nodes, and `WebSite`. Identical `@id`s on every route is what makes this ONE entity.
   - **Per-page nodes in each `page.tsx`**: `WebPage` (with the route's path in its `@id` — four pages
     claiming `<BASE>/#webpage` is a self-inflicted duplicate), `BreadcrumbList` on every route but `/`,
     and `FAQPage` on the one page that renders the FAQ.
   - **Blog nodes**: one `Blog` node defined on `/blog` only, and a `BlogPosting` on each article
     (`author` and `publisher` both the business `@id`, never an invented human byline). Full rules
     in § Blog.
   - **Entity clarity is the point.** `sameAs` (their real Facebook / Instagram / Google listing / their
     own existing site) is how a machine decides this site and that profile are the same business.
     `areaServed` as `City` objects, one per town they genuinely cover, is what answers "who does X in
     <town>". Both are load-bearing; omitting them leaves the business unresolvable.
   - **Omit, never guess.** No `aggregateRating`/`review` without a verified live rating. No `geo`
     without resolved coordinates. An empty string asserts a fact of `""` — worse than absence.
> ⛔ **EVERY ROUTE DECLARES ITS OWN CANONICAL.** In each subpage's `metadata`, set
> `alternates: { canonical: "/services" }` (the route's own path). Next resolves it to an absolute
> URL via `metadataBase`, which is what Google wants: absolute and self-referencing.
>
> Without it, every route inherits the ROOT canonical and `/services`, `/about` and `/contact` each
> declare themselves a duplicate of the homepage. Measured 2026-08-15 on `impact-landscapes-frisco`:
> all four routes emitted the same canonical. It is inert while a spec build is `noindex`, and it
> becomes real the moment `/seo` runs at conversion — telling Google to drop three of the four pages
> we just built. Multi-page is now the default, so this applies to essentially every build.
>
> **Verify:** `grep -o 'rel="canonical" href="[^"]*"' out/services.html out/about.html out/contact.html out/blog.html out/privacy.html out/terms.html out/blog/*.html`
> — each must name its OWN route, not `/`. Articles are the easiest ones to forget, because their
> metadata is built in `generateMetadata()` rather than a static `metadata` export.

> ⛔ **`SITE_URL` MUST BE THE HOST THE SITE ACTUALLY SERVES ON. Never guess a `*.vercel.app`.**
> On a spec build that is **`https://<slug>.grayreserve.agency`** — the shared-lane subdomain from
> `§ Shared instance` in the deploy skill. `/seo` rewrites it (and nothing else in `site-data.ts`)
> when a real domain lands at conversion.
>
> This is not cosmetic. `SITE_URL` feeds `metadataBase`, so it becomes **every canonical URL, every
> Open Graph URL, and every `@id` in the JSON-LD entity graph**. Measured 2026-08-15 on
> `impact-landscapes-frisco`: it had been written as `https://impact-landscapes-frisco.vercel.app`,
> a host the site has never served on — because prospects go on the SHARED instance and get no
> Vercel project of their own. The whole AEO layer was therefore asserting a business identity for
> a phantom site, and `robots.ts` advertised a sitemap there too. Everything validated, everything
> pointed nowhere.
>
> **Verify it, do not assume it:** after building, `grep -o 'https://[a-z0-9.-]*' out/index.html |
> sort -u` and confirm every self-referential host matches the serving host. A `*.vercel.app` in
> that list on a spec build is the bug.

> ⛔ **SPEC BUILDS SHIP `noindex`. Jeff, 2026-08-15: "index needs to be off on subdomain builds until
> they say yes and pay."** Set `robots: { index: false, follow: false }` in `layout.tsx` metadata on
> every build that has not converted. `/seo` deletes it at go-live — that is already Step 2 of that
> skill, and `/seo` only runs on conversion, so the lifecycle is: spec = noindex, paid = indexed.
>
> This is not caution, it is the correct call, and GR-185 already made it (every GR-185 demo page is
> `noindex,nofollow`). We publish a full `LocalBusiness` entity — name, address, phone, service area,
> `sameAs` links to their real profiles — for a business that never asked us to. Indexing that means:
> a second competing entity for a real business we have no relationship with; a `{slug}.grayreserve.agency`
> URL that can outrank or muddy their own listing; and their NAP asserted by a stranger, which is the
> one thing local SEO punishes hardest. The AEO work is not wasted meanwhile — the structure is built,
> validated and ready, and flipping one metadata line at conversion turns it all on at once.
>
> **The entity graph, `sameAs`, `areaServed`, FAQ and `llms.txt` all still ship on spec builds.** Only
> indexing is off. A prospect (or you) can still open the page and see a real, complete site, and
> `aeo-check.mjs` still validates the structure — it treats a deliberate spec-build `noindex` as
> expected rather than a defect, so the gate does not go permanently red.

2. **`src/app/robots.ts`** — allow everything, and split the named list in two, because the difference
   decides visibility:
   - **LIVE-RETRIEVAL** (`Googlebot`, `Bingbot`, `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`,
     `Perplexity-User`, `Claude-User`, `Claude-SearchBot`, `Applebot`) — these fetch the page to answer
     a question *now*. OpenAI's own docs: sites opted out of `OAI-SearchBot` "will not be shown in
     ChatGPT search answers". Blocking any of these removes the business from that engine's answers.
   - **TRAINING** (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `meta-externalagent`,
     `CCBot`) — these govern model training. Allowed deliberately: a local business gains from being in
     the weights and loses nothing.
   - **The folklore correction:** blocking `Google-Extended` does **not** remove a site from AI Overviews
     or AI Mode. Those are served off the ordinary Google index via Googlebot. Never ship `nosnippet` on
     a business that wants to be quoted.
3. **`src/app/sitemap.ts`** — one entry per real route, enumerated from the build. AI crawlers waste
   about a third of their fetches on 404s (Vercel/MERJ traffic study: ChatGPT 34.8%, Claude 34.2%, against
   Googlebot's 8.2%), so a sitemap listing a route that does not exist is not harmless — it burns the
   crawl budget the business has. **Blog routes count**: `/blog` plus one line per article, each
   article stamped with its own `published` date, all generated from `POSTS` rather than typed.
   **`/privacy` and `/terms` count too** — they ship on every build (§ Legal pages), and `aeo-check`
   fails on any built route the sitemap omits.
4. **`src/app/llms.txt/route.ts`** (`export const dynamic = "force-static"`) — the llmstxt.org shape:
   `# Business Name`, a `> ` blockquote summary, then `##` sections — key facts, services, a `## Blog`
   section listing every article as a markdown link with its description, key pages as
   markdown links (**`/privacy` and `/terms` included** — every built route belongs in that list, and
   `aeo-check` warns on any route it omits), and a "Notes for assistants" block naming what must NOT be invented (prices, hours,
   ratings the business does not have). **Say what this is worth honestly:** no major answer engine has
   committed to reading `llms.txt`, and Google's John Mueller has said flatly that no AI system currently
   uses it. It ships because it is generated free from facts we already hold and costs nothing — not
   because it moves anything. Never sell it as a ranking lever.

5. **A visible FAQ section**, 4–6 questions phrased the way a customer would actually type them
   ("Which towns does <Business> serve?", "Is <Business> licensed?", "What does a <job> cost?"), each
   answered in 1–3 concrete sentences that **name the business** rather than saying "we" — a model
   resolves "Acme Roofing repairs flat roofs across Telford" far better than "We do all kinds of roofs".
   The questions come from `gathered-content.md`; if the business publishes no prices, the honest answer
   is that they quote after a visit, not an invented range.

   **Rendered and marked up must be the same words.** Map the same array into both the visible `<h3>`/`<p>`
   and the `FAQPage` node. Markup an engine cannot corroborate against the rendered page is worth less
   than none, and `aeo-check` hard-fails on it.

   > FAQ *rich results* are gone — Google restricted them in 2023 and **fully deprecated** them in May 2026.
   > That is not why this exists. `FAQPage` still ships because it is valid, liftable, answer-shaped text
   > that Bingbot, PerplexityBot, ClaudeBot and GPTBot all parse out of raw HTML. Expect no SERP dropdown.

**Extractability rules, which apply to the whole site and not only the FAQ:**

- **Every load-bearing fact must survive with all JavaScript removed.** No major AI crawler executes JS —
  only Gemini (which rides Googlebot's infrastructure) and Applebot do. Name, phone, address, hours,
  service list, service area and the JSON-LD must be in the server-returned HTML, not injected on the client.
  ⚠️ `grep -q "$PHONE" out/index.html` **passes on a site where the phone exists only inside Next's RSC
  flight payload** — a `<script>` tag a crawler never runs. Strip `<script>` before asserting anything.
- **NAP as crawlable text on every route**, not schema-only. Engines cross-check rendered text against
  the business's listings.
- Real headings, one `<h1>` per page. A heading that is an image is a picture of words.
- Lists and tables for structured facts (towns covered, services, hours). No critical fact locked in an image.
- Concrete numbers over adjectives — years trading, licence numbers, towns, response times. The one
  controlled study in this field (Aggarwal et al., *GEO*, KDD 2024) found adding statistics, quotations
  from credible sources and citations raised visibility on its own metric by roughly 20–40%, while keyword
  stuffing did nothing. Treat that as directional: it is a 2023-era black-box measurement on a synthetic
  visibility score, and 40% was its ceiling, not its average.

## Verify
```bash
npx next build
```

**Then assert the routes you decided on actually exist.** `npx next build` succeeds perfectly happily on a one-pager, so a missing subpage is a *silent* failure — the exact class of defect this pipeline keeps shipping. Check the emitted artefact, not the source:

```bash
# static export: every marketing route must have produced its own HTML file.
# privacy and terms ship on EVERY build (§ Legal pages) - a MISSING on either is
# never an acceptable drop, unlike a sufficiency-gated /services or /about.
for r in index services about contact blog privacy terms; do
  test -f "out/$r.html" -o -f "out/$r/index.html" && echo "OK   /$r" || echo "MISSING /$r"
done

# and that the footer actually links to them from every page - a legal page nobody
# can reach is the same defect as no legal page.
for f in out/index.html out/services.html out/about.html out/contact.html; do
  test -f "$f" || continue
  grep -q 'href="/privacy"' "$f" && grep -q 'href="/terms"' "$f" \
    && echo "OK   footer legal links on $f" || echo "MISSING footer legal links on $f"
done

# and every article the blog claims to have. A dynamic segment missing
# generateStaticParams() emits ZERO article HTML and still exits 0.
grep -o 'slug: "[^"]*"' src/app/_components/blog-data.ts | cut -d'"' -f2 | while read s; do
  test -f "out/blog/$s.html" && echo "OK   /blog/$s" || echo "MISSING /blog/$s"
done
test "$(ls out/blog/*.html 2>/dev/null | wc -l | tr -d ' ')" = "5" \
  && echo "OK   5 articles exported" || echo "WRONG article count in out/blog/"
```

Every route § Site structure said should ship must print `OK`. A `MISSING` line for a route you deliberately dropped is fine **only if the drop and its counts are written in `status.md`** — otherwise the site is a one-pager by accident and you go back and write the page before QA. Do not proceed on a green `next build` alone.

**Then assert the hero video was actually attempted, not silently skipped** (§ Motion, chat and hero video → `<HeroVideo />`). This is a build-quality regression gate, not a route-existence check — a build with real usable photos and no hero video attempt is exactly the defect that shipped once already:

```bash
grep -qE '^HERO_VIDEO=(OK|FAIL)' clients/$ARGUMENTS/data/status.md \
  && echo "OK   hero video step recorded" \
  || echo "MISSING hero video step never attempted or never recorded in status.md"

test -f "clients/$ARGUMENTS/site/public/hero.mp4" -a -f "clients/$ARGUMENTS/site/public/hero-poster.jpg" \
  && echo "OK   hero.mp4 + hero-poster.jpg present" \
  || echo "NOTE  no hero clip on disk — acceptable ONLY if status.md records HERO_VIDEO=FAIL (fewer than 3 usable photos)"
```

A `MISSING` on the first check means `node services/hero-video/render.mjs --slug $ARGUMENTS` was never even run — go back and run it before QA. A `NOTE` on the second is fine exactly when the first check's status.md line reads `HERO_VIDEO=FAIL`; if it reads `HERO_VIDEO=OK` but the files aren't on disk, something silently dropped the output and needs investigating, not shrugging off.

> **`out/services.html` is the right artefact to check, not `out/services/`.** A static export also emits a `services/` directory holding only RSC payload `.txt` files. `python3 -m http.server` sees that directory and 301-redirects `/services` to `/services/`, which has no `index.html` — a purely local artefact of a server with no clean-URL handling. `npx serve out` and Vercel's filesystem handler both serve `/services` from `services.html` and return 200. Verify the extensionless paths on the LIVE deploy (the deploy skill does this), never conclude a 404 from `python3 -m http.server` alone.

**Then assert the fonts actually reached the page** — the same class of silent failure, and the one that discards the whole typography step (see § Font → "How to LOAD the fonts"). Run from the repo root:

```bash
node scripts/font-check.mjs clients/$ARGUMENTS/site
```

It must print `FONT_CHECK=PASS`. A `FAIL` means the site is rendering in Georgia/Helvetica no matter how correct `globals.css` looks — fix the loading mechanism, rebuild, re-run. Do not hand a `FONT_CHECK=FAIL` build to QA.

**Then assert every rendered text element clears WCAG** — the computed backstop behind § Colour
roles. Because the palette is derived, this should be proving a property that is already true; a
FAIL means a freehand colour bypassed the role tokens (or an overlay/glow shifted a surface) and
the build does not ship until it passes. From the repo root:

Run both together, backgrounded and reaped with `wait` (Fable consult, 2026-08-19 — the rendered
check is documented elsewhere as the single most expensive script in the whole battery; the two are
fully independent, so there's no reason to pay for them serially):
```bash
node scripts/contrast-check.mjs --tokens clients/$ARGUMENTS/site/src/app/globals.css > /tmp/contrast-tokens-$$.log 2>&1 &
node scripts/contrast-check.mjs clients/$ARGUMENTS/site/out > /tmp/contrast-rendered-$$.log 2>&1 &
wait
cat /tmp/contrast-tokens-$$.log /tmp/contrast-rendered-$$.log
rm -f /tmp/contrast-tokens-$$.log /tmp/contrast-rendered-$$.log
```

The first line is the STATIC token audit (`TOKEN_CHECK=PASS` required): it verifies the full
derived token set is present in `:root` and every declared pair still passes — this is the only
gate that can see tokens which render on interaction (error text, toasts, validation banners),
because a resting page never paints them. The second serves the export itself, walks EVERY page at desktop and mobile widths, composites
translucent layers from the rendered page, and applies the real per-element threshold (3.0:1 for
large text, 4.5:1 otherwise). It must print `CONTRAST_CHECK=PASS`. Never eyeball a disputed
ratio: white-on-gold at 2.9:1 looks like a handsome button, which is exactly how three builds
shipped it. Do not hand a `CONTRAST_CHECK=FAIL` build to QA.

Keep going — FONT_CHECK/TOKEN_CHECK/CONTRAST_CHECK passing is necessary but not sufficient; the
marker that tells QA it can skip re-running gets written once ALL eight Verify checks (these three
plus the five shift-left checks below) have passed, not after just these three (see after the
5-check batch below — writing it here would have been wrong, since a FAIL further down still needs
a real fix-and-rebuild before anything can be trusted stale-free).

**Then assert the motion and chat pieces reached the artefact**, for the same reason
— all three fail silently and all three are things the recurring fee is sold on:

```bash
cd clients/$ARGUMENTS/site
test -s public/chat-kb.json && python3 -m json.tool public/chat-kb.json >/dev/null \
  && echo "OK   chat-kb.json valid" || echo "MISSING chat-kb.json (the chatbot cannot work without it)"
test -f out/chat-kb.json && echo "OK   chat-kb.json exported" || echo "MISSING chat-kb.json in out/"
grep -qr 'data-reveal' src/app && echo "OK   reveal hooks present" || echo "MISSING data-reveal hooks"
grep -q '<Motion' src/app/layout.tsx && echo "OK   Motion mounted" || echo "MISSING <Motion /> in layout"
grep -q '<SiteChat' src/app/layout.tsx && echo "OK   SiteChat mounted" || echo "MISSING <SiteChat /> in layout"
grep -q 'opacity:0\|opacity: 0' src/app/globals.css && echo "WARNING: a hidden state in globals.css can blank the page if JS fails — it belongs in Motion.tsx, nowhere else"
grep -q 'usePathname' src/app/_components/Motion.tsx \
  && echo "OK   Motion rebuilds reveals per route" \
  || echo "BROKEN: Motion is mount-only — every subpage reached by tapping the menu will render as a hero, a void and a footer"
grep -q 'data-\[scrolled=false\]' src/app/_components/SiteNav.tsx \
  && echo "BROKEN: nav background is styled only off data-scrolled — it has NO background when the attribute is absent" \
  || echo "OK   nav owns its own solid state"
grep -q 'data-chat-gutter' src/app/_components/SiteFooter.tsx \
  && echo "OK   footer reserves the chat launcher corner" \
  || echo "MISSING data-chat-gutter on the footer's last row (the chat bubble will sit on the copyright line)"
```

A `MISSING` on the KB is the one that matters most: the chat bubble will still
render and the visitor will still be able to type, and every message will come back
as the phone-number fallback. That is precisely how Gray Reserve's own chatbot sat
dead on production for weeks while answering HTTP 200.

**Then assert the AEO baseline reached the artefact** — same silent-failure class again, and this one is
what the "ongoing SEO, AEO and GEO work" line in the outreach copy has to stand on. From the repo root:

```bash
node scripts/aeo-check.mjs clients/$ARGUMENTS/site
```

It must print `AEO_CHECK=PASS`. It validates the entity graph (parses, one business `@id` across every
route, per-page `WebPage` `@id`s, no dangling `@id` edges, no empty properties), proves every FAQ question
is a **rendered heading** and every answer is in the **visible page text**, proves NAP is present on every
route and matches the schema, checks `llms.txt` against the llmstxt.org shape with its links resolving to
real routes, checks the sitemap covers exactly the built routes, and confirms no live-retrieval crawler is
blocked. **Every text assertion is made with `<script>` stripped**, so a fact that lives only in the RSC
payload fails here instead of passing a naive grep.

What it does NOT prove, and must never be reported as proving: that any answer engine will cite the site.
There is no artefact-level test for a citation.

**First, mechanically auto-fix the two defect classes that never need a model turn (Fable consult,
2026-08-19).** Missing `<img>` width/height and banned em/en-dashes are the two most common single
findings across real QA reports, and both are purely mechanical — the fix is "read the real pixel
size" and "substitute punctuation", never a design or copy judgement call. Fixing them with a script
before richness-check even runs means richness-check has nothing to flag and QA never spends a round
on either:
```bash
node scripts/fix-img-dims.mjs $ARGUMENTS
node scripts/fix-dashes.mjs $ARGUMENTS
```
`fix-img-dims.mjs` only fixes `<img>` tags with a literal `/images/...` string src — it reports
(never guesses at) anything with a dynamic/interpolated src, which needs your own judgement.
`fix-dashes.mjs` only substitutes punctuation (comma for a spaced em-dash, hyphen otherwise/for a
digit range) — it never rewrites a sentence, so if the resulting prose reads awkwardly, that's worth
a manual pass, but the mechanical defect itself is already closed. Both skip JSX/JS comments.

**Then run richness verification HERE, not only at QA (Fable consult, 2026-08-19 — shift-left).**
This used to run for the first time in QA, meaning a FAIL there cost a whole round: rebuild,
re-screenshot, re-gate, re-review — measured at 45-70+ minutes on a real dispatch, against
~seconds to run the same script here before handoff. A real client build's round-1 critical was
exactly this class: richness shipped 2 gradients against a 5-gradient design-manifest plan,
invisible to every other Verify check, would have been a 2-minute self-fix here instead of a lost
round.

**HyperUI is deleted from this pipeline as of 2026-08-19 (Jeff's explicit call) — the reference
catalog, both gate scripts, and the lookup tool are gone, not just unwired.** It was made mandatory
2026-08-16 to fix a specific earlier problem (a build that had a reference set available and never
opened a single file), but the fix overshot: the-woodlands-plumbing-and-air (2026-08-16, before
HyperUI adoption existed) is the actual quality bar this pipeline is chasing, and the mandatory
cycle added since — search a 469-file catalog, pick 6+ components across 4+ categories, wire and
cite each one, clear two hard-FAIL gates — added real, measured time without moving the site closer
to that bar. cold-front-ac (2026-08-19) shipped 16 gate-PASSING citations and still read as
generic; a review confirmed the actual generic pattern on that build was hand-written, not
HyperUI-sourced at all. Every section is now authored directly against the design system, richness
rules, and composition guidance in this file — no external component library involved.

Independent of the nav-visibility check further below — run both together in one backgrounded batch
rather than two separate tool-call turns (same pattern as the QA gate battery; the concurrent-write
paths they share, `data/design-fingerprints.json`, are already mkdir-lock-protected):
```bash
node scripts/richness-check.mjs clients/$ARGUMENTS/site > /tmp/vf-richness-$$.log 2>&1 &
node scripts/verify-reviews.mjs $ARGUMENTS > /tmp/vf-reviews-$$.log 2>&1 &
node scripts/verify-nav-visibility.mjs clients/$ARGUMENTS/site/out > /tmp/vf-nav-$$.log 2>&1 &
wait
cat /tmp/vf-richness-$$.log /tmp/vf-reviews-$$.log /tmp/vf-nav-$$.log
rm -f /tmp/vf-richness-$$.log /tmp/vf-reviews-$$.log /tmp/vf-nav-$$.log
```

**`verify-reviews.mjs` closes the worst defect class this pipeline can ship** — a fabricated review
published under a real business's name — which until now had NO deterministic check anywhere in
the pipeline, only the three-bucket-truth-rule's prose. It scans every review/testimonial-shaped
object literal in the built `.tsx` source and confirms the quote text appears verbatim in
`gathered-content.md`. `REVIEW_CHECK=FAIL` is CRITICAL: hand-verify each flagged quote against
`gathered-content.md` (a real quote with trivial punctuation cleanup is a false positive; an author
name that appears nowhere in the gathered content is fabrication) and replace any genuinely
invented review with a real one from `gathered-content.md`'s Reviews section before proceeding.

**Then verify nav-link contrast at scroll=0 with a PIXEL-SAMPLED check, not the ancestor-walk
`contrast-check.mjs` above uses (Fable consult, 2026-08-19).** A real client build shipped a
`position: fixed` transparent nav with light-on-dark link styling — invisible against a light
subpage until the visitor scrolls. `contrast-check.mjs` ran clean (0 failures) against the exact
reproduced bug: its ancestor-walk reads what a `position:fixed` element's DOM PARENT paints, not
what visually sits behind it once the element escapes normal flow — a fixed element's real backdrop
is whatever page content happens to be scrolled underneath it, which has no DOM relationship to it
at all. `verify-nav-visibility.mjs` instead screenshots the real rendered page and samples the
actual pixel colour behind each nav link, the same methodology this project's own contrast tooling
already trusts over DOM inference for exactly this class of ambiguity. (Already run as part of the
5-check parallel batch above — `vf-nav-$$.log` — nothing further to invoke here.)

`NAV_VISIBILITY_CHECK=FAIL` is CRITICAL: a nav link is unreadable against its real rendered
backdrop at first load. Fix by either giving the nav a real background at all times (simplest,
most robust) or darkening/lightening the underlying content enough that the transparent state
stays legible everywhere it can appear — never by trusting `contrast-check.mjs`'s PASS on the same
element, which cannot see this failure mode. `SKIP` is normal if the site has no `[data-nav]`
element with links (not this template) — not a finding.

⚠️ **Separately, while building this check, a serious pre-existing bug in `contrast-check.mjs`
itself was found and fixed: its local static server 404s on every CSS/JS/font request under a
shared-lane build** (the document serves at root but `next.config.mjs`'s mandatory `assetPrefix`
points assets at `/klaudius/<slug>/...`), so the page it evaluated had **zero real styling** —
unstyled default-browser HTML reads as good contrast by default, so this was producing a
false-clean `CONTRAST_CHECK=PASS` on every shared-lane build, not a nav-specific gap. Confirmed on
a real build: after the fix, the SAME already-deployed-looking build went from `0 failures / 584
elements` to `48 failures / 524 elements` — real, previously invisible defects (near-white text on
near-white backgrounds across most sections). The fix (strip the `/klaudius/<slug>/` prefix before
resolving to `out/`) is already applied in `contrast-check.mjs` — nothing to change in how you
invoke it above, but treat any PRE-2026-08-19 `CONTRAST_CHECK=PASS` recorded in an existing
client's `status.md`/`qa-report.md` as unverified, not evidence of clean contrast.

All THREE checks in this section — richness, reviews (`REVIEW_CHECK`), and nav visibility
(`NAV_VISIBILITY_CHECK`) — must print PASS (or the appropriate SKIP — see each script's own
QA-section documentation above for what SKIP means and when it's normal, not a finding). A FAIL on
any of them here means: go fix the actual gap (add the missing gradients/textures, replace an
invented review with a real one, give the nav a legible resting state) and re-run — same discipline
as `FONT_CHECK=FAIL` above. Do not hand a build with a FAIL on any of these three to QA; that is
exactly the cost this section exists to avoid paying twice.

**If FONT_CHECK, TOKEN_CHECK, CONTRAST_CHECK, and all three checks above genuinely printed PASS (or
a normal SKIP) — all six, not just the first three — record it now** so QA doesn't re-run any of
them against the identical artefact (Fable consult, 2026-08-19 — extends the original 3-check
dedupe to cover the shift-left checks added the same night; HyperUI usage/transplant removed from
this dedupe 2026-08-19, they no longer run at all):
```bash
echo "VERIFY_GATES_OK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> clients/$ARGUMENTS/data/status.md
```
Only write this line if every one of the eight genuinely passed (or SKIPped legitimately). Skip it
if anything FAILed and you're about to fix-and-rebuild — a stale/wrong marker is worse than no
marker, since QA's freshness check trusts it without re-verifying the claim itself.

Rescue leads with a parity checklist: after the build, self-check with `node scripts/parity-check.js $ARGUMENTS` (from the repo root) — it must exit clean; QA runs the same check and hard-fails on misses.

## Update status (MANDATORY - do this last)
After a successful build, update the client status in Supabase:
```bash
python3 -c "from scripts.db import update_status; update_status('$ARGUMENTS', 'built')"
```
Do NOT rely on the calling session to remember this — it must happen here before build is complete.
