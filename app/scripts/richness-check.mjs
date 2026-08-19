#!/usr/bin/env node
/**
 * richness-check.mjs <site-dir> [--json]
 *
 * Fails a build that DERIVED a rich design system and then painted with four crayons.
 *
 * WHY THIS EXISTS — measured on the live demolition-okc build, 2026-08-16, after the operator said
 * "i dont see much motion, i dont see color theory, i dont see section backgroudns or textures or
 * gradients". Every one of those was true, and the numbers were damning precisely because the
 * skills had all RUN:
 *
 *   derive-palette produced 38 tokens, including a real complementary --secondary (#52baf7)
 *   ...the secondary appeared on   0  elements
 *   ...gradients on the page:       0
 *   ...grain texture:               present, at opacity 0.05 — technically shipped, humanly invisible
 *   ...section backgrounds:         3 distinct values, all neutral, alternating dark/cream/dark
 *
 * Nothing was broken. Every gate passed. Contrast was 934/934. The site was CORRECT and flat.
 *
 * That is the failure mode this file exists for: prose in a skill saying "use the palette" loses to
 * a builder juggling a hundred other rules, and no existing gate could tell a rich page from a bare
 * one because every existing gate measured correctness. Richness needs its own counted floor, for
 * the same reason contrast did — a reviewer does not notice arithmetic, and does not notice absence.
 *
 * SCOPE: this reads the BUILT HTML/CSS, so it measures what ships rather than what was intended.
 * It deliberately does NOT judge taste. It asks four questions with numeric answers: is more than
 * the accent in play, is there any depth, is the texture perceptible, does the page have rhythm.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const siteDir = args.find((a) => !a.startsWith('--')) || '.';

const outDir = ['out', 'dist', 'build'].map((d) => join(siteDir, d)).find((d) => existsSync(d));
if (!outDir) {
  console.error(`richness-check: no built output under ${siteDir}. Run \`npx next build\` first.`);
  process.exit(2);
}

const failures = [];
const warnings = [];
const facts = {};

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else out.push(p);
  }
  return out;
}

const files = walk(outDir);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
const pages = files.filter((f) => f.endsWith('.html') && !/404|_not-found/.test(f));
const html = pages.map((f) => readFileSync(f, 'utf8')).join('\n');
const all = css + '\n' + html;

/* 0. INVALID NUMERIC TAILWIND FONT-WEIGHT CLASSES. Caught live 2026-08-16: a build used
 * `font-700`/`font-800`/`font-900` (52 occurrences) — none are real Tailwind v3 utilities (the
 * named scale is font-thin/extralight/light/normal/medium/semibold/bold/extrabold/black), so they
 * compiled to nothing and every affected heading silently rendered at the browser default weight.
 * A source grep alone can look clean-ish (the class IS there, just wrong); this checks the
 * COMPILED CSS actually has no rule for it, which is the real, unambiguous test. */
const usedFontWeightNums = [...new Set((html.match(/\bfont-[0-9]00\b/g) || []))];
const compiledFontWeightNums = new Set(
  [...css.matchAll(/\.font-([0-9]00)\\?\{/g)].map((m) => `font-${m[1]}`),
);
const deadFontWeightClasses = usedFontWeightNums.filter((c) => !compiledFontWeightNums.has(c));
if (deadFontWeightClasses.length) {
  failures.push(
    `[css] used but never compiled: ${deadFontWeightClasses.join(', ')} — these are not real ` +
    'Tailwind v3 utilities (the named scale is font-thin/extralight/light/normal/medium/' +
    'semibold/bold/extrabold/black; e.g. font-800 -> font-extrabold, font-900 -> font-black). ' +
    'Every element using one of these renders at the browser default weight instead of the ' +
    'designed one. Confirmed against the compiled CSS, not just source — the class not compiling ' +
    'is the actual defect, independent of whether the source "looks" intentional.');
}

/* 1. IS THE DERIVED PALETTE ACTUALLY IN PLAY?
 * derive-palette emits --secondary and its text/fill variants specifically so a page has a second
 * hue to reach for. A page using only the accent is a page that threw away half the design system,
 * and it reads — correctly — as a one-colour template. */
const declaresSecondary = /--secondary\s*:/.test(all);

/* COUNT THE HEX, NOT var(). Tailwind resolves theme colours at build time and INLINES the hex, so a
 * correctly-used token shows ZERO var() references — measured: `--accent` had 0 var() uses while
 * `#ff8d13` appeared 8 times in the shipped CSS. Testing var() would have failed a build that used
 * the secondary properly, which is the cry-wolf failure this file explicitly exists to avoid.
 *
 * So: find the declared hex, then count its occurrences BEYOND the declarations themselves. */
const secHexes = [...all.matchAll(/--secondary[a-z-]*\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
const uniqSecHexes = [...new Set(secHexes)];
let usesSecondary = 0;
for (const hex of uniqSecHexes) {
  const total = (all.match(new RegExp(hex, 'gi')) || []).length;
  const decls = secHexes.filter((h) => h === hex).length;
  usesSecondary += Math.max(0, total - decls);
}
// Tailwind class names referencing the token are also real usage.
usesSecondary += (all.match(/\b(?:bg|text|border|fill|stroke|ring|from|to|via)-secondary[a-z-]*/g) || []).length;
usesSecondary += (all.match(/var\(--secondary[a-z-]*\)/g) || []).length;
facts.secondaryDeclared = declaresSecondary;
facts.secondaryUses = usesSecondary;
if (declaresSecondary && usesSecondary === 0) {
  failures.push(
    '[palette] --secondary is DERIVED but referenced 0 times. The build painted with the accent ' +
    'only, which is exactly what reads as "single colour". Deploy it on eyebrows, stat figures, ' +
    'icon strokes, dividers, link hovers or a section wash — anywhere that is not body text.');
} else if (declaresSecondary && usesSecondary < 3) {
  warnings.push(`[palette] --secondary referenced only ${usesSecondary}x — present but not doing work.`);
}

/* 2. DEPTH. A page with zero gradients is a page of flat rectangles. This counts gradient FUNCTIONS
 * in shipped CSS/inline styles, not intent. Two is a floor, not a target: one hero wash and one
 * section transition is the minimum that stops a page reading as slabs stacked on slabs. */
/* ⚠️ THIS COUNTS DECLARATIONS, NOT RENDERED ELEMENTS, and the difference is large: measured in a
 * real browser on the live page, 9 gradient declarations in the CSS produced only **2** painting
 * elements. A stylesheet rule that no element carries is not depth. So the threshold is set against
 * what a page realistically needs PAINTED, the count is labelled honestly, and the QA agent is the
 * one that checks the rendered number in a browser. */
const gradients = (all.match(/(linear|radial|conic)-gradient\(/g) || []).length;
facts.gradientDeclarations = gradients;
if (gradients === 0) {
  failures.push(
    '[depth] ZERO gradients in the shipped CSS. Every section is a flat fill, so the page reads as ' +
    'stacked slabs. Add at least a hero scrim wash and one section-to-section transition, built ' +
    'from the derived tokens rather than hand-picked hexes.');
} else if (gradients < 4) {
  // Promoted WARN -> FAIL 2026-08-18: Jeff hand-inspected a real, already-deployed build
  // (aot-mechanical) that passed this WARN and found it genuinely flat live ("sections with
  // backgrounds are also plain, no textures, gradients, photo overlays... something is off").
  // A WARN a build can ship under is not a floor. See hyperui-transplant-check.mjs's header
  // for the same promotion and the same reasoning.
  failures.push(
    `[depth] only ${gradients} gradient DECLARATION(s) in CSS — and declarations overstate reality: ` +
    'a build with 9 declared painted just 2. Add a hero scrim, a section transition, and at ' +
    'least one card or panel wash, all `in oklch`. QA verifies the RENDERED count in a browser.');
}

/* 3. TEXTURE THAT CAN ACTUALLY BE SEEN. The template ships a `.grain` overlay and the build used
 * it — at opacity 0.05, which is below the threshold where a human perceives it on a photograph,
 * let alone a flat fill. Shipping an invisible texture is worse than shipping none: it looks done. */
// Minified CSS joins selectors with commas: `.grain::after,.grain-dark::after{...}`. A regex
// anchored on `.grain::after {` matches the SOURCE and misses the SHIPPED file, reporting 0 rules
// on a build that ships the texture — a false clean. Match any rule whose selector list mentions
// .grain, then read its opacity.
const grainRule = (css.match(/[^{}]*\.grain[^{}]*\{[^}]*\}/g) || []);
const opacities = grainRule.flatMap((r) => (r.match(/opacity:\s*([0-9.]+)/g) || []).map((m) => parseFloat(m.split(':')[1])));
facts.grainRules = grainRule.length;
facts.grainOpacities = opacities;
if (grainRule.length && opacities.length && Math.max(...opacities) < 0.08) {
  failures.push(
    `[texture] grain overlay ships at opacity ${Math.max(...opacities)} — below human perception. ` +
    'It costs the same to render and buys nothing. Light surfaces want ~0.10-0.14, dark ~0.14-0.20.');
}

/* 4. RHYTHM. Count DISTINCT section background treatments across the home page. Alternating two
 * neutrals is not rhythm, it is a stripe. Four distinct treatments across a long page is the point
 * at which scrolling feels authored rather than generated. */
const home = pages.find((p) => /(^|\/)index\.html$/.test(p));
if (home) {
  const h = readFileSync(home, 'utf8');
  const secClasses = [...h.matchAll(/<section[^>]*class="([^"]*)"/g)].map((m) => m[1]);
  const treatments = new Set(secClasses.map((c) =>
    (c.match(/bg-[a-z0-9/\[\]#.-]+/g) || []).sort().join(' ') || '(none)'));
  facts.sections = secClasses.length;
  facts.distinctTreatments = treatments.size;
  if (secClasses.length >= 5 && treatments.size < 3) {
    failures.push(
      `[rhythm] ${secClasses.length} sections but only ${treatments.size} distinct background ` +
      'treatment(s). Alternating two neutrals is a stripe, not rhythm. Aim for 4+ across a long ' +
      'page: light, alt-light, dark, image/gradient-backed.');
  }
  // Stagger — the difference between "things fade in" and "the page feels crafted".
  const groups = (h.match(/data-reveal-group/g) || []).length;
  const reveals = (h.match(/data-reveal[ ="]/g) || []).length;
  facts.reveals = reveals; facts.revealGroups = groups;
  const grids = (h.match(/class="[^"]*grid[^"]*"/g) || []).length;
  if (grids >= 2 && groups === 0) {
    failures.push(
      `[motion] ${grids} grid(s) on the home page and ZERO data-reveal-group. Every section fades ` +
      'in as one solid block, so a card grid moves like a slab. Stagger is what reads as craft.');
  }

  /* 4b. PHOTO ART DIRECTION. Measured 2026-08-16: every photo across every shipped client was a
   * bare <img> in a plain rounded rectangle — no duotone, no graphic containment, no directional
   * scrim, not even on the hero. Scraped Google Maps/Facebook photos are inconsistent raw material;
   * an untreated photo reads as "we pasted what we scraped", which is the opposite of designed.
   * `data-photo-treatment` is the deliberately unambiguous signal — see build/SKILL.md
   * § "Photo art direction" for the three valid values and why an attribute beats inferring intent
   * from Tailwind class soup. */
  const imgCount = (h.match(/<img\b/g) || []).length;
  const treatedCount = (h.match(/data-photo-treatment="(duotone|contained|scrim)"/g) || []).length;
  facts.images = imgCount;
  facts.treatedPhotos = treatedCount;
  if (imgCount >= 2 && treatedCount === 0) {
    failures.push(
      `[photo] ${imgCount} photo(s) on the home page and ZERO carry data-photo-treatment. Every ` +
      'image ships as a bare rectangle — scraped raw material presented as-is reads as pasted, not ' +
      'art-directed. Give the hero and at least one section-anchor photo a duotone, graphic-' +
      'containment, or directional-scrim treatment (see § Photo art direction).');
  }

  /* 4c. HERO MOTION. Measured 2026-08-16: `data-reveal` is correctly banned from the hero (it
   * tweens through opacity:0, which disqualifies the element from LCP candidacy), but that got
   * over-applied into "the hero has no motion at all" — an operator looking at a finished,
   * otherwise-improved build called it out by name: "no hero motion". `data-hero-reveal` is the
   * LCP-safe fix (Motion.tsx tweens only y/scale for it, opacity never moves), and it must
   * actually be present on the hero's text/CTA wrapper, not just theoretically available.
   *
   * FIXED 2026-08-16 (real false positive, caught live on build 3): this originally used the same
   * "first 6000 chars = hero area" fixed-window heuristic as the composition check below. On an
   * assetPrefix-deployed build (`/klaudius/{slug}/`-prefixed asset URLs throughout <head> and nav)
   * the real `data-hero-reveal` attribute landed at byte 7427 — past the window — so a build that
   * had correctly done everything reported FAIL. Verified directly against the built HTML before
   * fixing (`grep -bo data-hero-reveal out/index.html`), not just trusting the build's own claim.
   * Fix: find the hero SECTION's real boundary (its own `data-hero` tag to the next top-level
   * `<section`) instead of guessing a byte count — correct regardless of how large <head>/nav is. */
  const heroTagIdx = h.search(/<section\b[^>]*\bdata-hero\b/);
  let heroHasReveal = false;
  if (heroTagIdx !== -1) {
    const nextSectionIdx = h.indexOf('<section', heroTagIdx + 1);
    const heroSectionChunk = h.slice(heroTagIdx, nextSectionIdx === -1 ? heroTagIdx + 20000 : nextSectionIdx);
    heroHasReveal = /data-hero-reveal\b/.test(heroSectionChunk);
  }
  facts.heroReveal = heroHasReveal;
  if (/data-hero\b/.test(h) && !heroHasReveal) {
    failures.push(
      '[motion] the hero section has no data-hero-reveal on its text/CTA content — it will render ' +
      'perfectly static while every other section on the page moves. This is NOT the same as the ' +
      'data-reveal ban (that one is correct and stays): data-hero-reveal tweens y/scale only, never ' +
      'opacity, so it never risks LCP. Put it on the wrapper div immediately inside the hero holding ' +
      'the eyebrow/h1/dek/CTA row.');
  }

  /* 4d. SERVICE-PAGE / BLOG COUPLING CONTRADICTION. build/SKILL.md § "Per-service pages" says a
   * blog article's worth of substance almost always clears the 120-word bar for a /services/<slug>
   * page too, and to decide both together — written 2026-08-16 specifically because demolition-okc
   * wrote 5 real blog articles while giving every service "no dedicated page". The SAME contradiction
   * recurred on the next build anyway (the-woodlands-plumbing-and-air, same night): every one of 5
   * services got a real blog article AND a "/services/slug: no (<120)" verdict in status.md's own
   * per-service table. The rule was prose; prose lost. This reads status.md's own decision table
   * (sibling of site-dir) and fails on any row that claims a blog article but no dedicated page —
   * the exact contradiction the rule exists to prevent, now caught mechanically instead of trusted. */
  const statusPath2 = join(siteDir, '..', 'data', 'status.md');
  if (existsSync(statusPath2)) {
    const statusText = readFileSync(statusPath2, 'utf8');
    const rows = statusText.split('\n').filter((l) => /^\s*\|.*\|.*\|.*\|.*\|/.test(l) && !/^\s*\|[\s-]*\|[\s-]*\|/.test(l));
    const contradictions = rows.filter((row) => {
      const cells = row.split('|').map((c) => c.trim());
      // Expect: | Service | Words | /services section | /services/slug | Blog article |
      if (cells.length < 6) return false;
      const slugCell = (cells[4] || '').toLowerCase();
      const blogCell = (cells[5] || '').toLowerCase();
      const slugSaysNo = /^no\b/.test(slugCell);
      const blogSaysYes = /^yes\b/.test(blogCell);
      return slugSaysNo && blogSaysYes;
    });
    if (contradictions.length) {
      failures.push(
        `[structure] status.md's per-service table has ${contradictions.length} row(s) with a real ` +
        'blog article but no /services/<slug> page — the exact contradiction build/SKILL.md\'s § ' +
        '"Per-service pages" says to decide together. If there was enough substance for a blog ' +
        'article, there is enough for the service page (write it), or the blog article should not ' +
        'exist either (cut it). Rows: ' + contradictions.map((r) => r.split('|')[1]?.trim()).join(', '));
    }
  }
}

/* 5. WEIGHT BUDGETS — the thing that actually decides the mobile Lighthouse score.
 *
 * Measured on the live build 2026-08-16: desktop Performance 100, MOBILE 77, with LCP 5.3s and
 * "Improve image delivery — Est savings of 748 KiB". The single hero JPEG was 809 KB. Desktop hides
 * this completely (100/100 on a fast pipe), which is exactly why it needs a gate: the number that
 * matters is the one a business owner sees on a phone on cell data, and it is the one nobody checks.
 *
 * `output: 'export'` means next/image optimisation is NOT available, so nothing shrinks these
 * automatically. Whatever the gather downloaded is what ships. */
const imgs = files.filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));
const sized = imgs.map((f) => ({ f, kb: Math.round(statSync(f).size / 1024) })).sort((a, b) => b.kb - a.kb);
facts.imageCount = imgs.length;
facts.imageTotalKB = sized.reduce((n, x) => n + x.kb, 0);
facts.largestImageKB = sized[0]?.kb || 0;
const HERO_MAX_KB = 250, TOTAL_MAX_KB = 1800;
const fat = sized.filter((x) => x.kb > HERO_MAX_KB);
if (fat.length) {
  failures.push(
    `[weight] ${fat.length} image(s) over ${HERO_MAX_KB}KB — largest ${fat[0].kb}KB ` +
    `(${fat[0].f.split('/').pop()}). On a static export there is no next/image to rescue this; it ` +
    'goes out at full size and lands on LCP. Resize to the largest rendered dimension and emit ' +
    'WebP/AVIF at build time.');
}
if (facts.imageTotalKB > TOTAL_MAX_KB) {
  warnings.push(`[weight] ${facts.imageTotalKB}KB of images total — mobile LCP will suffer.`);
}

/* 6. EXPLICIT DIMENSIONS. Lighthouse flags "Image elements do not have explicit width and height";
 * without them the browser cannot reserve space, which costs CLS and delays LCP. */
const imgTags = (html.match(/<img\b[^>]*>/g) || []);
const undim = imgTags.filter((t) => !/\bwidth=/.test(t) || !/\bheight=/.test(t));
facts.imgTags = imgTags.length; facts.imgTagsMissingDims = undim.length;
if (undim.length) {
  warnings.push(`[cls] ${undim.length}/${imgTags.length} <img> without explicit width+height.`);
}

/* 7. DESCRIPTIVE LINK TEXT. Lighthouse SEO flagged 8 links. "Learn more" / "click here" / a bare
 * URL tells neither a crawler nor a screen reader what is on the other side. */
const linkTexts = [...html.matchAll(/<a\b[^>]*>([\s\S]{0,80}?)<\/a>/g)]
  .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);
const vague = linkTexts.filter((t) => /^(learn more|read more|click here|here|more|this|link|see more)$/.test(t));
facts.vagueLinks = vague.length;
if (vague.length) {
  warnings.push(`[seo] ${vague.length} link(s) with non-descriptive text (e.g. "learn more").`);
}

/* 8. COLOUR-VISION-DEFICIENCY SAFETY — nothing in this pipeline has ever checked it.
 *
 * From the `color-expert` reference on palette linting: CVD safety is a first-class lint, alongside
 * contrast. Roughly 8% of men have some form of CVD, so on a site sent to a few thousand business
 * owners it is not an edge case. Our accent and secondary are derived on a HUE relationship —
 * exactly the relationship that collapses under protanopia/deuteranopia. An orange accent and a
 * green secondary can be a clean 40deg apart in OKLCH and land within a few deltaE of each other
 * for a deuteranope, at which point "primary action" and "secondary action" are the same button.
 *
 * Brettel/Vienot-style simulation, matrices in linear-RGB. This is a coarse check on purpose: it
 * asks only whether two derived roles stay TELLABLE APART, not whether the palette is beautiful.
 */
function hexToLin(h) {
  const m = h.replace('#', '').match(/.{2}/g);
  if (!m) return null;
  return m.map((x) => { const c = parseInt(x, 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
}
const CVD = {
  // Machado et al. severity-1.0 matrices, the commonly used approximation.
  protanopia:   [[0.152, 1.053, -0.205], [0.115, 0.786, 0.099], [-0.004, -0.048, 1.052]],
  deuteranopia: [[0.367, 0.861, -0.228], [0.280, 0.673, 0.047], [-0.012, 0.043, 0.969]],
  tritanopia:   [[1.256, -0.077, -0.179], [-0.078, 0.931, 0.148], [0.005, 0.691, 0.304]],
};
const apply = (lin, M) => M.map((r) => r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]);
const dist = (a, b) => Math.sqrt(a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0));

const tokenHex = (name) => (css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
const accentHex = tokenHex('accent'), secHex = tokenHex('secondary');
if (accentHex && secHex) {
  const a = hexToLin(accentHex), b = hexToLin(secHex);
  const collapses = [];
  for (const [name, M] of Object.entries(CVD)) {
    const d = dist(apply(a, M), apply(b, M));
    if (d < 0.12) collapses.push(`${name} (${d.toFixed(3)})`);
  }
  facts.cvdAccentVsSecondary = collapses.length ? collapses : 'distinct under all three';
  if (collapses.length) {
    warnings.push(
      `[cvd] --accent ${accentHex} and --secondary ${secHex} become hard to tell apart under ` +
      `${collapses.join(', ')}. ~8% of men see one of these. Separate them by LIGHTNESS as well as ` +
      'hue — a lightness difference survives every CVD type, a hue difference does not.');
  }
}

/* 9. GRADIENT INTERPOLATION SPACE. An sRGB gradient between two saturated colours passes through a
 * desaturated grey middle — the "muddy mid-tone" the colour references warn about — which is a
 * large part of why hand-rolled gradients look cheap and get abandoned. `in oklch` / `in oklab`
 * keeps chroma up across the whole ramp. Free to adopt: it is one clause in the CSS. */
const gradDecls = all.match(/(linear|radial|conic)-gradient\([^)]*\)/g) || [];
const perceptual = gradDecls.filter((g) => /\bin (oklch|oklab|lch|lab)\b/.test(g)).length;
facts.gradientsPerceptual = `${perceptual}/${gradDecls.length}`;
if (gradDecls.length && perceptual === 0) {
  warnings.push(
    `[depth] ${gradDecls.length} gradient(s), none interpolated in a perceptual space. sRGB ramps ` +
    'pass through a grey middle; use `linear-gradient(in oklch, ...)` to keep chroma across the ramp.');
}

/* 10. DESIGN-CONSULT ADOPTION — did the build USE what /ui-ux-pro-max returned?
 *
 * The sharpest failure found on 2026-08-16 was not a skipped step. The design consult RAN for
 * build 3 — its typography output (Fraunces / Albert Sans) is exactly what shipped. But the same
 * consult also returned a STYLE ("Exaggerated Minimalism") with concrete effects
 * (clamp(3rem,10vw,12rem), font-weight 900, letter-spacing -0.05em) and a COLOR direction
 * ("Industrial grey + safety orange"). The build took the fonts and dropped everything else, which
 * is why a site with a mandatory design step still read generic.
 *
 * A skipped step is easy to catch. A step that ran and was 20% applied is invisible, and it is the
 * more common failure — so it needs its own check.
 *
 * DEVIATION IS ALLOWED, SILENCE IS NOT. Overriding "industrial grey" with the client's real brand
 * orange is arguably the RIGHT call — brand fidelity beats a generic suggestion. So the rule is
 * adopt-or-document: any recommendation not visible in the build must be named in status.md with a
 * reason. That keeps judgement with the builder while making an unconsidered drop impossible.
 */
const dsPath = ['../data/design-system.md', 'data/design-system.md']
  .map((r) => join(siteDir, r)).find((f) => existsSync(f));
const statusPath = ['../data/status.md', 'data/status.md']
  .map((r) => join(siteDir, r)).find((f) => existsSync(f));
if (!dsPath) {
  failures.push(
    '[design] clients/<slug>/data/design-system.md is missing — the /ui-ux-pro-max output was ' +
    'never persisted, so there is no way to tell whether the consult ran, was skipped, or ran and ' +
    'was ignored. Tee the search.py output at consult time.');
} else {
  const ds = readFileSync(dsPath, 'utf8');
  const status = statusPath ? readFileSync(statusPath, 'utf8') : '';
  const dropped = [];

  // KEY EFFECTS is the most-dropped block and the most visually consequential.
  const fx = (ds.match(/KEY EFFECTS:?([\s\S]{0,400}?)(\n\s*\|?\s*(AVOID|PRE-DELIVERY)|$)/i) || [])[1] || '';
  const fxTokens = [...fx.matchAll(/(clamp\([^)]*\)|font-weight:\s*\d{3}|letter-spacing:\s*-?[\d.]+em)/gi)]
    .map((m) => m[1].replace(/\s+/g, ''));
  for (const t of fxTokens) {
    const prop = t.split(':')[0];
    const val = t.split(':')[1];
    const present = val
      ? new RegExp(`${prop}\\s*:\\s*${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(all)
      : all.includes(t.slice(0, 12));
    // ESCAPE before building a regex from recommendation text. `clamp(3rem` is not a valid
    // pattern — it throws "Unterminated group" and takes the whole gate down. A checker that
    // crashes is a checker that never runs, which is worse than one that misses.
    const needle = t.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!present && !new RegExp(needle, 'i').test(status)) dropped.push(`effect ${t}`);
  }

  /* NOTE: colour recommendations are deliberately NOT checked for adoption. The build skill's
   * precedence table gives colour to derive-palette + color-expert, because only they can prove
   * 4.5:1 and CVD separation against THIS client's real surfaces — a generic palette cannot. The
   * consult owns layout, style, effects and type; overriding its colour is expected, not a defect.
   * Checking colour adoption here would fail correct builds and train people to ignore the gate. */
  // STYLE name should appear somewhere in the record if it was adopted, or be justified if not.
  const styleName = ((ds.match(/STYLE:\s*([A-Za-z][A-Za-z \-]{3,40})/) || [])[1] || '').trim();
  if (styleName && status && !new RegExp(styleName.split(/\s+/)[0], 'i').test(status)) {
    dropped.push(`style "${styleName}" not referenced in status.md`);
  }

  facts.designConsult = { effectsRecommended: fxTokens.length, dropped: dropped.length };
  if (dropped.length) {
    failures.push(
      `[design] ${dropped.length} design-consult recommendation(s) neither applied nor documented: ` +
      `${dropped.slice(0, 4).join('; ')}. Deviating is fine — brand fidelity often beats a generic ` +
      'suggestion — but write the deviation and its reason into status.md. A silent drop is how a ' +
      'build with a mandatory design step still ships generic.');
  }

  /* DESIGN_IDEA / signature moves (2026-08-19 Fable design-elevation review, C3) — extends the same
   * adopt-or-document mechanism above to the model-AUTHORED creative commitments, not just the
   * tool's recommendations. § build/SKILL.md's design-system step now requires a one-sentence
   * DESIGN_IDEA and 3 named signature moves BEFORE any TSX is written. This checks presence (the
   * step was genuinely done, not skipped) — same discipline as VERIFY_GATES_OK_AT's presence check
   * elsewhere in this pipeline, applied to a creative artifact instead of a technical one. */
  const hasDesignIdea = /DESIGN_IDEA\s*=/.test(status);
  const signatureMoveCount = [...status.matchAll(/Signature move \d+:/gi)].length;
  facts.designIdea = { present: hasDesignIdea, signatureMoves: signatureMoveCount };
  if (!hasDesignIdea || signatureMoveCount < 3) {
    failures.push(
      `[design] DESIGN_IDEA and/or its 3 signature moves are missing from status.md ` +
      `(present=${hasDesignIdea}, signature moves recorded=${signatureMoveCount}/3). This is the ` +
      'one-sentence organizing idea every choice on the page should serve, required before any TSX ' +
      'per the design-system step — its absence is exactly how a build satisfies every other gate ' +
      'and still reads as arranged-not-authored.');
  }
}

/* 11. theme-color ON EVERY PAGE — the iPhone white-band bug.
 *
 * iOS paints the strip around its own browser chrome from `theme-color`, not the page background,
 * so a dark navbar with no theme-color shows a WHITE BAND above it on an iPhone while looking
 * perfect on desktop and in every 1440x900 screenshot. Reported from a real handset 2026-08-16;
 * the live page had no theme-color meta at all, and neither did the skill.
 *
 * Checked here rather than as a QA checklist line because it is invisible in the exact medium QA
 * reviews in — a desktop screenshot — and a human reviewer will never miss it and never catch it.
 * Per-page, because it comes from a layout export and a route that opts out of that layout drops it
 * silently.
 */
/* viewport-fit=cover is checked WITH theme-color because theme-color alone does not fix the iOS
 * white band — without cover the page never extends under the status bar, env(safe-area-inset-top)
 * is 0, and a fixed top-0 nav starts below the inset. Verified on a real handset: the meta was
 * present and correct in the served HTML while the phone still showed white. */
const noCover = pages.filter((f) => !/viewport-fit\s*=\s*cover/i.test(readFileSync(f, 'utf8')));
facts.viewportFitPages = `${pages.length - noCover.length}/${pages.length}`;
if (noCover.length) {
  failures.push(
    `[ios] ${noCover.length}/${pages.length} page(s) missing viewport-fit=cover. Without it the page ` +
    'never reaches under the status bar and iOS paints that strip itself — theme-color cannot fix ' +
    'it. Add `viewportFit: "cover"` to the layout viewport export AND pad the fixed nav with ' +
    'env(safe-area-inset-top).');
}

const noTheme = pages.filter((f) => !/name=["']theme-color["']/i.test(readFileSync(f, 'utf8')));
facts.themeColorPages = `${pages.length - noTheme.length}/${pages.length}`;
if (noTheme.length) {
  failures.push(
    `[ios] ${noTheme.length}/${pages.length} page(s) have no <meta name="theme-color"> — ` +
    `${noTheme.slice(0, 3).map((f) => f.split('/').pop()).join(', ')}. iPhones will paint a white ` +
    'band above the navbar. Add `export const viewport = { themeColor: "#hex" }` to layout.tsx ' +
    "using the NAV's surface colour as a LITERAL hex (a var() reference resolves to nothing).");
}

/* 12. BODY TYPOGRAPHY — found by auditing a live "passing" build, 2026-08-16.
 *
 * The page satisfied every other gate and still read flat, and two of the reasons were measurable:
 * body text set at **14px / weight 600**. Both are wrong against `ui-ux-pro-max`'s own rules
 * ("Minimum 16px body text on mobile", "Regular body (400)"), and together they do real damage:
 *
 *   - 14px body is small on a phone and forces iOS to auto-zoom any focused input under 16px.
 *   - weight 600 body against a 900 display face THROWS AWAY the pairing. The consult picks a
 *     serif/sans pair for the trade precisely so the two contrast; levelling body to semibold
 *     collapses that into one texture, and the page reads uniform no matter how good the fonts are.
 *
 * Checked in CSS rather than the browser because both are declared, not computed-by-cascade.
 */
/* ⚠️ CSS-ONLY DETECTION IS UNRELIABLE HERE and this check proved it on the build that prompted it:
 * a real browser measured body at 14px/600 while this returned "not declared", because Tailwind
 * applies body type through UTILITY CLASSES rather than a `body {}` rule. So treat a hit as
 * meaningful and a miss as unknown — the authoritative check is getComputedStyle in the QA browser
 * pass, which is where the rule now lives. Same failure shape as counting gradient declarations
 * instead of rendered gradients. */
const bodyRules = css.match(/(?:^|\})[^{}]*\bbody\b[^{}]*\{[^}]*\}/g) || [];
const bodyBlock = bodyRules.join(' ');
const fs = (bodyBlock.match(/font-size:\s*([0-9.]+)px/) || [])[1];
const fw = (bodyBlock.match(/font-weight:\s*([0-9]{3})/) || [])[1];
facts.bodyFontSize = fs || 'not declared on body';
facts.bodyFontWeight = fw || 'not declared on body';
/* The 16px floor is a FORM-INPUT rule, not a body-copy rule — corrected after operator pushback
 * ("body text doesn't need to be 16, that's way too big on a phone"). iOS auto-zooms a FOCUSED
 * INPUT under 16px; body paragraphs have no such trigger and 14-16px is a comfortable phone range.
 * Forcing 16px everywhere produces a large-print page. So body is only flagged below 14px, and the
 * real 16px check belongs on inputs. */
if (fs && parseFloat(fs) < 14) {
  warnings.push(`[type] body font-size is ${fs}px — under 14px is genuinely small for body copy.`);
}
const smallInputs = (css.match(/input[^{}]*\{[^}]*font-size:\s*(1[0-5]|[0-9])(\.[0-9]+)?px/g) || []).length;
facts.inputsUnder16px = smallInputs;
if (smallInputs) {
  failures.push(
    `[type] ${smallInputs} input rule(s) with font-size under 16px. iOS ZOOMS the page when such a ` +
    'field is focused, and the visitor experiences that as "I had to pinch to fill the form". ' +
    'This is the one place 16px is non-negotiable.');
}
if (fw && parseInt(fw, 10) >= 500) {
  failures.push(
    `[type] body font-weight is ${fw} — body should be 400. A semibold body against a display-weight ` +
    'heading collapses the serif/sans contrast the design consult chose for this trade, and the page ' +
    'reads as one uniform texture however good the pairing is.');
}

/* 13. THE CENTRED-HERO SIGNATURE. Centred headline + centred subhead + centred buttons is the most
 * recognisable AI-site layout there is. Warn rather than fail: a centred hero is a legitimate
 * choice occasionally, but it should be deliberate, so it must at least be argued in status.md. */
if (home) {
  const h = readFileSync(home, 'utf8');
  const heroChunk = h.slice(0, 6000);
  const centred = /class="[^"]*\b(text-center|items-center justify-center|mx-auto text-center)\b/.test(heroChunk);
  facts.heroCentred = centred;
  if (centred && !/asymmetr|centred hero|centered hero/i.test(statusPath ? readFileSync(statusPath, 'utf8') : '')) {
    warnings.push(
      '[composition] hero appears centre-aligned — the most recognisable AI-site signature. Prefer ' +
      'the headline on a 7/12 column with media taking the remainder, slightly overlapping. If ' +
      'centred is deliberate, say why in status.md.');
  }
}

/* 14. PHOTO-GROUNDED SECTIONS — the "ingredients" the operator kept missing.
 * A page of flat fills reads flat however good the palette is. At least two sections should sit on
 * a gathered photo behind an 80-88% colour wash, which is what produces the "ghosted in" depth. */
if (home) {
  const h = readFileSync(home, 'utf8');
  const photoGrounds = (h.match(/<section[^>]*>[\s\S]{0,400}?<img[^>]*absolute[^>]*inset-0/g) || []).length;
  facts.photoGroundedSections = photoGrounds;
  if (photoGrounds < 2) {
    // Promoted WARN -> FAIL 2026-08-18, same trigger and reasoning as the gradient-count
    // promotion above: hand-validated against a real deployed build that shipped with 1.
    failures.push(
      `[depth] ${photoGrounds} photo-grounded section(s) — need 2+. A gathered work photo behind ` +
      'an 80-88% wash plus grain is what gives a page atmosphere; flat fills alone read flat.');
  }
}

/* 15. IDENTICAL SIBLING COMPONENTS — the cold-front-ac defect (2026-08-19 Fable design-elevation
 * review). Every other check here counts a per-page or per-site AGGREGATE (gradients, photo
 * grounds, section treatments) — none of them can see WITHIN-page monotony. cold-front-ac shipped
 * 5 review cards and 5 FAQ items each with a byte-identical class string and zero structural
 * variant, and every existing gate passed clean (richness's own aggregate counts were satisfied
 * elsewhere on the page). 4+ identical siblings with no dominant/featured one is the single most
 * recognisable AI-page tell there is — this is the deterministic half of that fix; the guidance
 * half (named alternatives per section type — featured quote, bento, ledger rows) lives in
 * build/SKILL.md's composition guidance.
 *
 * CALIBRATED against two real builds before shipping: first pass matched on any rounded/bg- class
 * and false-positived on every repeated nav link and mobile-menu item (36 hits across
 * the-woodlands-plumbing-and-air, none real) — tightened to require a real boundary (border or
 * shadow, not bare rounded/bg-). Also excluded <input>/<textarea>/<select>/<option>/<label> (a
 * form's fields SHOULD share a class — real false positive on a 4-field contact form). Final pass:
 * cold-front-ac correctly flags exactly its 2 known defects (5 review cards, 4 stat cards);
 * the-woodlands-plumbing-and-air (2026-08-16, the pipeline's own quality floor) correctly flags 2
 * real ones of its own (a 9-item service list, a 9-item blog list) — consistent with Jeff's own
 * read that even the floor build isn't clean on every axis. */
function tokenOverlap(a, b) {
  const setA = new Set(a);
  const inter = b.filter((t) => setA.has(t)).length;
  return inter / Math.max(a.length, b.length, 1);
}
const STRUCTURAL_VARIANT = /(col-span|row-span|order-|lg:col|md:col|scale-1|text-(2|3|4)xl|aspect-)/;
for (const f of pages) {
  const page = readFileSync(f, 'utf8');
  const counts = new Map();
  for (const m of page.matchAll(/<(\w+)[^>]*?class="([^"]{60,400})"/g)) {
    const tag = m[1];
    const cls = m[2];
    // <input>/<textarea>/<select> siblings sharing a class is correct UX (a form's fields SHOULD
    // look identical), not the AI-slop pattern — excluded after calibrating against a real build's
    // 4 identical contact-form inputs, a genuine false positive.
    if (/^(input|textarea|select|option|label)$/i.test(tag)) continue;
    // Component-scale only — must look like a card/panel with a real boundary (border or shadow;
    // NOT bare `rounded`/`bg-` alone, which nav links, pills and menu items also carry, and which
    // false-positived on every nav's repeated link classes when first calibrated against a real
    // build). Padding of p-3 or more is still required to exclude compact chips/badges.
    if (!/(border|shadow)/.test(cls) || !/p[xy]?-[3-9]/.test(cls)) continue;
    counts.set(cls, (counts.get(cls) || 0) + 1);
  }
  const keys = [...counts.keys()];
  for (const [cls, n] of counts) {
    if (n < 4) continue;
    const toks = cls.split(/\s+/);
    // A deliberate variant = a near-identical sibling class (>=70% shared tokens) that ALSO
    // carries a structural modifier (span/order/scale/larger-type/aspect) — i.e. one card is
    // genuinely different in shape, not just present at a different array index.
    const hasVariant = keys.some((o) => o !== cls
      && tokenOverlap(toks, o.split(/\s+/)) >= 0.7
      && STRUCTURAL_VARIANT.test(o));
    if (!hasVariant) {
      failures.push(
        `[repetition] ${n}x byte-identical component class on ${f.replace(outDir + '/', '')} with ` +
        `no structural variant sibling ("${cls.slice(0, 80)}${cls.length > 80 ? '…' : ''}"). 4+ ` +
        'identical cards with nothing dominant is the single most recognisable AI-page tell — make ' +
        'one card structurally different (span/photo/scale/open state) or use a non-card layout ' +
        'for this section (featured quote + supporting quotes, bento, full-width ledger rows).');
    }
  }
}

const result = { result: failures.length ? 'FAIL' : 'PASS', failures, warnings, facts };
if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`\nrichness-check: ${result.result}\n`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  for (const w of warnings) console.log(`  warn  ${w}`);
  console.log(`\n  facts: ${JSON.stringify(facts)}\n`);
}
process.exit(failures.length ? 1 : 0);
