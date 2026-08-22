# Lessons — Building Sites (and QA)

Accumulated lessons for the build stage. The QA reviewer reads this file too — these are exactly the failure modes it checks for. Add new build/QA lessons here as they arise.

## Photo galleries (layout)
- **Photo galleries: use a CSS `grid`, never CSS `columns`.** CSS multi-column balances by count, not height, so a photo count that doesn't divide evenly voids the short column (June 2026 scan: 20 of 98 live sites, worst a third-height column, all had passed QA). A `grid` can't (worst case = a benign partial last row). Use `grid grid-cols-2 lg:grid-cols-3` with uniform-aspect cells (majority orientation); masonry look = grid + portrait `row-span-2` + `grid-auto-flow: dense`. Never `columns` for photos (fine for variable-height TEXT cards like testimonials). QA runs a deterministic void measurement (worst empty-column gap as % of gallery height) and hard-fails >=18%, catching it however authored (`columns-N`, `[column-count:N]`, a custom `.masonry` class) — a source grep misses those.

## Photos (framing & layout)
- **Instagram CDN URLs expire within hours.** Never hotlink cdninstagram.com URLs. Photos must be local files under `public/images/` referenced as `/images/filename.jpg`. Google Maps and Restaurant Guru URLs are permanent.
- **Check photo cropping.** Photos displayed with `object-cover` can crop the main subject. If the subject is off-centre or the photo is mostly background, either adjust `object-position` or use a different photo.
- **Most Google/Maps business photos are PORTRAIT 3:4 — frame to orientation, never slice.** `places-photos.js` prints `WxH orientation` per photo as it downloads; check it before laying it out. Those are the on-disk dimensions — a trailing `(source WxH)` is only what Google still holds, so never size a layout against it. Portrait → portrait containers (`aspect-[3/4]`/`aspect-[4/5]`), landscape → wide (`aspect-[4/3]`/`aspect-[16/10]`), `<img className="h-full w-full object-cover object-center">` inside. NEVER force a portrait into a short, wide fixed-height box (`h-72`, `h-[220px]`, a half-width card capped at `h-72`, a `h-[220px]` gallery slot, etc.) — `object-cover` then shows a thin band and slices the subject (the classic "why is this so cropped" failure). The "just give it enough height (`h-[420px]`)" instinct is the trap: a fixed height on a wide container is exactly what crops a portrait. Prefer `aspect-[X/Y]` wrappers over any fixed `h-[...]`. When most photos are portrait, lean into an editorial layout (tall feature image beside a list, a portrait "work" trio, photos woven through) — flatters them, far less templated than a uniform image-top card grid.
- **External images can appear broken during local QA but work fine once deployed.** Local QA's `npx serve` differs from a production CDN (Vercel, Cloudflare, Netlify) in referrer/CORS handling, so Google Maps `lh3.googleusercontent.com` images sometimes render 0x0 on localhost but load fine live. Verify with `curl` before removing — HTTP 200 + reasonable size = it works. Do NOT restructure layouts to remove "broken" images that are fine in production.

## Building Sites
- **Always run `npx next build` in the foreground with `timeout: 120000`.** Never background it. The output file doesn't flush until the process finishes, so backgrounding just leads to 10+ wasted tool calls polling an empty file. Never run two builds concurrently in the same session — the second will corrupt `.next/` and both will fail.

- **Never poll with `pgrep -f` to wait for a process.** Watch loops like `while ps -p $(pgrep -f "next build")` or `until ! pgrep -f "outreach-notify-simple"` self-match: the polling shell's own command line contains the pattern, so pgrep finds itself, the condition stays satisfied, and the watcher hangs forever (children alive 19+ hours, leaking processes and leaving Supabase rows stuck mid-pipeline). To wait for a process you launched, capture its PID (`some-cmd & PID=$!`) and `wait $PID`. Otherwise run synchronously in the foreground.

- **Never use CSS grid for service/feature card layouts.** `grid grid-cols-3` left-aligns the last row when the item count isn't divisible by 3 (e.g. 5 cards leaves 2 awkwardly stuck to the left). Use flexbox instead: `flex flex-wrap justify-center gap-6` with explicit widths `w-full md:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)]`. This centres any incomplete last row automatically and works with any number of cards.

- **Fonts must look bespoke, not AI-generated.** Never use generic fonts (Barlow, DM Sans, Poppins, Open Sans, Montserrat, Raleway — all banned). Don't blindly trust ui-ux-pro-max's recommendation either — its pairings can be "refined but safe" (Fraunces/Outfit, Instrument Serif/Sora) which still read as AI-picked. Ask: "Would a human designer pick this, or is it predictable?" If it feels safe, search for something bolder (condensed slab serifs, heavy display faces, unusual typefaces). More unique = more bespoke.

- **Hide the mobile sticky CTA while the hero is visible.** Most sites have a "Call Now" button in the hero AND a fixed bottom bar with the phone number (`md:hidden`). On first load both are visible simultaneously, which looks redundant. Fix: use an `IntersectionObserver` on the hero section and toggle the sticky bar's opacity/pointer-events — hidden while the hero is on screen, fades in (300ms transition) once the user scrolls past it.

- **Tailwind v3 does NOT compile slash-opacity on arbitrary CSS-var colors.** `text-[var(--paper)]/70`, `bg-[var(--paper)]/5`, `border-[var(--paper)]/15` silently no-op — the element gets no color rule and falls back to the body colour (black on dark = invisible). Named Tailwind colours with slash (`text-white/70`, `bg-black/40`) still work. For CSS-var colours, define explicit utilities in globals.css (`.text-paper-70 { color: rgba(246,238,219,0.7); }`) and use those. Non-opacity `text-[var(--paper)]` survives; `/70` or `/80` on nav, credential strip, footer silently disappears.

- **Don't declare a default `color` on `h1, h2, h3, h4` in globals.css.** Combined with Tailwind's arbitrary-value color classes (specificity-equal but ordering-dependent), you can get headings that render the wrong colour on dark sections (near-black on near-black = invisible). Let headings inherit from their section's Tailwind text-color class, and apply colour with the Tailwind class on the specific heading where needed.

- **Register every palette colour in `tailwind.config.ts`, not just as CSS utility classes in globals.css.** Define `.bg-char { background: var(--char) }` in globals.css without adding `char` to `theme.extend.colors` and `bg-char` works but `from-char`, `to-char`, `via-char-80` gradient utilities silently no-op — photo overlays (`bg-gradient-to-b from-char via-char-80 to-char`) render nothing, exposing the raw photo. Invisible in code review (`from-char` looks valid); shows up only as "text clashes with photo". Mirror palette colours into `tailwind.config.ts` as concrete hex (`char: "#1E1812"`, `ochre: "#C78A3D"`) so gradient stops resolve. globals.css utilities still serve slash-opacity variants (`.bg-char-80`), but registered colours are what Tailwind reads for gradients.

- **Never add a "Scroll" cue, chevron, or blinking dot at the bottom of the hero.** AI-template cliché, and it breaks silently (e.g. the vertical line's `bg-plaster-20` class was never defined in globals.css, leaving the word "SCROLL" floating orphaned). Hint at more content through the content itself — a peek of the next section at the fold, or a bottom gradient fade — not a literal text label.

- **If the navbar is fixed with a top offset (e.g. `top-[34px]`), every element above it MUST also be fixed/sticky.** An info strip (phone, hours, "Est. 1987") above the navbar in normal flow looks fine on load, but on scroll it scrolls away and leaves a gap of that offset between the viewport top and the navbar — background bleeds through, looks broken. Fix: (a) make the strip `fixed top-0 left-0 right-0 z-50` too, or (b) drop the offset and put the navbar at `top-0` with no strip. Never leave a fixed navbar floating below a non-fixed element.

- **`grid grid-cols-12 gap-N` causes mobile horizontal overflow.** `gap-N` applies between EVERY track even when items span all 12 columns, so `gap-10` (40px) adds 11×40 = 440px of column gap — wider than a 393px iPhone viewport. Tracks collapse to 0px but the gaps don't, so a `col-span-12` item renders 440px+ wide and its body text wraps to that width, cut off mid-word at the right edge. `overflow-x: clip` only hides the scroll — the wrap width is still wrong. Fix: split the gap into `gap-y-N md:gap-x-N md:gap-y-N` so column gap is 0 on mobile and only kicks in at md+. Applies to EVERY `grid grid-cols-12` in the page.

- **Don't combine `h-full` with `aspect-[X/Y]` on the same element.** They fight: aspect-ratio sets height from width, h-full forces height = parent. On mobile (unconstrained parent height) images overshoot into the next sibling's caption, looking like an overlap bug. Pick one. Cleanest (flex column, single child): `aspect-[X/Y] overflow-hidden` on the image wrapper and let height follow.

- **Marquee/ticker animations should run in the 18–28 second range.** A 2x-duplicated track translating -50% over 40s+ feels stuck — users read it as a broken/static element. Anything under 12s reads as dizzying. Default to ~22s. The same goes for any infinite-scroll horizontal strip.

- **Always set `html, body { overflow-x: clip; }` in globals.css.** Belt-and-braces against a stray fixed-width element or wide image re-introducing horizontal scroll. `clip` (preferred over `hidden` — it doesn't create a containing block for fixed children) prevents the page ever scrolling horizontally. It does NOT fix wrong-wrap-width (fix the underlying cause), but eliminates the visible double-wide-page failure if something slips through.

- **Heavy/condensed display fonts need `line-height ≥ 1.18`, never `≤ 1.0`.** Boldonse, Anton, Bebas Neue, Bungee, Archivo Black and similar have tall ascenders/deep descenders — at line-height 0.92–1.0 (the typical "tight display" default) descenders intrude into the next line's caps, the "letters overlap" failure on a multi-line headline at mobile width. Invisible in source (`leading-[0.92]` looks fine); only shows on a rendered multi-line headline. Rule: for a heavy/condensed display font set global `.font-display` line-height to **1.20–1.25** and any `leading-[X]` overrides to **≥ 1.18**. Lighter serifs/humanist sans (Spectral, Crimson Pro, Inter Tight) are fine at 0.95–1.05. Always QA a multi-line headline at mobile width — desktop single-line preview won't surface it.

- **Never combine a fixed-height hero (`h-[X]` / `h-Xvh`) with `flex justify-end` and `overflow-hidden`.** The cut-off-headline bug: `h-[78vh] min-h-[620px] max-h-[860px] overflow-hidden` plus inner `h-full flex flex-col justify-end pb-14`. When content (eyebrow + h1 + paragraph + CTAs) exceeds container height minus pb — short-viewport phones — `justify-end` pushes content UP past the top edge where `overflow-hidden` clips it, and the headline loses its first line (cut off at the navbar). Invisible on desktop QA; only triggers when content height > container height. Fix: photo container `min-h-[78vh]` (+ `min-h-[620px]` floor) and `flex flex-col`; inner content div `h-full` → `flex-1`; add `pt-10 sm:pt-14`. Container then expands when needed and `justify-end` still pins to bottom without clipping. Always QA the hero at 393×800, not just default desktop.

- **Photo-backed heroes need a uniform dark (or light) wash across the ENTIRE image, not just directional edge gradients.** `from-char via-transparent to-transparent` only darkens the left edge; warm/mid-toned photos in the middle/right wash out cream/white text. Rule: a solid base overlay at 65–75% opacity over 100% of the image, then optional directional gradients for specific text zones (left-weighted for paragraph/CTA, bottom fade for body copy). Never rely on edge-only gradients — the middle always fights the text (and the photo becomes atmospheric texture, which is the point). Pattern: `<div absolute inset-0 bg-cover />` + `<div absolute inset-0 style={{ background: "rgba(R,G,B,0.72)" }} />` + optional `<div absolute inset-0 style={{ background: "linear-gradient(100deg, rgba(R,G,B,0.5) 0%, rgba(R,G,B,0.15) 55%, rgba(R,G,B,0.5) 100%)" }} />`.

## Playwright-cli Syntax
- **`npx playwright-cli eval` fails on arrow functions, `.map()`, `.forEach()`, spread syntax.** These all throw "not well-serializable" errors. Use old-style `for` loops, string concatenation, and `JSON.stringify()` wrappers instead. Example that WORKS: `npx playwright-cli eval "JSON.stringify(Array.from(document.querySelectorAll('img')).map(function(i) { return i.src }))"`. Example that FAILS: `npx playwright-cli eval "document.querySelectorAll('img').forEach(i => console.log(i.src))"`.

---
*Add new lessons for this stage as they arise*

## Webfonts (verify on the BUILT artefact, never on globals.css)

- **Turbopack silently DROPS any remote `@import` in `globals.css` whose URL contains a literal
  COMMA. The site then ships in fallback fonts and the whole `/ui-ux-pro-max` typography step is
  thrown away.** Measured 2026-08-15 on Next 16.3.1 + Turbopack, Tailwind 3.4.19, by bisecting the
  URL one feature at a time on the same client and diffing the emitted CSS each time:

  | `@import` URL | in the artefact? |
  |---|---|
  | `...css2?family=Space+Grotesk&display=swap` | **kept** |
  | `...css2?family=Space+Grotesk:wght@300;400;500&display=swap` (semicolons) | **kept** |
  | `...css2?family=Space+Grotesk&family=Bodoni+Moda&display=swap` (two families) | **kept** |
  | `...css2?family=Space+Grotesk:wght@300,400,500&display=swap` (**comma**) | **DROPPED** |
  | `...css2?family=Bodoni+Moda:opsz,wght@6..96,400&display=swap` (**comma**) | **DROPPED** |
  | `https://example.com/a,b/style.css` (comma in the PATH) | **DROPPED** |
  | the same comma URL, comma written `%2C` | **kept** |

  The comma is the entire mechanism. Position in the file is irrelevant, `output: 'export'` is
  irrelevant, and quoting style / `url()` vs bare string / a `layer()` clause make no difference.
  It is **Turbopack-specific**: the identical source built with `npx next build --webpack` keeps
  the `@import` and its fonts. The PostCSS stage is innocent too — running the project's own
  `postcss` + `tailwindcss` config by hand emits the `@import` intact, so the loss happens
  downstream in Turbopack's CSS pipeline, which drops the whole at-rule and emits **no warning**.

  This also retires the earlier "version-dependent, a fresh `npm install` picks it up" guess: the
  other client on this install kept its `@import` purely because its URL
  (`Figtree:wght@300;400;500;600;700`) has **zero commas**. Nothing about the version differed.

  This is the nastiest class of defect in this repo: **it passes every source-level grep**, the
  `font-family` cascade in `globals.css` looks perfect, no build warning is emitted, and the only
  symptom is that the site renders in Georgia and Helvetica, which is exactly the generic "AI
  template" look the font rules exist to prevent.

  **Fix: `next/font/google` in `layout.tsx`.** It self-hosts the woff2 into the export, so there is
  no remote request to lose, no third-party dependency and no FOUT. Keep the `--font-display` /
  `--font-body` custom properties in `globals.css`; point them at the `variable` next/font exposes:
  ```tsx
  const display = Bodoni_Moda({ subsets:["latin"], display:"swap",
    weight:["400","600","700"], variable:"--font-display-src" });
  <html lang="en" className={`${display.variable} ${body.variable}`}>
  ```
  ```css
  --font-display: var(--font-display-src), Georgia, serif;
  ```
  A `<link rel="stylesheet">` in `<head>` also survives the build, but it keeps the third-party
  request — and in a sandbox that blocks cross-origin font CSS (`ERR_BLOCKED_BY_ORB`) it cannot be
  proven locally, so `next/font/google` is the mandated path.

  **Verify on the artefact and the rendered page, never on the source:**
  ```bash
  npx next build
  node scripts/font-check.mjs clients/<slug>/site   # must print FONT_CHECK=PASS
  ```
  ⚠️ **`getComputedStyle(el).fontFamily` DOES NOT catch this.** It returns the *declared* stack
  (`"Bodoni Moda", Georgia, serif`) identically on a working and a broken build, because computed
  style never tells you which family was actually *used*. On the broken build the `h1` still
  computes to `"Bodoni Moda", Georgia, serif` while rendering in Georgia — measured, the same
  headline was 942px wide broken vs 865px fixed. `font-check.mjs` width-probes the rendered glyphs
  against serif/sans-serif/monospace baselines and cross-checks `document.fonts`, which is what
  actually fires. `document.fonts.check()` is also unusable alone: per spec it returns **true** for
  any family that needs no loading, i.e. true for every unknown family that silently falls back.

- **`src/app/fonts/GeistVF.woff` and `GeistMonoVF.woff` ship in the scaffold and are never
  referenced.** Geist is on the banned list, so delete both (and the now-empty `src/app/fonts/`)
  during setup rather than exporting dead bytes.

## 2026-08-22 — ServiceDetailFrame + thin-service gate
`ServiceDetailFrame` is mandatory on `/services/<slug>` (BOTH lanes): photo-ground hero + `band-depth-frost` body. Do not hand-roll video heroes + flat `bg-surface-1` bodies — `MEDIA_SURFACE_CHECK` fails closed. Richness thin-service measures built `out/services/*.html` (≥220 words, ≥2 h2); never rely on stripping TSX tags alone (that ate `body="…"` props inside self-closing JSX). Same-town Frisco pairings: run `palette-uniqueness` + `font-uniqueness` before locking accents/fonts. Dark logos need `inspect-logo --write` → `navTheme: light` and matching footer plate.

## 2026-08-22 — Privacy/terms are generated, not stubbed
Never ship the one-paragraph "demo preview" privacy/terms. Run `node scripts/generate-legal-pages.mjs $SLUG --write` after site-data exists. Gate with `--check` / richness `[legal]`.
