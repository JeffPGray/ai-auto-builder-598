# Stage: author
Sonnet for every route page.tsx. Parent Opus does chrome only.

**Images:** every marketing `/images/*` src must appear in `clients/$ARGUMENTS/data/image-plan.json` with `source !== "none"`. Do not invent stock or wire measured/systems veils under dense copy. See `services/higgsfield/IMAGE-RULES.md`.


## Route-batched write-once children (experiment/speed-cut)

After design lock (`globals.css`, `site-data.ts`, chrome), the PARENT does not hold 13 `page.tsx`
files in context. Spawn one child per route (or per 2–3 related routes) with ONLY that file's
instructions.

```
Agent(subagent_type="general-purpose", model="sonnet", prompt="""
You are a write-once route worker. You are NOT the orchestrator. Do not read .claude/ledger.json.

Write ONE file: clients/{slug}/site/src/app/{route}/page.tsx
- Read clients/{slug}/data/design-lock.md (this client only). Execute THAT SIGNATURE MOVE.
- Do not copy layout from another client. Do not fill a shared section kit.
- Read stages/author.md sections for this route type only (offset/limit).
- Write the page COMPLETE on the first Write.
- Then: node scripts/write-once-check.mjs {slug} --note src/app/{route}/page.tsx
- Exit. Do not Edit the file. Do not Write a second time. Do not screenshot.
""")
```

A second Write to the same path is a hard fail (`write-once-check.mjs` exit 1).
Parent Opus authors chrome only. Sonnet authors every `page.tsx`.
This is **Exception 3** of `CLAUDE.md` Critical Rule 10 (experiment/speed-cut). Do not skip it because Exception 2 used to be the only build-stage spawn.

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
phrase repeated on two pages, an em-dash pattern repeated across all three blog articles) was 4 of
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

**HARD RULE — atmosphere (BOTH lanes, Blue Water 2026-08-21):**
1. Read `services/media-surface/ATMOSPHERE.md`. Layers: plane → plate → texture → chrome.
2. Default body = flat `bg-surface-1/2`. Atmosphere is earned, not wallpaper.
3. Budgets/page: hatch ≤1, frost ≤2, copper ≤1, mesh ≤1, loud beats ≤3.
4. Never stack mutex pairs on one section (`hatch`+`grain`, `hatch`+`mesh`, copper+frost).
5. `/services/<slug>`: `ServiceDetailFrame` only — photo-ground + **`band-depth-frost` forever**.
   Ban `hatch*` and `band-go-mesh` on service detail. No flat `grad-*` heroes.
6. Site-wide money closer: one `band-go-mesh` (+ `go-frame`) on home or contact only.
Gate: `scripts/verify-media-surface.mjs`.

**EVERY named service gets its own `/services/<slug>` page. This is not conditional (Jeff, direct
instruction 2026-08-19: "every service getting a page… we always need to generate content. Always.
It's multi-page sites.").** A thin gathered description is not a reason to skip the page — it is a
reason to WRITE the page's content, using § Blog's bucket-2 trade-craft prose (see the truth rule
below and in § Blog). Multi-page is the standard shape of a Klaudius site, and commercial-intent
search ("pool removal Oklahoma City", "AC repair The Woodlands") lands on a service page or lands
nowhere.

> ⚠️ **This SUPERSEDES the previous ≥120-word conditional threshold** (which folded thin-gather
> services into `/services` sections). That rule was correct about one thing and wrong about the
> conclusion: a page whose only content is a restated 20-word gathered bullet IS worthless — but
> the fix is to write real content for it, not to delete the page. The three-bucket truth rule is
> what makes that safe to do: bucket 2 (how this trade's work is actually done — general craft
> knowledge, stated plainly) is NOT invention, and it is exactly what a service page needs.

**The still-binding constraint is TRUTH, not word count.** A per-service page must carry: what the
job actually involves, what the customer should expect (sequence, access, mess, duration), at least
one real photo of that work if one was gathered, and a CTA. It must NEVER invent prices, permit
rules, timelines, regulated numbers, or any claim specific to THIS business that gather did not
find (bucket 1 stays gathered-only, bucket 3 stays forbidden — § Blog). Write real bucket-2 trade
craft to give the page substance; never fabricate a business-specific fact to pad it.

**Not a doorway pattern, and here's the distinction that matters to `/seo`:** a doorway page is the
same content re-skinned per keyword or per town. A genuinely distinct service, with its own real
trade-craft explanation of how that specific job is done, is a legitimate page — that is what every
real trade-service site ships. Duplicating one service's prose across several near-identical service
slugs IS the doorway pattern and stays forbidden.

Blog articles are decided separately and must take a DISTINCT angle from the service page — an
article that restates the service page is wasted; it should go deeper on one aspect (a seasonal
problem, a decision guide, a common failure) that the buying-intent page doesn't cover.

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
| `/blog` + 3 articles | **Always.** This is the one route with no content threshold, because its content is written rather than gathered — see § Blog. The outreach email sells "20 new blog posts a month, written for your business", so a site with no blog contradicts the pitch the owner is reading. | Never omitted. |
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
| `/blog` | `src/app/blog/page.tsx` | Index of the three seed articles: title, date, word count, standfirst, photo, link |
| `/blog/<slug>` | `src/app/blog/[slug]/page.tsx` | One article, rendered from `_components/blog-data.ts` via `generateStaticParams()` |
| `/privacy` | `src/app/privacy/page.tsx` | What this specific site does with a visitor's information — see § Legal pages |
| `/terms` | `src/app/terms/page.tsx` | Who runs the site, what it is and is not, whose words the reviews are — see § Legal pages |

**Shared chrome ships in the template and mounts from `layout.tsx` only.** Do **not** create a fresh SiteNav/SiteFooter, and do **not** import them into individual pages — `cp -r templates/trade-site` already brings bluegrass-floor chrome. Fill `site-data.ts` (`NAV_LINKS` with children, `biz.hoursShort`, `biz.serviceAreaLabel`, `biz.hoursLines`). Pages are `<main>` content only. Re-authoring nav per page is how aquaklear lost the lift.

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
- **Every page is a real page.** No route may be a thin stub or a redirect to a homepage anchor. A route that exists must clear its threshold above; if it cannot, WRITE the missing content — per § Per-service pages every named service gets a page, and deleting the route is explicitly the wrong fix — a 404 is more honest than a 60-word placeholder. Record the drop and the counts in `status.md`. **Working floor: any marketing page under ~120 rendered words is a stub** — QA hard-fails on that number, so treat it as the line, not a guideline.
- **Cross-link between pages** in body copy, not just in the nav — the services page links to contact, the about page links to services. Orphan pages reachable only from the nav read as filler.
- **`/privacy` and `/terms` ship on every build** and both live in the footer or sub-footer, never in the main nav. They are not marketing pages and the ~120-word stub floor is not the test for them; § Legal pages is.
- **Every page still obeys every rule in this skill** — photos woven through, no anchor-nav cliché, contrast, mobile CTA, the anti-slop pass. A polished home page in front of three thin subpages is worse than an honest one-pager.

Route additions from other skills (`/book` from the booking facade, `/admin` from `/cms`) sit alongside the marketing routes and are never counted toward the threshold.

## Legal pages (MANDATORY — `/privacy` and `/terms` on every build; full spec: `reference/legal-pages.md`)

**Jeff, 2026-08-16: "on every single build we need to port over our terms and conditions and privacy policy to be in the footer or sub footer, built for each site."** Both routes ship every time, no exceptions, no threshold.

**Read `reference/legal-pages.md` in full before writing either page** — it has the disclosure inventory (what to grep for and what each finding means for the copy), the chat-widget disclosure template, the per-page content spec, and the wiring checklist (canonical URLs, footer links, sitemap/llms.txt entries). This is not a section to skip or paraphrase from memory: these pages make legal representations on behalf of a business that never reviewed them, and a fabricated clause is a liability we manufactured for them.

**Kept here verbatim as a floor, never skip even under time pressure — the full never-write list, with reasoning, is in the reference file:** company registration number, VAT/EIN/tax number, a named data-protection officer, a statutory-rights recital (GDPR/CCPA), data retention periods, international transfer clauses, "we may share your data with trusted partners", a cookie table for cookies the site doesn't set, children's-privacy clauses, arbitration/venue/jurisdiction beyond the business's own state, indemnities, a money liability cap, prices/deposits/refund terms, guarantees or SLAs, licence/accreditation claims not in `gathered-content.md`, "your continued use constitutes acceptance", and any promise about what the business does with an enquiry after it reaches them. **The rule that covers the whole class: if you cannot point at the fact in `gathered-content.md`, `site-data.ts`, or code you just read, it does not go on the page.**

---
## Blog (MANDATORY — `/blog` plus three articles, on every build)

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

Derive the three topics from the business's own service list in `gathered-content.md`, one per
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

**Publish dates are the build date.** Do not backdate three articles to fake a publishing history.
The owner opens the blog, sees three posts dated across the last six months that they know they
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
three-item-default lists (vary 4/5/6 to fit content), no identical section shapes across the three
articles, no closing recap or "Conclusion" heading, no rhetorical-question closers, end on the
phone number and free consultation, avoid AI-fingerprint openers like "In today's fast-paced
world...". Five formulaic listicles do more damage than no blog: an owner who skims one paragraph
of AI-openers has learned exactly what built the rest of the site. Article copy is the largest
block of prose on the whole site and therefore the largest slop surface on it — which is exactly
why the REAL check (your post-hoc eval pass) must not be the one that gets skipped.

Concretely, the failures that show up in blog copy specifically: three-item lists that were
three because AI defaults to three (make list length follow the content, 4/5/6 items are normal);
identical section shapes across all three articles; an ending that recaps the article the reader
just read; a "Conclusion" heading; questions as closers. End on the concrete next action, which
here is the business's phone number and the free consultation.

### Shape of an article

- **700 to 950 words each.** Long enough to be worth reading and to clear every extractability
  floor with room to spare, short enough that three of them do not double the build. (Gray
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
shipped 3 articles with a broken build **and zero JSON-LD** — 26 AEO failures, caught by QA, that
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
  `@id`. Defining it on each article instead gives you three `Blog` nodes and a duplicate entity.
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

| | Without blog | With `/blog` + 3 articles |
|---|---|---|
| Routes | 4 | 10 |
| `npx next build` | 5.12s | 6.05-6.57s |
| Exported `out/` on disk | 6,208 KB | 7,684 KB |
| An article page over the wire | — | 96-99 KB raw, **14.6 KB gzipped** (`/about` is 12.5 KB) |
| New images / fonts / JS | — | **none** (articles reuse gathered photos) |

`next build` is not the constraint. The constraint is **agent wall-clock**: three articles is
roughly 4,000 words of generated prose, which on the measured 39.6-minute default-effort build
adds an estimated 4 to 7 minutes, more at high effort. Budget for it before promising throughput,
and note that the marginal cost is nearly all writing time, not build time or page weight.

### Write the articles CONCURRENTLY with the pages (added 2026-08-16)

Those 4-7 minutes are serial time spent on prose that touches no design surface. Recover them:
once you have picked the three topics and `gathered-content.md` exists, spawn **one** sub-agent to
draft the article prose while you write `globals.css`, the chrome and the route pages.

This is **Exception 2** (`CLAUDE.md` Critical Rule 10). Blogs must be `model="sonnet"`. Parent does not draft `blog-data.ts`.
Read that rule before using it; it is bounded on purpose.

**`model="sonnet"`, not the parent's opus/high (Jeff, 2026-08-18 — "this is probably fine to do, we
use sonnet for Gray Reserve blogs").** This is the single largest remaining per-build token lever:
~4,000 words of prose at opus/high vs sonnet is real cost, and the safety net that makes a cheaper
drafting model tolerable is unchanged — you fact-check every claim against `gathered-content.md`
and run the real `anti-ai-slop` eval yourself on the returned prose either way (see above and "Then
review before you commit it" below). This is a quality tradeoff on drafting only, not on review.

```
Agent(subagent_type="general-purpose", model="sonnet", prompt="""
Draft 3 blog articles for {Business Name} as a `POSTS: Post[]` array for blog-data.ts.

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

## Anti-slop rules (from frontend-design)
- **Copy passes the `anti-ai-slop` skill before it ships.** Invoke `Skill(skill="anti-ai-slop")` in ENFORCE mode (job A) once before writing any visitor-facing string, and run its `eval.md` checklist over the finished `page.tsx` copy. Every headline, eyebrow, service description, About paragraph, FAQ answer and CTA is in scope; component names, class names and comments are not. It kills the 10 AI fingerprints, ~30 named slop patterns and 80+ banned phrases — the writing-quality equivalent of the `/ui-ux-pro-max` mandate above, and skipping it produces the same "an AI spat this out" tell. The dash ban below is one of its rules, restated here because it is the one that ships most.
- NEVER use em dashes (`—`) or en dashes (`–`) anywhere a reader sees them (body copy, hero, eyebrow labels, service descriptions) — they're a recognisable AI-output fingerprint. Use commas, full stops, colons, or parentheses. Time ranges use a hyphen `-` (e.g. `Mon-Fri 07:30-17:00`). Dashes are acceptable only inside JSX comments or technical strings the user never reads.
- NEVER use purple/violet gradients on white backgrounds - the #1 AI slop tell
- NEVER use predictable, cookie-cutter layouts - break visual monotony with asymmetry and variety
- DO use dominant colours with sharp accents, not timid evenly-distributed palettes
- DO add atmosphere: the § Design (HARD RULES) pass below is the concrete, mandatory form of this rule

(Font bans and the serif/sans-contrast + ui-ux-pro-max mandates live in the Font and Pre-build sections above.)

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

Then mark elements. These attributes are the entire API (the table below lists all of them — the engine has grown past the original four):

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
in `globals.css` (the derived pair from § Design (HARD RULES)), so the bubble matches the
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

**Keep the template `ContactForm.tsx`** (`cp -r templates/trade-site` already ships it). Do not
hand-roll native `<input>` / `<select>` / `<textarea>` or invent a second form.

Wire only:
1. Pass `phoneDisplay` / `phoneHref` / `services[]` from `site-data` (or hardcode from gather).
2. Fields must use the mechanics pack: `ui/label`, `ui/input`, `ui/textarea`, `ui/select`,
   `ui/checkbox`. Submit button stays `.cta-primary` — never shadcn `Button`.
3. Submit handler already POSTs to `` `/api/preview/${slug}/contact` `` with honeypot `_gr_hp_kx`
   and `sending` → `sent`/`error` from real JSON. Do not replace with `mailto:`.
4. If you must edit the form, preserve pack imports — `richness-check` FAILs a ContactForm that
   does not import `ui/input` (or `ui/label`).

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

