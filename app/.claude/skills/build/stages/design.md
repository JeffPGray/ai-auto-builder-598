# Stage: design
Opus / high only. Lock DESIGN_IDEA, globals.css, site-data.ts, SiteNav, layout, SiteFooter.
Do not author route page.tsx in this stage.

## Design (HARD RULES — measured, never described)

**This section is deliberately short, and that is a design decision with evidence behind it.** On
2026-08-19 a real build was measured end to end: it **compacted 9 times, first at minute 12, then
every ~14 minutes**. Every page written after minute 12 was authored from a *summary* of the design
brief rather than the brief itself, and the result read generic despite passing every gate. The old
design guidance was ~1,000 lines of prose describing how a good page should *feel*. Prose that
describes a feeling is (a) large enough to force the compaction that destroys it, and (b)
satisfiable by a token gesture — "use a signature motif" is satisfied by one faint divider line.

**So every rule here states a NUMBER or names a SCRIPT. If a rule cannot be measured, it does not
belong in this file.** The full history lives in git (`git log -- .claude/skills/build/SKILL.md`)
and in `DESIGN-RESET-DECISION.md`.

### Step 1 — Consult (script, mandatory, before any TSX)

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<industry> <style keywords from gathered content>" --design-system -p "$ARGUMENTS" \
  | tee "clients/$ARGUMENTS/data/design-system.md"
```
Returns the trade's real art direction from `data/trade-identities.csv` (design ideas, hero
archetype, signature motif, material direction, card-grid alternative). **Use it.** The output is
the artifact — a consult that was never written down cannot be distinguished from one that never ran.

### Step 1b — COMPOSITION BRAIN: invoke `impeccable` (MANDATORY, 2026-08-19)

`/ui-ux-pro-max` is a lookup table. It returns a style name, a palette family, a font pairing and a
section order — it has **no capacity to judge whether any of that suits this business**, and it
proved that by matching "Exaggerated Minimalism (Best For: fashion, architecture, luxury, editorial)"
to an HVAC contractor on the word "bold". Sections, elements and styling are exactly what it cannot
reason about, and that is what keeps reading as slop.

**So invoke a real design brain for composition, before writing any TSX:**

```
Skill(skill="impeccable", args="shape — a marketing site for {BUSINESS}, a {TRADE} in {TOWN}. Register: brand. Ground: {GROUND}. Brand accent {HEX}. DESIGN_IDEA: {DESIGN_IDEA}. Sections planned: {SECTION LIST}. Give me the compositional spec: layout pattern per section, where hierarchy breaks, what is featured vs secondary, and what to avoid.")
```

Hold its output as binding for **layout and composition**. It carries the bans this pipeline keeps
violating, by name:
- **"Identical card grids — same-sized cards with icon + heading + text, repeated endlessly"** — the
  exact defect that shipped 16 uniform service rows.
- Side-stripe borders, gradient text, glassmorphism-as-default, the hero-metric template,
  modal-as-first-thought.
- A real **colour strategy** axis (Restrained → Committed → Full palette → Drenched) — pick one and
  commit; a timid middle is what produced grey-on-black.
- The **category-reflex check**: if someone could guess the palette from the category alone
  ("trade → navy", "HVAC → blue", "contractor → dark"), that is the training-data reflex, and you
  must rework it until the answer is not obvious from the trade. Run it at both altitudes.

**Precedence:** `impeccable` owns layout, composition, hierarchy and colour STRATEGY.
`derive-palette.mjs` still owns the actual hex values (only it proves 4.5:1 and CVD separation).
`/ui-ux-pro-max` is demoted to a retrieval library — typography rows, trade seeds, section order.
Where `impeccable` and `ui-ux-pro-max` disagree on composition, **`impeccable` wins.**

> Why this was missing: `build/SKILL.md`'s frontmatter forbade the `Skill` tool entirely until
> 2026-08-19, so no build could ever invoke `impeccable`, `taste-skill`, `anti-ai-slop` or anything
> else. The pipeline was architecturally locked to the lookup table.

### Step 1c — shadcn/ui primitives (pre-vendored, use them for MECHANICS only)

`templates/trade-site` now ships shadcn/ui already wired — `components.json`, `src/lib/utils.ts`
(`cn`), and four vendored primitives in `src/app/_components/ui/`: **accordion, dialog, sheet,
dropdown-menu**. They arrive with `cp -r templates/trade-site`, so there is **no network fetch and
no install step** during a build.

**Use them for the interactive mechanics that are error-prone to hand-write:**
- `sheet` → mobile nav drawer (focus trap, escape-to-close, scroll lock — all handled)
- `dropdown-menu` → the Services nav dropdown (keyboard nav + ARIA wiring).
  ⛔ **The trigger MUST remain a real `<a href="/services">`, not a bare `<button>`.** Wiring this
  dropdown on 2026-08-19 shipped a nav whose measured hrefs were `["/","/about","/contact","/blog"]`
  — `/services` was unreachable from primary nav for keyboard and mobile users, and QA caught it as
  a critical. Render the anchor, and attach the dropdown as a secondary affordance on it.
- `accordion` → FAQ (replaces hand-rolled `<details>`; gives animated height + correct roles)
- `dialog` → anything modal, though `impeccable` bans modal-as-first-thought — exhaust inline/progressive alternatives first

They are built on Radix, so they are `'use client'` — fine under `output: 'export'`. To add another
primitive: `npx shadcn@latest add <name>` from the client's `site/` directory.

> ⛔ **NEVER ship shadcn's default styling. This is the single rule that matters here.**
> Default shadcn (new-york + slate) is the most recognisable look on the web — it is what v0,
> Lovable and every AI app-builder emits, and shipping it unmodified reads as "an AI made this"
> instantly, which is the exact failure this pipeline exists to avoid. The operator's own
> `taste-skill` states it: *"You may use shadcn/ui, but NEVER in its generic default state."*
>
> So on every primitive you use: **replace the default classes with this client's derived tokens**
> (`bg-surface-*`, `text-on-dark`, `border-accent-*`, the real radius and shadow scale from the
> design system). `components.json` sets `cssVariables: false` deliberately so nothing silently
> inherits a slate palette. shadcn supplies BEHAVIOUR; `impeccable` and `derive-palette` supply
> every visual decision. If a rendered component still looks like stock shadcn, it is wrong.

> ⛔ **Never write a `srcSet` referencing a variant file that does not exist.** `optimise-images.mjs`
> names the LARGEST qualifying ladder rung with the plain name (`gmaps1.webp`), so when a source is
> small enough that only one rung qualifies, **no `-640` file is ever emitted**. A build wrote
> `srcSet="/images/gmaps1-640.webp 640w, /images/gmaps1.webp 679w"` for a 679px source and the
> mobile truck photo rendered as a broken box. **`ls public/images/` and reference only files that
> are actually there**, or drop the srcSet and use a single `src` with a `sizes` attribute.

**Scope limit:** primitives only. Do not reach for shadcn card/button/badge to compose sections —
that is exactly how a site becomes a recognisable template. Section composition is `impeccable`'s
job (§ Step 1b), and the trade seed's Card-Grid Alternative still governs layout.

### Step 1d — The design idea binds on EVERY route, not just the home page

QA on 2026-08-19 found the DESIGN_IDEA ("Weather Authority") and its signature thermocline
gradient present on `/` and **entirely absent from `/about` and `/contact` — those pages shipped
zero gradients.** A concept that stops at the home page is not a design system, it is a home-page
treatment, and subpages then read as the generic filler the operator keeps calling slop.

**Before you write each route, state in one line how THIS page expresses the DESIGN_IDEA** — which
signature move appears, on which section. Every marketing route (`/`, `/services`, `/about`,
`/contact`, and every `/services/<slug>`) carries **at least one** of the three signature moves and
at least one gradient or photo-ground. **⚠️ NOT YET MECHANICALLY ENFORCED — this is on you.** `richness-check.mjs` currently scopes its
rhythm/motion/photo-ground checks to `index.html` and counts gradients site-wide over concatenated
CSS, so a design idea present on `/` and absent from `/about` and `/contact` passes every gate.
That is the exact defect this step exists to prevent, so verify it by eye per route until the
per-page check lands.

### Step 2 — Typography (script + seed, never the `--design-system` font field)

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "INDUSTRY KEYWORDS" --domain typography -n 5
```
Pick from the 5 **by business-name seed**, not by top match — the picker is deterministic, so
top-match gives every business in a trade the same fonts. Serif/sans contrast required.

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
// NOTE: these two families are a MECHANISM example only — they are deliberately NOT a
// recommendation, and you must substitute the pairing the consult returned. Bodoni Moda used to
// sit here and on 2026-08-19 a build that had been forced off its correct font reached for the
// example instead and shipped a high-fashion didone on a Texas HVAC contractor. Rules lose to
// examples, so this example is now a neutral workhorse pairing.
import { Source_Serif_4, Inter_Tight } from "next/font/google";

const display = Source_Serif_4({ subsets: ["latin"], display: "swap",
  weight: ["400", "600", "700"], variable: "--font-display-src" });
const body = Inter_Tight({ subsets: ["latin"], display: "swap",
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
1. **START from the `--design-system` font recommendation — it is usually right and overriding it is what broke a real build.** Measured 2026-08-19: the consult returned Literata / Schibsted Grotesk for an HVAC contractor (the exact pairing on the operator's preferred build); this instruction told the builder to discard it, the global no-reuse rule then rejected the fallback, and the build shipped Bodoni Moda — a Vogue didone — on an HVAC company. Take the consult's pairing unless it is BANNED below or collides with a SAME-TOWN build. Only if one of those applies, widen with: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "INDUSTRY KEYWORDS" --domain typography -n 5` and pick by seed from that shortlist.
2. Pick a pairing with serif/slab heading + sans body
3. Check both fonts against the banned lists below
4. **Uniqueness rule**: pass `--heading-font "<Family Name>" --body-font "<Family Name>" --town "<city>"` into the § Step 4 — Uniqueness `design-ledger.mjs check`/`record` calls below (once ground/formula/harmony/character are also decided) — don't invent a second, separate invocation. The ledger checks font-name reuse deterministically across full build history: `FONT_LEDGER=REUSE` fires only on a **SAME-TOWN** heading-font collision and is a hard stop there (neighbouring owners can see each other's sites). A cross-town match prints `FONT_LEDGER=INFO` and is **NOT** a failure — keep the font. Scoped 2026-08-19: the rule used to be global, which rejected the consult's correct pairing and pushed a build onto the skill's own code example (a Vogue didone on an HVAC contractor). A same-town body-font match prints `FONT_LEDGER=WARN` (don't reuse the body font for neighbouring-town clients either, but it isn't a hard stop yet). This replaces the old "scan 3-4 recent client `globals.css` files" ad hoc skim — the ledger already has the full history, so there's nothing left for a manual scan to add.

### Banned fonts (never use in any position)
Inter, Geist, Roboto, Arial, system-ui, sans-serif, Barlow, DM Sans, Poppins, Open Sans, Montserrat, Raleway, Nunito, Syne, Plus Jakarta Sans, Familjen Grotesk, Karla, Manrope, Bricolage Grotesque

### Banned heading fonts (overused by AI — no longer look bespoke)
DM Serif Display, Playfair Display, Young Serif, Lora — every ChatGPT/Wix AI site uses these now. They are the new Inter.

### Avoid as body font (too invisible)
Space Grotesk, Figtree, Outfit — only acceptable when paired with a genuinely uncommon serif heading.

### Heading fonts — use the TRADE POOL, not a flat list

⛔ **There is deliberately no general "good fonts" list here any more.** One used to sit at this
spot containing Bodoni Moda undifferentiated by trade, and it is exactly what a build reached into
when the font ledger rejected its correct pairing — shipping a Vogue fashion didone onto a Texas
HVAC contractor (2026-08-19). A flat list cannot know that a didone suits a boutique and insults a
boiler-repair company.

**The consult prints `TYPOGRAPHY POOL (pick from these only)` for this client's trade. Pick from
it.** Each trade's pool is 3 pairings chosen for register — engineered/tabular for HVAC and
electrical, sturdy for plumbing, organic and warmer for landscaping. If every pool entry is blocked
by a SAME-TOWN collision, widen with the typography domain search and stay inside the trade's
register; never reach for a display/fashion serif on a trade site.

### Canvas mode: NEUTRAL-CANVAS (default for trade sites) vs FULL-TINT vs SATURATED-PANEL

**Every rung above is brand-tinted, including the ones the code calls "neutral."** That is
deliberate — but FULL-TINT is NOT the default (corrected 2026-08-19; NEUTRAL-CANVAS is, per the decision rule below). FULL-TINT suits everyday trades with a warm brand hue, where a colour-forward page reads
warm and approachable. But it means the page's *base* — hero, body copy sections, the default
ground a visitor sits on for most of a scroll — always carries the brand hue, never a true white
or true dark. **Caught live 2026-08-16** (Jeff, looking at a blue-brand HVAC build): "the AC is
cool, but I think would look more luxury with a white background and colored sections vs all blue
variants... think Ritz-Carlton." He is describing a second, real mode this system did not yet have
a name for:

| | FULL-TINT (the exception) | NEUTRAL-CANVAS (the trade default) |
|---|---|---|
| `--surface` / `--surface-alt` (page base, most sections) | drawn from the tinted ladder (`--surface-1`/`-2`) | **true neutral** — `#ffffff` / near-white for a light-first brand, true near-black (`#0a0a0a`-ish, not a tinted `--surface-6`) for a dark-first one |
| The 6-rung tinted ladder | used everywhere, is the whole rhythm system | **demoted to an accent device** — used only on a minority of sections (a stat strip, a testimonial band, the footer) as deliberate colour punctuation against the neutral base |
| Reads as | warm, colour-forward, approachable — right for most everyday trades | restrained, premium — restraint IS the signal, same reasoning § Design (HARD RULES) already gives for `none` harmony on jewellers/tailors/galleries/funeral masons |

**Choosing it is a CHARACTER decision, made once, at the same point you pick harmony** — not a
per-section toggle. **NEUTRAL-CANVAS is the default for a trade site** (see the executable decision rule below, which routes every emergency trade and any build with <4 photos to it). FULL-TINT is the deliberate exception for everyday trades with warm brand hues and homey content. Consider NEUTRAL-CANVAS when
the gathered content itself signals premium positioning (high-end brands serviced, decades of
awards, a heritage/family narrative, premium pricing already implied) even inside an "ordinary"
trade like HVAC — a colour-saturated page under-sells a business the content says is upmarket.
**Record the choice in `status.md`** next to the harmony decision, same as CHARACTER.

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

> ⛔ **RESTORED 2026-08-19 after being deleted in the design reset — and the deletion caused a real
> regression.** With this section gone, a build derived a ladder where 5 of 6 rungs were navy
> (#223D81 / #172F6F / #11265F / #081A4B / #020D3B, only surface-5 light) and shipped a mono-tone
> blue site. That is precisely the "all blue variants" the operator rejected on 2026-08-16, and the
> reasoning that rejected it had been deleted along with the mode.
>
> **Pick the canvas mode EXPLICITLY, before deriving the palette, and record it in `status.md`:**
>
> | mode | when | what the base is |
> |---|---|---|
> | **NEUTRAL-CANVAS** | premium positioning, an elevated/restrained look, OR any brand whose hue would otherwise flood the page | true white / near-white base; brand colour appears ONLY in sections, bands and accents |
> | **FULL-TINT** | everyday approachable trades where a colour-forward page suits | tinted ladder throughout |
> | **SATURATED** | a bold, committed brand-as-environment statement (the southernlifts pattern) | brand hue at full chroma as the ground |
>
> **SATURATED and FULL-TINT both flood the page with one hue. That is a deliberate, high-risk
> choice, not a default.** If the goal is "elevated", NEUTRAL-CANVAS is almost always the right
> answer: restraint is the signal, and colour reads as intentional punctuation against a neutral
> base rather than as wallpaper. A mono-tone page is the opposite of elevated — it is the same
> decision made once and applied everywhere.

### Canvas mode decision rule (execute this — do not eyeball it)

Inputs the pipeline already has: the brand accent's OKLCH, the trade class, the photo count from
gather, and premium signals countable in `gathered-content.md` (`award|luxury|custom|bespoke|
design|premium|since <year>|` a named high-end brand serviced).

```
if trade in {HVAC repair, plumbing, electrician, locksmith, drainage}   # emergency trades
   or photos < 4:                                   -> NEUTRAL-CANVAS
       (FULL-TINT only if the brand hue is warm, h 20-110 deg, AND the
        content reads homey/family rather than premium)
elif brand hue solves L <= 0.42 at C >= 0.09 with white text at 4.5:1
     and photos >= 6
     and (trade is aspirational or premium signals >= 2):  -> SATURATED-PANEL
elif premium signals >= 2:                          -> NEUTRAL-CANVAS
else:                                               -> FULL-TINT if warm hue, else NEUTRAL-CANVAS
```

**Invariant on every light mode: the page-base token sits at L >= 0.93, and at least 50% of the
scroll rests on rungs at L >= 0.92.** DEEP and DARK stay available but require recorded,
business-specific evidence (their own branding is dark) — never "authority" or "cold" vibes.

**Record `CANVAS_MODE=<mode>` in `status.md` with its one-line reason.**

> **Why the rule is code-shaped rather than advice:** the same judgement was previously left to
> prose, and a build reasoned its way to a mono-navy page whose five section grounds sat within 0.05
> lightness of each other. The failure was not a lack of taste — it was that nothing counted.

### Step 3 — Palette (script only, never hand-picked)

```bash
node scripts/derive-palette.mjs '<accent hex>' --harmony <type> --character <band> \
  --ground <family> --ground-hue <deg>
```
`--ground` takes **light | cream | deep | dark | saturated**.

**`saturated` means SATURATED-PANEL: a white page body with the brand hue as full-chroma PANELS.**
It is **NOT** a page-wide ground, and it is **NOT** the default — **NEUTRAL-CANVAS is the default
for a trade site.** Reach for `saturated` only when the brand hue solves dark enough to carry
white text (L <= 0.42 at C >= 0.09), gather returned 6+ real photos to stage on the white
sections, AND the trade is aspirational (landscape design, pools, custom renovation) or the
content shows 2+ premium signals. **Never for emergency trades** — HVAC repair, plumbing,
emergency electrical, locksmith, drainage. A homeowner with a broken furnace is scanning for a
phone number, not admiring an environment. It
paints the brand hue at full chroma (C 0.09-0.12) as the ENVIRONMENT rather than as a tint — the
southernlifts.com.au pattern the trade seeds hold up as the bar. It was added 2026-08-19 because no
existing family could reach that reference: `dark` was near-achromatic by construction, which is
literally why a build shipped grey-on-black and the operator said "there's no colour theory".

**Ground choice needs a business-specific reason recorded in `status.md`, never a vibe.** "Dark
amplifies cold authority" is a vibe and it produced the flat build. Run `impeccable`'s
category-reflex check first: if the ground is guessable from the trade alone (HVAC → navy-dark,
contractor → dark), that is the training-data reflex and you must rework it.
The brand accent is theirs and is **never** overridden. Every other colour comes from the deriver,
because only it proves 4.5:1 and CVD separation against this client's real surfaces.

### Step 4 — Uniqueness (script, before writing TSX)

```bash
node scripts/design-ledger.mjs check $ARGUMENTS \
  --ground <family> --ground-hue <deg> --formula <1-5> --harmony <type> --character <band> \
  --heading-font "<Family Name>" --body-font "<Family Name>" --town "<city>"
```
`DESIGN_LEDGER=TWIN` → re-pick (max 2 forced re-picks, then proceed and write `TWIN_ACCEPTED:
<reason>`). **`FONT_LEDGER=REUSE` is a hard stop — but it fires ONLY on a SAME-TOWN collision** (cross-town prints INFO and you keep the font) — the heading font collides
name-for-name with a recent build; pick another. Record with `design-ledger.mjs record` (same flags)
once final.

### The hard rules

Every line is a number. `richness-check.mjs` enforces the ✅ rows and **fails the build**; the ⏳
rows are stated here as binding and are being moved into the script — until then QA grades them.

| # | Rule | Threshold | Enforced |
|---|---|---|---|
| 1 | Scale drama — largest heading vs body | **≥ 3.5×** computed px | ✅ verify-design-intent CHECK B |
| 2 | Grid break — elements differing from siblings by span/offset/translate | **≥ 1** per page | ✅ verify-design-intent CHECK E |
| 3 | Dominant element — the one named in DESIGN_IDEA | **≥ 1.5×** a sibling's rendered area | ⏳ |
| 4 | Signature motif — the one named in DESIGN_IDEA | **≥ 3** appearances in built HTML | ⏳ |
| 5 | Gradients | **≥ 4**, each ≥ 15% perceptual delta between stops | ✅ |
| 6 | Grain opacity | **0.12 – 0.20** | ✅ enforced as the 0.12–0.20 band, upper bound added 2026-08-19 |
| 7 | Distinct section treatments | **≥ 4** | ✅ enforced at <4, the ≥5-section precondition dropped 2026-08-19 |
| 8 | Photo-grounded sections (photo behind 80–88% wash) | **≥ 2** | ✅ |
| 9 | `--secondary` usage | **≥ 10** references | ✅ enforced at <10 (tightened 2026-08-19) |
| 10 | Identical siblings — 4+ same-class cards/panels with no structural variant | **0** allowed | ✅ |
| 11 | Uniform-rhythm run — 4+ visually identical blocks with nothing breaking them | **0** allowed | ✅ verify-design-intent CHECK D |
| 12 | Every `<img>` carries width+height | **100%** | ✅ promoted to a hard failure 2026-08-19 |


> ⚠️ **The ⚠️ rows are DRIFT, found by audit 2026-08-19: the table states the intended threshold and
> the script enforces a weaker one.** Until the scripts are tightened, treat the TABLE's number as the
> rule and do not take a passing gate as proof you met it. A ✅ that does not enforce what it claims is
> the exact failure this pipeline keeps producing — three rows here claimed enforcement they did not
> have, and two rows marked 'not yet scripted' were in fact already enforced.

### Ground: commit, do not hedge

Pick light **or** dark/saturated and commit to it hard. Both produce award-tier trade sites; a
timid version of either reads the same as no choice at all. Record the choice and its reason in
`status.md`. The one banned outcome is the safe middle: a light page with grey cards, or a dark
page with muted grey rows.

### The bar

`southernlifts.com.au` — a real Awwwards-nominated lift/elevator company, the closest live
comparable to this pipeline's own market. **Verified from its shipped CSS 2026-08-19: its page
base is `--background: #fff` — `bg-white` appears 51 times against `bg-egyptian-blue` 7 times.
It is a WHITE body with indigo panels laid over it, and the drama is the ALTERNATION (indigo
slamming into white), not the indigo.** An earlier reading of this same site as a "full-bleed
saturated ground" was wrong, and generalising its hero to the page ground produced a mono-navy
build the operator rejected on sight. What actually carries it: enormous condensed
display type as the primary anchor, numbered full-width service rows (not cards), named case
stories (not a photo grid), trade motif animated into the site chrome. **A build that would read as
visibly more timid than that page next to it has not met the bar** — name what makes it timid and
fix that specific thing.

### Step 4b — Favicon (script, not prose)

```bash
node scripts/generate-favicon.mjs $ARGUMENTS
```
This script exists because the favicon rule was prose and got silently skipped on a real build
(2026-08-17: shipped the scaffold's stale `favicon.ico`, no `app/icon.png`). A rule you have to
remember every time is not a gate; a script that runs every time is.

### Step 5 — Verify (scripts, before handing to QA)

```bash
node scripts/font-check.mjs clients/$ARGUMENTS/site
node scripts/contrast-check.mjs --tokens clients/$ARGUMENTS/site/src/app/globals.css
node scripts/contrast-check.mjs clients/$ARGUMENTS/site/out
node scripts/richness-check.mjs clients/$ARGUMENTS/site
node scripts/verify-design-intent.mjs $ARGUMENTS
node scripts/reconcile-claims.mjs $ARGUMENTS
```
All must PASS before QA. `reconcile-claims.mjs` is the one that checks your own `status.md` claims against the gates that adjudicate them — a build once recorded `HERO_VIDEO=OK` while the playback gate printed FAIL, and shipped. A self-report that contradicts its own gate is a hard fail now, in both directions. `verify-design-intent.mjs` is the one that checks the site against **your
own recorded brief** — scale drama, whether each signature move actually shipped, and uniform-rhythm
runs. `DESIGN_INTENT_CHECK=FAIL` means intent and artifact disagree; fix the artifact. A FAIL here costs seconds; the same FAIL found at QA costs a whole round.

### Context discipline — the measured cause of the compaction spiral

**Measured on the real cold-front-ac build: 56 of its 76 `Read` calls were RE-READS of files the
build had authored itself.** `page.tsx` was re-read 21 times and written 34 times; `site-data.ts` 7
times; `globals.css` and `schema.ts` 5 each. A route's `page.tsx` is 6-10K tokens, so ~21 whole-file
re-reads is on the order of the entire context window, spent re-loading code this build already
wrote.

That is a spiral, not a cost: context fills → compaction → the model no longer holds the code it
authored → it re-reads the whole file to make one edit → context re-inflates → it compacts again.
Nine times in one build, first at minute 12.

**The rules, in priority order:**

1. **Write each route's `page.tsx` ONCE, complete.** A second `Write` to the same route means the
   first pass shipped something you already knew was unfinished. 34 writes across 13 routes is
   iteration that belongs *before* the write, not after it. Use § Incremental per-file check at
   write time so the file is correct on the first pass.
2. **Never re-read a file you authored this session to refresh your memory of it.** If you are
   about to edit it, read only the region you are editing with `offset`/`limit` — never the whole
   file.
3. **To re-orient after a compaction, use the cheap artifacts, not the expensive ones:**
   `node scripts/verify-design-intent.mjs $ARGUMENTS --brief-only` (~8 lines) for design intent,
   and `find clients/$ARGUMENTS/site/src -name '*.tsx'` for what exists. Re-reading generated code
   to remember what you built is the single most expensive way to answer that question.
4. **Batch edits per file.** One read should serve every edit you make to that file, not one edit.

### After a compaction — RUN THIS, do not rely on memory

Measured: a real build compacted **9 times, first at minute 12**, and every page after that was
written from a summary of the design brief rather than the brief. That is the measured cause of
generic output — the build cliff-notes its own notes.

**Immediately after any compaction, run:**
```bash
node scripts/verify-design-intent.mjs $ARGUMENTS --brief-only
```
It prints DESIGN_IDEA, the hero archetype, the ground, and the 3 signature moves back into context
in ~8 lines. A skill instruction survives compaction; your memory of a brief does not. Do not
substitute "I remember the design idea" for running it — that substitution is the defect.

## Design rules
- Use the colour palette from `/ui-ux-pro-max` - never pick colours arbitrarily. **Brand-colour override**: if gathered-content.md's `## Brand` block has a `primary` colour, use it as the site **accent hue** so the site matches the business's real identity — but the accent NEVER goes on the page as one hex doing every job. Run it through § Design (HARD RULES) below, which derives a compliant value per job from the same hue. No banned combos (e.g. purple-on-white). `/ui-ux-pro-max` still drives the overall system.
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
   § Design (HARD RULES) checkpoint BEFORE writing TSX, not by patching it in after — catching it here
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

