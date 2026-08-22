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
import {
  parseDom, buildClassColorMaps, resolveGround, opacityModifier,
  luminance, chroma, perceptualDelta, parseColor, MARKETING_ROUTE,
} from './lib/design-dom.mjs';

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

/* Shared measurement context for the checks that need real STRUCTURE (siblings, ancestors) or real
 * PAINTED COLOUR rather than string matches. `buildClassColorMaps` reads the COMPILED css, so
 * `.bg-surface-2` resolves to whatever it actually paints — empirical, not inferred from the token
 * name. See scripts/lib/design-dom.mjs for why regex-over-HTML cannot answer these questions. */
const { bg: bgMap, vars: varMap } = buildClassColorMaps(css);
const marketingPages = pages.filter((f) => MARKETING_ROUTE.test(f.replace(outDir + '/', '')));
const rel = (f) => f.replace(outDir + '/', '');

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
} else if (declaresSecondary && usesSecondary < 10) {
  // Threshold raised 0 -> 10 on 2026-08-19: § Design (HARD RULES) row 9 has always said ">= 10
  // references", and this gate enforced ">0", so THREE references passed clean against a rule that
  // demanded ten. Both calibration builds clear 10 comfortably (measured: 51 and 19 usages in
  // marketing-page markup alone), so this closes real drift without touching a passing build.
  failures.push(
    `[palette] --secondary referenced only ${usesSecondary}x — § Design (HARD RULES) row 9 requires ` +
    '>= 10. Present-but-token is how a page keeps reading as one colour with a second one technically ' +
    'in the CSS. NOTE: the count is the easy half — see the [palette-weight] check below, which is ' +
    'the one that decides whether those references are actually VISIBLE.');
}

/* 1b. IS THE SECONDARY ACTUALLY VISIBLE? — perceptual weight, not occurrences (2026-08-19).
 *
 * The occurrence count above is satisfiable by paint nobody can see, and a real build proved it:
 * 51 secondary "usages" of which 32 were `bg-secondary-text/5` and `border-secondary-text/20` —
 * a 5%-alpha fill and a 20%-alpha hairline. The operator's report of the same failure elsewhere was
 * "used the secondary 19 times and it was invisible at distance". A counter cannot tell those apart
 * from real paint; that is not a threshold problem, it is a MEASUREMENT problem.
 *
 * So measure what the eye actually integrates, exactly as the operator specified —
 * AREA x ALPHA x CONTRAST-AGAINST-ITS-OWN-GROUND x CHROMA:
 *
 *   AREA     role weight from the shipped classes (a section fill is not a hairline border)
 *   ALPHA    the Tailwind opacity modifier AND any alpha baked into the compiled hex
 *   CONTRAST |ΔL| against the NEAREST ANCESTOR that paints a background — resolved per element,
 *            because the same olive is bold on cream and invisible on navy, and a site-wide
 *            average would call both the same
 *   CHROMA   OKLab chroma: under ~0.04 it is a grey wearing the secondary's name
 *
 * Two independent floors, because they catch different failures:
 *   presence  — the integral. Fails a page whose secondary is entirely hairlines and 5% washes.
 *   structural roles — at least one usage that is a real FILL or a large figure at real strength.
 *            This is § HARD-BLOCKER CONTRACT item 5's "no genuine second tone doing real
 *            structural work", stated as a number instead of an impression.
 *
 * Conservative by construction: an unresolvable ground scores the NEUTRAL 0.5, never 0, so a
 * markup shape this parser cannot read can never manufacture a failure.
 */
const SECONDARY_ROLE_AREA = {
  sectionFill: 1.00,  // a section/band background — the strongest statement available
  panelFill: 0.30,    // a padded card or panel
  smallFill: 0.10,    // chip, pill, rule, marker
  gradientStop: 0.40,
  displayText: 0.20,  // text-3xl and up — a stat figure or section numeral
  midText: 0.08,      // text-xl / 2xl
  bodyText: 0.03,
  border: 0.03,
  icon: 0.03,
  other: 0.02,
};
if (declaresSecondary) {
  const secChroma = Math.max(...uniqSecHexes.map((h) => chroma(h) ?? 0), 0);
  let presence = 0;
  let structuralRoles = 0;
  const roleTally = {};
  for (const f of marketingPages) {
    const page = readFileSync(f, 'utf8');
    const nodes = parseDom(page);
    for (const n of nodes) {
      const hits = [...n.cls.matchAll(
        /(?:^|\s)(?:[a-z0-9-]+:)*(bg|text|border|fill|stroke|ring|from|via|to|decoration|shadow)-(secondary[a-z-]*)((?:\/\[?[\d.]+\]?)?)(?=\s|$)/g)];
      if (!hits.length) continue;
      const ground = resolveGround(n, nodes, bgMap, varMap);
      for (const [, role, token, mod] of hits) {
        const hex = varMap.get(token) || varMap.get('secondary');
        if (!hex) continue;
        let alpha = opacityModifier(mod);
        const compiled = bgMap.get(`bg-${token}${mod}`);
        if (role === 'bg' && compiled) {
          const pc = parseColor(compiled);
          if (pc) alpha = Math.min(alpha, pc.a);
        }
        let area;
        if (role === 'bg') {
          const wholeBand = n.tag === 'section' || /\b(min-h-|py-1[0-9]|py-2[0-9]|py-3[0-9])/.test(n.cls);
          const panel = /\bp-[4-9]\b|\bp-1[0-9]\b|\bpy-[4-9]\b/.test(n.cls);
          area = wholeBand ? SECONDARY_ROLE_AREA.sectionFill
            : panel ? SECONDARY_ROLE_AREA.panelFill : SECONDARY_ROLE_AREA.smallFill;
        } else if (role === 'text') {
          area = /text-(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl)/.test(n.cls) ? SECONDARY_ROLE_AREA.displayText
            : /text-(?:xl|2xl)/.test(n.cls) ? SECONDARY_ROLE_AREA.midText : SECONDARY_ROLE_AREA.bodyText;
        } else if (role === 'from' || role === 'via' || role === 'to') area = SECONDARY_ROLE_AREA.gradientStop;
        else if (role === 'border') area = SECONDARY_ROLE_AREA.border;
        else if (role === 'fill' || role === 'stroke') area = SECONDARY_ROLE_AREA.icon;
        else area = SECONDARY_ROLE_AREA.other;

        const gl = ground === null ? null : luminance(ground);
        const sl = luminance(hex);
        // 0.55 ΔL is treated as "fully separated"; below that it scales down linearly.
        const visibility = (gl === null || sl === null) ? 0.5 : Math.min(1, Math.abs(gl - sl) / 0.55);
        const chromaFactor = Math.min(1, (chroma(hex) ?? 0) / 0.06);
        presence += area * alpha * visibility * chromaFactor;
        if (area >= 0.10 && alpha >= 0.5 && visibility >= 0.18) structuralRoles++;
        const k = `${role}-${token}${mod}`;
        roleTally[k] = (roleTally[k] || 0) + 1;
      }
    }
  }
  facts.secondaryChroma = Number(secChroma.toFixed(3));
  facts.secondaryPresence = Number(presence.toFixed(3));
  facts.secondaryStructuralRoles = structuralRoles;
  facts.secondaryRoles = roleTally;
  const SECONDARY_PRESENCE_FLOOR = 0.60;
  if (secChroma < 0.04) {
    failures.push(
      `[palette-weight] --secondary has OKLab chroma ${secChroma.toFixed(3)} — under 0.04 it is a ` +
      'GREY wearing the secondary\'s name, so every "second colour" reference on the page is really ' +
      'another neutral. Re-derive it with real chroma, or the page has one hue by construction.');
  } else if (structuralRoles === 0) {
    failures.push(
      '[palette-weight] the secondary is never once painted as a real FILL or a large figure at ' +
      'full strength — every shipped reference is a hairline border, a sub-10% wash, or body-sized ' +
      'text. That is § HARD-BLOCKER CONTRACT item 5 ("no genuine second tone doing real structural ' +
      'work") measured rather than eyeballed. Give it one section band, one panel fill, or one ' +
      `display figure. Roles shipped: ${JSON.stringify(roleTally)}`);
  } else if (presence < SECONDARY_PRESENCE_FLOOR) {
    failures.push(
      `[palette-weight] secondary perceptual presence ${presence.toFixed(2)} (floor ` +
      `${SECONDARY_PRESENCE_FLOOR}) = Σ(area x alpha x ΔL-vs-its-own-ground x chroma) across ` +
      'marketing routes. The references EXIST and still do not register — which is precisely the ' +
      'failure an occurrence count cannot see. Raise the alpha on the washes, widen the area, or ' +
      `move it onto a ground it actually separates from. Roles shipped: ${JSON.stringify(roleTally)}`);
  }
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
/* BAND, not a floor — and ONE number, not four (2026-08-19 drift audit). The repo held four
 * different grain thresholds: § Design (HARD RULES) row 6 said 0.12-0.20, the HARD-BLOCKER CONTRACT
 * said "~0.10 light / ~0.14 dark", this script failed only below 0.08, and this script's own error
 * text advised "~0.10-0.14, dark ~0.14-0.20". A rule with four numbers is not a rule. Adopting the
 * TABLE's 0.12-0.20 because it is the one stated as a hard rule with a threshold column, and adding
 * the missing upper bound: grain above ~0.20 stops reading as texture and starts reading as noise
 * or a rendering fault. Verified against both calibration builds before tightening — the rejected
 * build ships 0.15 and the accepted floor build ships 0.12/0.16, so every real build already sits
 * inside the band and this closes drift without failing anything that passes today. */
const GRAIN_MIN = 0.12, GRAIN_MAX = 0.20;
if (grainRule.length && opacities.length) {
  const lo = Math.min(...opacities), hi = Math.max(...opacities);
  if (hi < GRAIN_MIN) {
    failures.push(
      `[texture] grain overlay tops out at opacity ${hi} — under ${GRAIN_MIN} it is below the ` +
      'threshold at which a human perceives it, so it costs the same to render and buys nothing. ' +
      `§ Design (HARD RULES) row 6 requires ${GRAIN_MIN}-${GRAIN_MAX} (light surfaces toward the ` +
      'bottom of the band, dark toward the top).');
  } else if (lo > GRAIN_MAX) {
    failures.push(
      `[texture] grain overlay runs at opacity ${lo} — above ${GRAIN_MAX} it stops reading as ` +
      'texture and starts reading as noise or a broken render. The band is ' +
      `${GRAIN_MIN}-${GRAIN_MAX}.`);
  }
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
  /* THRESHOLD CORRECTED 2026-08-19 (drift audit). § Design (HARD RULES) row 7 has always required
   * ">= 4 distinct section treatments" and this gate failed at "< 3", gated behind a ">= 5 sections"
   * precondition that meant a 4-section page was never checked AT ALL. So the shipped rule was
   * "3 is fine, and 4 sections need nothing" against a table demanding 4. Both calibration builds
   * clear the real rule (rejected build: 4; accepted floor build: 6), so this is pure drift
   * closure — it fails nothing that passes today. The precondition drops to 3 sections, below which
   * "rhythm" is not yet a meaningful question. */
  if (secClasses.length >= 3 && treatments.size < 4) {
    failures.push(
      `[rhythm] ${secClasses.length} sections but only ${treatments.size} distinct background ` +
      'treatment(s) — § Design (HARD RULES) row 7 requires 4+. Alternating two neutrals is a ' +
      'stripe, not rhythm. Four means genuinely different grounds: light, alt-light, dark, and one ' +
      'image- or gradient-backed.');
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
   * § Design (HARD RULES) for the three valid values and why an attribute beats inferring intent
   * from Tailwind class soup. */
  /* ⚠️ REWRITTEN 2026-08-19 — this gate was failing builds on a requirement they were never taught.
   * `data-photo-treatment` appears NOWHERE in build/SKILL.md, the template, qa-reviewer.md or
   * qa-fix: the only two files in the repo that mention it are this script and
   * verify-consistency.mjs. Its remediation text still pointed at a deleted "Photo art direction"
   * section (removed 2026-08-19). Real builds emit the attribute only because they HIT this gate, read the
   * failure text, and complied — a gate that teaches by failing costs a QA round every single time.
   *
   * Fix: measure the DESIGN FACT (was this photo art-directed?) instead of the LABEL. The explicit
   * attribute is still honoured as the cleanest proof, but so is any of the treatments the skill
   * actually describes: a wash/scrim overlay on the photo's container, a bespoke treatment class
   * whose CSS carries a gradient/filter/blend, or a filter/blend utility on the image itself.
   * Both calibration builds pass on the attribute AND on the inferred evidence. */
  const imgCount = (h.match(/<img\b/g) || []).length;
  const explicitTreated = (h.match(/data-photo-treatment="(duotone|contained|scrim)"/g) || []).length;
  // Bespoke classes whose CSS rule paints a gradient, a filter, or a blend mode — the mechanics of
  // a duotone / scrim / graphic-containment treatment, whatever the build chose to name them.
  const treatmentClasses = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(linear|radial|conic)-gradient\(|mix-blend-mode|filter:\s*(?!none)|backdrop-filter/.test(m[2])) continue;
    for (const c of m[1].matchAll(/\.((?:[a-zA-Z0-9_-]|\\.)+)/g)) treatmentClasses.add(c[1].replace(/\\/g, ''));
  }
  const homeNodes = parseDom(h);
  let inferredTreated = 0;
  for (const n of homeNodes) {
    if (n.tag !== 'img') continue;
    if (/\b(grayscale|sepia|saturate-|contrast-|brightness-|mix-blend-|invert)\b/.test(n.cls)) { inferredTreated++; continue; }
    const container = n.ancestors.slice(-3).map((a) => homeNodes[a]);
    const treated = container.some((a) =>
      a.cls.split(/\s+/).some((t) => treatmentClasses.has(t))
      || /\b(aspect-\[|mask-|clip-path)/.test(a.cls));
    // a wash/scrim sibling: an absolutely-positioned overlay inside the same container
    const scrim = container.some((a) => a.children.some((cid) => {
      const c = homeNodes[cid];
      return c.tag !== 'img' && /\babsolute\b/.test(c.cls) && /\binset-0\b/.test(c.cls)
        && /(bg-|from-|to-|via-)/.test(c.cls);
    }));
    if (treated || scrim) inferredTreated++;
  }
  facts.images = imgCount;
  facts.treatedPhotos = explicitTreated;
  facts.inferredTreatedPhotos = inferredTreated;
  if (imgCount >= 2 && explicitTreated === 0 && inferredTreated === 0) {
    failures.push(
      `[photo] ${imgCount} photo(s) on the home page and NOT ONE is art-directed — no wash or scrim ` +
      'overlay, no duotone/filter/blend, no graphic containment, and no explicit ' +
      'data-photo-treatment attribute either. Every image ships as a bare rectangle, and scraped ' +
      'raw material presented as-is reads as pasted rather than designed. Treat the hero and at ' +
      'least one section-anchor photo: a directional scrim (an absolutely-positioned inset-0 ' +
      'gradient over the image), a duotone/blend, or real graphic containment (aspect + mask + ' +
      'radius). Any ONE of those satisfies this gate — the attribute is optional bookkeeping, not ' +
      'the requirement.');
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
const HERO_MAX_KB = 200, TOTAL_MAX_KB = 1600;
const fat = sized.filter((x) => x.kb > HERO_MAX_KB);
if (fat.length) {
  failures.push(
    `[weight] ${fat.length} image(s) over ${HERO_MAX_KB}KB — largest ${fat[0].kb}KB ` +
    `(${fat[0].f.split('/').pop()}). On a static export there is no next/image to rescue this; it ` +
    'goes out at full size and lands on LCP. Resize to the largest rendered dimension and emit ' +
    'WebP/AVIF at build time.');
}
if (facts.imageTotalKB > TOTAL_MAX_KB) {
  failures.push(
    `[weight] ${facts.imageTotalKB}KB of images total (cap ${TOTAL_MAX_KB}KB). ` +
    'Re-run optimise-images.mjs and drop unused ladder rungs. Mobile LCP is the product.');
}
const pubImages = join(siteDir, 'public', 'images');
if (existsSync(pubImages)) {
  const rasters = readdirSync(pubImages).filter((f) => /\.(jpe?g|png)$/i.test(f) && !/^og/i.test(f));
  facts.nonWebpInPublic = rasters;
  if (rasters.length) {
    failures.push(
      `[webp] public/images still has raster originals: ${rasters.join(', ')}. ` +
      'Ship WebP only (optimise-images.mjs). Keep sources in data/images/.');
  }
}

/* 6. EXPLICIT DIMENSIONS. Lighthouse flags "Image elements do not have explicit width and height";
 * without them the browser cannot reserve space, which costs CLS and delays LCP. */
const imgTags = (html.match(/<img\b[^>]*>/g) || []);
const undim = imgTags.filter((t) => !/\bwidth=/.test(t) || !/\bheight=/.test(t));
facts.imgTags = imgTags.length; facts.imgTagsMissingDims = undim.length;
/* PROMOTED warn -> FAIL 2026-08-19 (drift audit). § Design (HARD RULES) row 12 says "100%" and is
 * marked ✅ enforced; this was a `warnings.push`, which can never fail a build — so the row claimed
 * enforcement it did not have. Both calibration builds ship 0 undimensioned images, so the rule is
 * already met in practice and promoting it costs nothing real while closing the CLS hole the row
 * exists for. */
if (undim.length) {
  failures.push(
    `[cls] ${undim.length}/${imgTags.length} <img> without explicit width+height. Without them the ` +
    'browser cannot reserve space, so the page reflows as images land — that is CLS, and it is ' +
    'charged directly against the mobile Lighthouse score a business owner sees. § Design ' +
    '(HARD RULES) row 12 requires 100%.');
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
const lockPath = ['../data/design-lock.md', 'data/design-lock.md']
  .map((r) => join(siteDir, r)).find((f) => existsSync(f));
const dsLock = lockPath ? readFileSync(lockPath, 'utf8') : '';
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
    // Adopt-or-document: DESIGN_SYSTEM_DEVIATION / STYLE_ADOPTED count as documentation
    if (!/DESIGN_SYSTEM_DEVIATION|STYLE_ADOPTED|STYLE:\s*/i.test(status)) {
      dropped.push(`style "${styleName}" not referenced in status.md`);
    }
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
  const hasDesignIdea = /DESIGN_IDEA\s*=/.test(status) || /DESIGN_IDEA:/i.test(dsLock);
  const signatureMoveCount = [...status.matchAll(/Signature move \d+:/gi)].length;
  const hasLock = /SIGNATURE MOVE:/i.test(dsLock);
  facts.designIdea = { present: hasDesignIdea, signatureMoves: signatureMoveCount, lock: hasLock };
  if (!hasDesignIdea || (signatureMoveCount < 3 && !hasLock)) {
    failures.push(
      `[design] DESIGN_IDEA missing, and neither design-lock.md SIGNATURE MOVE nor 3 status.md moves ` +
      `(present=${hasDesignIdea}, signature moves=${signatureMoveCount}/3, lock=${hasLock}). ` +
      'Consult-once writes the lock; sync-design-lock.mjs stamps status.md. Absence is how a build ' +
      'passes every other gate and still reads arranged-not-authored.');
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
  // Count photo-ground sections that carry an absolute inset image somewhere in the
  // section body (not only within 400 chars of <section> — authors put overlays/wash
  // wrappers between). Stack-wide aquaklear fail: 3× photo-ground, regex saw 1.
  const sections = h.split(/(?=<section\b)/i).filter((s) => /^<section\b/i.test(s));
  let photoGrounds = 0;
  for (const sec of sections) {
    if (!/\bphoto-ground\b/.test(sec)) continue;
    if (/<(?:img|Image)\b[\s\S]{0,800}?\b(?:absolute|inset-0)\b|className="[^"]*\babsolute\b[^"]*\binset-0\b/.test(sec)) {
      photoGrounds += 1;
    } else if (/\bphoto-ground\b/.test(sec) && /<(?:img|Image)\b/.test(sec)) {
      photoGrounds += 1;
    }
  }
  // Fallback: className photo-ground count when section split misses fragments
  if (photoGrounds < 2) {
    const classHits = (h.match(/\bphoto-ground\b/g) || []).length;
    const absImgs = (h.match(/\babsolute\b[^>]*\binset-0\b|\binset-0\b[^>]*\babsolute\b/g) || []).length;
    if (classHits >= 2 && absImgs >= 2) photoGrounds = Math.min(classHits, absImgs);
  }
  facts.photoGroundedSections = photoGrounds;
  if (photoGrounds < 2) {
    // Promoted WARN -> FAIL 2026-08-18, same trigger and reasoning as the gradient-count
    // promotion above: hand-validated against a real deployed build that shipped with 1.
    failures.push(
      `[depth] ${photoGrounds} photo-grounded section(s) — need 2+. A gathered work photo behind ` +
      'an 80-88% wash plus grain is what gives a page atmosphere; flat fills alone read flat.');
  }

  /* 14b. $5k bar — service card kit ban (experiment/speed-cut). Three equal rounded-xl
   * image+copy cards is the local-service AI template. Editorial bands / rails pass. */
  const cardKit = (h.match(/rounded-xl[^"]*overflow-hidden[^"]*border[^"]*shadow/g) || []).length;
  facts.serviceCardKit = cardKit;
  if (cardKit >= 3) {
    failures.push(
      `[composition] ${cardKit} rounded-xl bordered shadow cards on home — the service card kit. ` +
      '§ Design lift ($5k): use editorial bands, split rails, or signature-driven lists instead.');
  }

  /* 14c. Lock canvas in hero — CANVAS: line names a gathered asset; it must appear in the hero. */
  const canvasLine = (lockPath && existsSync(lockPath)
    ? (readFileSync(lockPath, 'utf8').match(/^CANVAS:\s*(.+)$/mi) || [])[1]
    : '') || '';
  const canvasFile = (canvasLine.match(/([\w.-]+\.(?:jpe?g|webp|png|mp4))/i) || [])[1];
  facts.lockCanvasFile = canvasFile || null;
  if (canvasFile) {
    const heroSlice = h.slice(0, 8000);
    const stem = canvasFile.replace(/\.(jpe?g|webp|png)$/i, '');
    const inHero = heroSlice.includes(canvasFile) || heroSlice.includes(stem) ||
      heroSlice.includes('hero-home') || heroSlice.includes('/hero');
    // Prefer explicit lock asset; accept hero-home* when lock names hero-home.jpeg
    const ok = /hero-home/i.test(canvasFile)
      ? /hero-home|poster=.*hero-home/i.test(heroSlice)
      : (heroSlice.includes(canvasFile) || heroSlice.includes(stem));
    facts.lockCanvasInHero = ok;
    if (!ok) {
      failures.push(
        `[canvas] design-lock CANVAS names ${canvasFile} but home hero does not use it as LCP/poster. ` +
        'Lock canvas is the hero plane; before/after lives below the fold.');
    }
  }

  /* 14e. Signature architecture — ≥1 non-divider structural role on home.
   * Motif-only (gauge-needle as bullet/divider) is garnish; rail/index/mask/spine is architecture. */
  const archHits = {
    rail: (h.match(/\b(gauge-rail|signature-rail|motif-rail|spine-rail)\b/g) || []).length,
    index: (h.match(/\b(signature-index|motif-index|gauge-rail__mark)\b/g) || []).length,
    mask: (h.match(/\b(signature-mask|motif-mask|clip-path|mask-\[)\b/g) || []).length,
    spine: (h.match(/\b(signature-spine|section-spine|motif-spine)\b/g) || []).length,
  };
  const archRoles = Object.entries(archHits).filter(([, n]) => n > 0).map(([k]) => k);
  facts.signatureArchRoles = archRoles;
    if (archRoles.length < 1) {
      const motifOnly = (h.match(/\b(gauge-needle|gauge-divider|section-divider|motif-divider)\b/g) || []).length;
      if (motifOnly >= 2) {
        failures.push(
          `[signature] motif classes present (${motifOnly}) but zero architectural roles ` +
          `(rail|index|mask|spine). Divider-only is garnish — bind SIGNATURE MOVE as structure ` +
          '(e.g. gauge-rail, signature-index). See consult-once § Design lift.');
      } else {
        warnings.push(
          '[signature] no architectural signature role detected on home — lock SIGNATURE MOVE should ' +
          'name rail|index|mask|spine and appear in markup.');
      }
    }


  /* 14e2. GAUGE-RAIL MARK MISUSE — Lux 2026-08-22: authors put full work photos inside
   * .gauge-rail__mark (position:absolute icon slot). Images stacked and the rail line cut through them. */
  {
    const page = join(siteDir, 'src', 'app', 'page.tsx');
    const src = existsSync(page) ? readFileSync(page, 'utf8') : h;
    if (/gauge-rail__mark[\s\S]{0,400}<(?:img|Image)\b/.test(src)) {
      failures.push(
        '[layout] .gauge-rail__mark contains an <img> — that class is an absolute icon pin only ' +
        '(needle/mark). Photos belong in flow <article> grids beside copy. Measured Lux 2026-08-22: ' +
        'absolute stacking collapsed the service band into a colliding image tower.');
    }
  }

  /* 14e3. ADJACENT CLOSING CTAs — Lux 2026-08-22: photo-ground money CTA + band-go-mesh
   * "Schedule a visit" stacked with no content between = double closer. */
  {
    const page = join(siteDir, 'src', 'app', 'page.tsx');
    const src = existsSync(page) ? readFileSync(page, 'utf8') : h;
    const secs = src.split(/(?=<section\b)/i).filter((s) => /^<section\b/i.test(s));
    let adjacentClosers = 0;
    const isCloser = (s) =>
      /\b(photo-ground|band-go-mesh|band-depth-frost|band-depth-dark)\b/.test(s) &&
      /\bcta-primary\b/.test(s);
    for (let i = 0; i < secs.length - 1; i++) {
      if (isCloser(secs[i]) && isCloser(secs[i + 1])) adjacentClosers += 1;
    }
    facts.adjacentClosingCtas = adjacentClosers;
    if (adjacentClosers > 0) {
      failures.push(
        `[cta] ${adjacentClosers} pair(s) of adjacent closing CTA bands on home (photo-ground|band-go-mesh|band-depth ` +
        '+ cta-primary). One money closer only — fold service-area copy into that closer. Measured Lux 2026-08-22.');
    }
  }

  /* 14f. Hero copy column width — asymmetric split must leave the TYPE readable.
   * Bluegrass 2026-08-20: max-w-xl + md:pr-[42%] stacked the H1 on four lines with a dead right
   * third. Fail: hero H1 capped at max-w-xl/sm/md, OR right pad ≥40% without a matching wide max-w.
   * Scope is the H1 className only — a supporting max-w-xl on the subhead must not false-positive. */
  {
    const heroSrc = (() => {
      const page = join(siteDir, 'src', 'app', 'page.tsx');
      return existsSync(page) ? readFileSync(page, 'utf8') : '';
    })();
    const heroBlock = (heroSrc.match(/data-hero[\s\S]{0,2500}/) || [''])[0];
    const h1Class = ((heroBlock.match(/<h1\b[^>]*className="([^"]*)"/) || [])[1] || '');
    const narrowH1 = /\bmax-w-(?:xs|sm|md|xl)\b/.test(h1Class);
    const fatPad = /md:pr-\[(?:4[0-9]|[5-9]\d)%\]|lg:pr-\[(?:4[0-9]|[5-9]\d)%\]/.test(heroBlock);
    const wideCopy = /\bmax-w-(?:2xl|3xl|4xl|5xl|6xl|7xl)\b/.test(h1Class)
      || (/\bmax-w-(?:2xl|3xl|4xl|5xl|6xl|7xl)\b/.test(heroBlock) && !narrowH1);
    facts.heroCopyWide = !narrowH1 && (wideCopy || !fatPad);
    if (narrowH1 || (fatPad && !wideCopy)) {
      failures.push(
        '[hero-width] home hero copy column is too narrow (max-w-xl/sm/md on H1, or ≥40% right pad ' +
        'without max-w-2xl+). Split heroes need readable type — use max-w-2xl|3xl on the H1 and ' +
        'keep media pad around 24–32% (see consult-once / design stage).');
    }
  }
}

/* 14d. Favicon + social share card — scaffold Vercel favicon.ico is an AI-template tell;
 * missing og.jpg means iMessage/Slack/LinkedIn get no card. Scripts: generate-favicon.mjs,
 * generate-og-image.mjs. IndexNow still waits for /seo at conversion. */
{
  const appDir = join(siteDir, 'src', 'app');
  const staleIco = join(appDir, 'favicon.ico');
  const hasIcon =
    existsSync(join(appDir, 'icon.svg')) || existsSync(join(appDir, 'icon.png'));
  const ogJpg = join(siteDir, 'public', 'og.jpg');
  facts.hasAppIcon = hasIcon;
  facts.hasOgJpg = existsSync(ogJpg);
  facts.staleFaviconIco = existsSync(staleIco);
  if (existsSync(staleIco)) {
    failures.push(
      '[favicon] scaffold favicon.ico still in src/app/ — run generate-favicon.mjs ' +
        '(writes icon.svg/png and deletes the Vercel/Next default).');
  } else if (!hasIcon) {
    failures.push(
      '[favicon] no src/app/icon.svg or icon.png — tab icon falls back to host default. ' +
        'Run node scripts/generate-favicon.mjs <slug>.');
  }
  if (!existsSync(ogJpg)) {
    failures.push(
      '[og] public/og.jpg missing — no social share card. Run node scripts/generate-og-image.mjs <slug> ' +
        'and wire openGraph.images + twitter.card in layout.tsx.');
  } else {
    const layoutPath = join(appDir, 'layout.tsx');
    if (existsSync(layoutPath)) {
      const layout = readFileSync(layoutPath, 'utf8');
      if (!/og\.jpg/.test(layout) || !/openGraph/.test(layout)) {
        failures.push(
          '[og] public/og.jpg exists but layout.tsx does not reference it in openGraph.images.');
      }
      if (!/twitter:\s*\{/.test(layout) || !/summary_large_image/.test(layout)) {
        warnings.push(
          '[og] twitter.card summary_large_image not set in layout — LinkedIn/X previews may degrade.');
      }
    }
  }
}

/* 15. (REMOVED 2026-08-19) IDENTICAL SIBLING COMPONENTS — superseded by verify-design-intent.mjs's
 * [rhythm] check, which is strictly better: it counts VISUALLY-identical siblings inside ONE
 * container, where this counted byte-identical class strings anywhere on the page. That difference
 * matters — this version fired 2x on the-woodlands-plumbing-and-air, the build the operator treats
 * as the acceptable floor, because 9 elements shared a class without being siblings in one list.
 * A gate that fails the build you accept gets switched off, and then it protects nothing. [rhythm]
 * fires 2x on the rejected build and 0x on the floor build — the line lands exactly between them. */

/* 16. MONOTONE GROUND RUN — the deterministic kill for the mono-navy failure (2026-08-19).
 * A build shipped five section grounds within 0.05 OKLCH lightness of each other and every existing
 * gate passed: the secondary was used, gradients were counted, treatments were "distinct" by hex.
 * Distinct hexes are not distinct GROUNDS. Three consecutive sections a reader cannot tell apart is
 * a monotone page however many unique values the CSS contains. */
const surfHexes = [...all.matchAll(/--surface-([1-6])\s*:\s*(#[0-9a-fA-F]{6})/g)]
  .reduce((m, x) => (m[+x[1]] = x[2].toLowerCase(), m), {});
const lumOf = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const rungs = [1, 2, 3, 4, 5, 6].filter((i) => surfHexes[i]).map((i) => ({ i, L: lumOf(surfHexes[i]) }));
facts.surfaceLuminance = rungs.map((r) => ({ rung: r.i, L: Number(r.L.toFixed(3)) }));
if (rungs.length >= 3) {
  facts.lightRungs = rungs.filter((r) => r.L >= 0.75).length;
  for (let i = 0; i + 2 < rungs.length; i++) {
    const win = [rungs[i], rungs[i + 1], rungs[i + 2]];
    const spread = Math.max(...win.map((w) => w.L)) - Math.min(...win.map((w) => w.L));
    if (spread < 0.10) {
      failures.push(
        `[monotone] surface rungs ${win.map((w) => w.i).join('/')} sit within ${spread.toFixed(3)} ` +
        'luminance of each other — three consecutive grounds a reader cannot tell apart. That is a ' +
        'monotone page regardless of how many distinct hexes the CSS holds. Sections need real ' +
        'lightness separation, or a white/near-white base with the brand hue as panels.');
      break;
    }
  }
}

/* 17. SHADCN PRIMITIVES IGNORED (2026-08-19). The template vendors accordion/dialog/sheet/
 * dropdown-menu into every client, and build/SKILL.md says to use them for FAQ, mobile nav and the
 * services dropdown. A real build scaffolded all four, imported NONE, and hand-rolled a 211-line
 * SiteNav plus a native <details> FAQ instead -- and that hand-rolled nav shipped the Services item
 * as a <button>, so /services was unreachable from primary nav for keyboard and mobile users. The
 * instruction was prose; prose loses. This counts what actually shipped. */
const uiDir = join(siteDir, 'src', 'app', '_components', 'ui');
if (existsSync(uiDir)) {
  const available = readdirSync(uiDir).filter((f) => f.endsWith('.tsx')).map((f) => f.replace('.tsx', ''));
  const srcFiles = existsSync(join(siteDir, 'src')) ? walk(join(siteDir, 'src')).filter((f) => /\.tsx?$/.test(f)) : [];
  const srcText = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const imported = available.filter((c) => new RegExp(`_components/ui/${c}`).test(srcText));
  facts.shadcnAvailable = available.length;
  facts.shadcnImported = imported;
  const handRolledFaq = /<details/.test(srcText) && available.includes('accordion');
  const handRolledNav = /aria-expanded|useState\([^)]*\)[\s\S]{0,400}menu/i.test(srcText)
    && (available.includes('dropdown-menu') || available.includes('sheet'));
  if (imported.length === 0 && available.length > 0) {
    failures.push(
      `[primitives] ${available.length} shadcn primitives are vendored in _components/ui/ ` +
      `(${available.join(', ')}) and NOT ONE is imported anywhere in src/. The build hand-rolled ` +
      'its own interactive widgets instead — which is how a nav shipped with Services as a <button> ' +
      'and /services unreachable from primary nav. Use the primitives for FAQ (accordion), mobile ' +
      'nav (sheet) and the services dropdown (dropdown-menu), restyled onto the derived tokens.');
  } else if (available.length >= 4) {
    const CORE = ['accordion', 'dialog', 'sheet', 'dropdown-menu'];
    const missingCore = CORE.filter((c) => available.includes(c) && !imported.includes(c));
    if (missingCore.length) {
      failures.push(
        `[primitives] core shadcn incomplete — missing imports: ${missingCore.join(', ')}. ` +
        'Required every build: accordion (FaqAccordion), dialog (EstimateDialog), ' +
        'sheet (mobile nav), dropdown-menu (services). Extra mechanics (input/select/tabs/…) ' +
        'are available for forms; only the core four are mandatory imports.');
    }
  } else if (handRolledFaq) {
    warnings.push('[primitives] a native <details> FAQ shipped while accordion.tsx sits vendored and unused.');
  }
  if (handRolledNav && !imported.includes('dropdown-menu') && !imported.includes('sheet')) {
    warnings.push('[primitives] nav appears hand-rolled (useState/aria-expanded) while sheet/dropdown-menu are vendored.');
  }

  /* ContactForm must use mechanics pack — not native <input> kits. */
  const contactFormPath = join(siteDir, 'src', 'app', '_components', 'ContactForm.tsx');
  if (existsSync(contactFormPath)) {
    const cf = readFileSync(contactFormPath, 'utf8');
    const usesPack = /_components\/ui\/(input|label)/.test(cf);
    facts.contactFormUsesPack = usesPack;
    if (!usesPack) {
      failures.push(
        '[forms] ContactForm.tsx does not import ui/input or ui/label — keep the template form ' +
        'and the mechanics pack. Hand-rolled natives reintroduce the a11y/token drift the pack exists to stop.');
    }
  }
}

/* 17b. Remotion hero clip — required when usable photos exist (operator 2026-08-20).
 * Poster-only is only OK when status.md records HERO_VIDEO=FAIL (legitimate degradation). */
{
  const statusPath = join(siteDir, '..', 'data', 'status.md');
  const statusTxt = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : '';
  const heroFail = /^HERO_VIDEO=FAIL/m.test(statusTxt);
  const mp4 = join(siteDir, 'public', 'hero.mp4');
  const pageTsx = join(siteDir, 'src', 'app', 'page.tsx');
  const pageTxt = existsSync(pageTsx) ? readFileSync(pageTsx, 'utf8') : '';
  const hasMp4 = existsSync(mp4) && statSync(mp4).size > 10_000;
  const wiresSrc = /HeroVideo[\s\S]{0,400}\bsrc=/.test(pageTxt);
  const imgDir = join(siteDir, 'public', 'images');
  const photoCount = existsSync(imgDir)
    ? readdirSync(imgDir).filter((f) => /\.(webp|jpe?g|png)$/i.test(f) && !/logo/i.test(f)).length
    : 0;
  facts.heroMp4 = hasMp4;
  facts.heroVideoSrcWired = wiresSrc;
  if (!heroFail && photoCount >= 3 && !hasMp4) {
    failures.push(
      `[hero-video] ${photoCount} public photos but no public/hero.mp4 — Remotion is required. ` +
      'Run services/hero-video/render.mjs in copy-template (preflight). Poster-only only with HERO_VIDEO=FAIL.');
  }
  if (hasMp4 && /HeroVideo/.test(pageTxt) && !wiresSrc) {
    failures.push(
      '[hero-video] public/hero.mp4 exists but <HeroVideo> has no src= — wire src="/hero.mp4" (poster alone is not enough).');
  }
}

/* 17c. Home ATMOSPHERE recipe — template lift must bind on / (ATMOSPHERE.md rows 1 + 6). */
{
  const homeTsx = join(siteDir, 'src', 'app', 'page.tsx');
  if (existsSync(homeTsx)) {
    const home = readFileSync(homeTsx, 'utf8');
    const hasSplitOverlay = /hero-overlay--split/.test(home);
    const hasEarnedPlate =
      /band-go-mesh|band-depth-frost|band-depth-dark|band-copper-plate|bg-secondary-fill/.test(home);
    if (!hasSplitOverlay) {
      failures.push(
        '[atmosphere-home] page.tsx hero missing hero-overlay--split — use template overlay, not flat wash.');
    }
    if (!hasEarnedPlate) {
      failures.push(
        '[atmosphere-home] page.tsx missing earned plate (band-go-mesh, band-depth-frost, or secondary-fill band).');
    }

  }
}

/* 17d. NAV CLEARANCE — fixed dual-bar SiteNav overlays the viewport.
 * Text-led routes need main { padding-top: var(--site-nav-clearance) } with data-hero / data-under-nav opt-out.
 * Measured Lux 2026-08-22: blog H1 sat under the black nav. */
if (!/--site-nav-clearance\s*:/.test(css)) {
  failures.push(
    '[layout] compiled CSS missing --site-nav-clearance — fixed SiteNav (utility + main bar) will collide ' +
    'with H1s on blog/legal/text-led pages. Add the main padding rule from templates/trade-site globals.css.');
}

/* 17e. THIN SERVICE PAGES — Lux 2026-08-22: /services/<slug> shipped hero + NAP only.
 * Prefer built out/ HTML (what ships). Fall back to page.tsx, but do NOT strip
 * self-closing JSX like <ServiceDetailFrame body="…" /> as one tag — that ate the
 * entire copy when authors used the frame (props are the prose). */
{
  const servicesDir = join(siteDir, 'src', 'app', 'services');
  const outServices = join(siteDir, 'out', 'services');
  const thin = [];
  if (existsSync(servicesDir)) {
    for (const ent of readdirSync(servicesDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const built = join(outServices, ent.name + '.html');
      const sp = join(servicesDir, ent.name, 'page.tsx');
      let words = 0;
      let h2 = 0;
      if (existsSync(built)) {
        const html = readFileSync(built, 'utf8');
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ');
        words = text.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;
        h2 = (html.match(/<h2\b/gi) || []).length;
      } else if (existsSync(sp)) {
        const src = readFileSync(sp, 'utf8');
        // Pull string props used by ServiceDetailFrame / similar frames.
        const propBlob = [...src.matchAll(
          /\b(?:body|expect|short|title|proofLine)\s*=\s*(?:\{`([\s\S]*?)`\}|"([^"]*)"|'([^']*)')/g,
        )].map((m) => m[1] || m[2] || m[3] || '').join(' ');
        const text = (propBlob + ' ' + src)
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
          .replace(/<[A-Za-z][\s\S]*?\/>/g, ' ') // self-closing JSX (attrs already extracted)
          .replace(/<[^>]+>/g, ' ')
          .replace(/[`'"]/g, ' ');
        words = text.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;
        h2 = (src.match(/<h2\b/g) || []).length
          + (/\bServiceDetailFrame\b/.test(src) ? 1 : 0); // frame ships one body h2
      } else {
        continue;
      }
      if (words < 220 || h2 < 2) {
        thin.push(`${ent.name}(words=${words},h2=${h2})`);
      }
    }
  }
  facts.thinServicePages = thin;
  if (thin.length) {
    failures.push(
      `[copy] thin service page(s): ${thin.join(', ')} — need ≥220 prose words and ≥2 <h2>s ` +
      '(not hero + locations only). Measured Lux 2026-08-22.');
  }
}

/* 18. PER-ROUTE DESIGN BINDING — the check § Step 1d already CLAIMED existed (2026-08-19).
 *
 * build/SKILL.md's "The design idea binds on EVERY route" said, in prose: "richness-check.mjs counts
 * these per page, not per site." It did not. Every richness measurement above is either site-wide
 * (gradients counted over concatenated CSS) or home-page-only (`if (home)`), so a build could put
 * the entire design idea on `/` and ship every other route bare — which is exactly what QA found on
 * 2026-08-19: DESIGN_IDEA "Weather Authority" and its thermocline gradient present on `/`,
 * ENTIRELY ABSENT from /about and /contact.
 *
 * Measured here per route. The rule as written: every marketing route carries at least one gradient
 * or photo-ground.
 *
 * ⚠️ THE HARD PART IS RESOLVING WHAT COUNTS AS A GRADIENT ON A PAGE, and getting it wrong in either
 * direction is fatal. A page can carry a gradient three ways: an inline style, a Tailwind
 * `bg-gradient-to-*` utility, or — the one a naive check misses completely — a BESPOKE CLASS whose
 * rule in globals.css paints the gradient (`.thermocline`, `.glow`, `.photo-ground::after`). Counting
 * only inline gradient functions reports ZERO gradients on a page that visibly has one. So the CSS
 * is parsed for every selector whose body contains a gradient, and the resulting class names are
 * matched against each page's markup.
 *
 * CALIBRATION (this is what the resolution buys): with class resolution, the accepted floor build
 * scores 8/8 routes bound — every route carries `.glow` — so it does not fire once. WITHOUT the
 * resolution it would have reported 7 of its 8 routes bare, which is a gate that gets switched off
 * in a day. The rejected build scores 11 bare routes out of 19 on the same measurement.
 */
const gradientClasses = new Set();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/(linear|radial|conic)-gradient\(/.test(m[2])) continue;
  for (const c of m[1].matchAll(/\.((?:[a-zA-Z0-9_-]|\\.)+)/g)) gradientClasses.add(c[1].replace(/\\/g, ''));
}
const bareRoutes = [];
const routeBinding = {};
for (const f of marketingPages) {
  const page = readFileSync(f, 'utf8');
  let evidence = 0;
  if (/(linear|radial|conic)-gradient\(/.test(page)) evidence++;
  if (/\bbg-gradient-to-[trbl]{1,2}\b/.test(page)) evidence++;
  for (const m of page.matchAll(/class="([^"]*)"/g)) {
    if (m[1].split(/\s+/).some((t) => gradientClasses.has(t))) { evidence++; break; }
  }
  const photoGround = (page.match(/<section[^>]*>[\s\S]{0,600}?<img[^>]*absolute[^>]*inset-0/g) || []).length;
  routeBinding[rel(f)] = evidence + photoGround;
  if (evidence === 0 && photoGround === 0) bareRoutes.push(rel(f));
}
facts.routesChecked = marketingPages.length;
facts.routesUnbound = bareRoutes.length;
if (bareRoutes.length) {
  failures.push(
    `[binding] ${bareRoutes.length}/${marketingPages.length} marketing route(s) carry NO gradient ` +
    'and NO photo-ground — not one expression of the design idea anywhere on the page: ' +
    `${bareRoutes.slice(0, 6).join(', ')}${bareRoutes.length > 6 ? `, +${bareRoutes.length - 6} more` : ''}. ` +
    'A concept that stops at the home page is not a design system, it is a home-page treatment, and ' +
    'every other route then reads as the generic filler this pipeline exists to avoid. § Step 1d: ' +
    'before writing each route, state which signature move appears on it and on which section. ' +
    'Cheapest real fix: the same bespoke class the home page already uses (a section wash, a ' +
    'photo-ground band) applied to one section per route — not a new invention per page.');
}

/* 19. SIGNATURE MOTIF — REPEATED, or it is not a motif (2026-08-19).
 *
 * § Design (HARD RULES) row 4: "Signature motif — the one named in DESIGN_IDEA — >= 3 appearances
 * in built HTML." Never enforced, and the operator's exact complaint about the rejected build was
 * "use a signature motif -> satisfied by one faint divider line". Measured on that build: its
 * design-system.md names "Signature motif: isotherm contour lines", the build duly authored an
 * `.isotherm-line` class, and shipped it EXACTLY ONCE across 19 pages. Its other bespoke device,
 * `.thermocline`, shipped twice. Both were recorded as done.
 *
 * A motif is by definition a device the eye meets more than once — that is the entire difference
 * between a motif and a decoration. So: count the bespoke, hand-authored classes (everything in the
 * client's own globals.css that is NOT one of the pipeline's standard-issue devices, which have
 * their own gates already) and require at least one of them to appear >= 3 times.
 *
 * CALIBRATION: rejected build's best bespoke device = 2 appearances -> FAILS. Accepted floor build:
 * `.icon-chip` x24 and `.glow` x14 -> PASSES with an order of magnitude in hand. The separation is
 * not marginal, which is what a threshold wants.
 */
const globalsPath = join(siteDir, 'src', 'app', 'globals.css');
const STANDARD_DEVICES = new Set(['grain', 'grain-dark', 'grain-light', 'photo-ground',
  'photo-ground-light', 'photo-ground-dark', 'photo-duotone', 'sr-only', 'container', 'prose']);
if (existsSync(globalsPath)) {
  const globalsCss = readFileSync(globalsPath, 'utf8');
  const declared = new Set([...globalsCss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]{2,40})/g)].map((m) => m[1]));
  const motifCounts = new Map();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) {
      if (declared.has(t) && !STANDARD_DEVICES.has(t)) motifCounts.set(t, (motifCounts.get(t) || 0) + 1);
    }
  }
  const ranked = [...motifCounts.entries()].sort((a, b) => b[1] - a[1]);
  facts.bespokeMotifs = Object.fromEntries(ranked);
  const best = ranked[0]?.[1] || 0;
  if (best < 3) {
    failures.push(
      `[motif] no bespoke visual device appears 3+ times — best is ${best} ` +
      `(${ranked.length ? ranked.map(([k, v]) => `${k}=${v}`).join(', ') : 'the client globals.css declares NONE'}). ` +
      '§ Design (HARD RULES) row 4 requires >= 3 appearances of the motif named in DESIGN_IDEA. A ' +
      'device the eye meets once is a decoration; a device it meets three times is what makes a ' +
      'site feel authored. This is the measured form of the operator\'s "use a signature motif -> ' +
      'satisfied by one faint divider line" — a real build shipped its named isotherm motif exactly ' +
      'ONCE across 19 pages and recorded the move as done. Take the device already authored in ' +
      'globals.css and deploy it on section dividers, card corners, the footer edge and the hero.');
  }
}

/* 20. CANVAS MODE / GROUND — the ONE ground rule that is arithmetic rather than taste (2026-08-19).
 *
 * § Canvas mode states the invariant plainly: "on every light mode the page-base token sits at
 * L >= 0.93", and § Step 3 states what `saturated` means just as plainly: "a white page body with
 * the brand hue as full-chroma PANELS. It is NOT a page-wide ground." Neither was enforced, and the
 * rejected build violated the second one at the root of everything else that was wrong with it: it
 * recorded GROUND=saturated and then derived `--surface: #223d81` — the brand navy AS the page
 * base, L = 0.053. Every downstream symptom (five navy rungs, grey-on-navy cards, the mono-tone
 * page the operator rejected on sight) follows from that single decision.
 *
 * The existing [monotone] check catches the SYMPTOM (rungs too close together). This catches the
 * CAUSE, and names it, which is the difference between "your sections look samey" and "you built a
 * saturated ground when saturated means panels".
 *
 * Reads the ground the build RECORDED in status.md, so it compares intent against artifact. If no
 * ground was recorded there is nothing to check and it stays silent rather than guessing.
 */
const statusForGround = statusPath ? readFileSync(statusPath, 'utf8') : '';
const groundDecl = (statusForGround.match(/^\s*(?:-\s*)?(?:GROUND|Ground)\s*[:=]\s*([a-z-]+)/mi) || [])[1];
const canvasMode = (statusForGround.match(/CANVAS_MODE\s*[:=]\s*([A-Za-z-]+)/) || [])[1];
const pageBase = varMap.get('surface') || varMap.get('surface-1')
  || (css.match(/(?:^|\})\s*(?:html|body)[^{}]*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
const pageBaseL = pageBase ? luminance(pageBase) : null;
facts.groundRecorded = groundDecl || null;
facts.canvasMode = canvasMode || null;
facts.pageBase = pageBase || null;
facts.pageBaseLuminance = pageBaseL === null ? null : Number(pageBaseL.toFixed(3));
if (groundDecl && pageBaseL !== null) {
  const LIGHT_BASE_MIN = 0.93;
  if (groundDecl === 'saturated' && pageBaseL < LIGHT_BASE_MIN) {
    failures.push(
      `[canvas] GROUND=saturated but the page base --surface is ${pageBase} (L ${pageBaseL.toFixed(3)}). ` +
      '§ Step 3 defines `saturated` as SATURATED-PANEL: "a white page body with the brand hue as ' +
      'full-chroma PANELS. It is NOT a page-wide ground." Painting the brand hue as the base is the ' +
      'single decision that produces a mono-tone page — every section then sits on the same hue and ' +
      'no amount of gradient, grain or secondary can undo it. The bar (§ The bar) is explicit that ' +
      'the reference site is a WHITE body with indigo panels and that the drama is the ALTERNATION. ' +
      `Re-derive with a base at L >= ${LIGHT_BASE_MIN} and put the hue on 1-2 sections.`);
  } else if (/^(light|cream|saturated)$/.test(groundDecl) && pageBaseL < LIGHT_BASE_MIN) {
    failures.push(
      `[canvas] GROUND=${groundDecl} is a LIGHT mode, but the page base --surface is ${pageBase} ` +
      `(L ${pageBaseL.toFixed(3)}). § Canvas mode's invariant: "on every light mode the page-base ` +
      `token sits at L >= ${LIGHT_BASE_MIN}". Either the recorded ground is wrong or the derived ` +
      'base is; they cannot both stand.');
  }
}

/* 21. STOCK shadcn STYLING (2026-08-19). § Step 1c is unambiguous — "NEVER ship shadcn's default
 * styling ... it is what v0, Lovable and every AI app-builder emits". The [primitives] check above
 * pushes builds to USE the vendored primitives; without this one, complying with that produces
 * stock new-york/slate components, which is a worse failure than hand-rolling. Only unambiguous
 * shadcn-only tokens are matched: this pipeline has its own `accent` and `secondary` tokens, so
 * `bg-accent` is NOT evidence and is deliberately excluded. Fires only on a primitive that is
 * actually imported, so an unused vendored file cannot fail a build. */
if (existsSync(uiDir)) {
  const SHADCN_DEFAULT = /\b(?:bg|text|border|ring|from|to)-(?:background|foreground|muted|muted-foreground|popover|popover-foreground|card-foreground|primary|primary-foreground|destructive|destructive-foreground|input)\b/g;
  const stock = [];
  for (const file of readdirSync(uiDir).filter((f) => f.endsWith('.tsx'))) {
    const name = file.replace('.tsx', '');
    if (!facts.shadcnImported?.includes(name)) continue;
    const hits = (readFileSync(join(uiDir, file), 'utf8').match(SHADCN_DEFAULT) || []);
    if (hits.length >= 3) stock.push(`${name} (${hits.length} default tokens)`);
  }
  facts.shadcnStockStyled = stock;
  if (stock.length) {
    failures.push(
      `[primitives] ${stock.join(', ')} still carry shadcn's DEFAULT token classes. § Step 1c: ` +
      '"NEVER ship shadcn\'s default styling" — new-york + slate is the single most recognisable ' +
      'look on the web and reads as "an AI made this" on sight, which is the exact failure using ' +
      'the primitives was meant to avoid. Replace the default classes with this client\'s derived ' +
      'tokens (bg-surface-*, text-on-dark, border-accent-*, the real radius and shadow scale). ' +
      'shadcn supplies BEHAVIOUR only.');
  }
}

/* 22. GRADIENT QUALITY — facts, deliberately NOT a hard threshold (2026-08-19).
 *
 * § Design (HARD RULES) row 5 reads ">= 4 gradients, EACH >= 15% perceptual delta between stops".
 * The count half is enforced above. The "each >= 15%" half is measured here and reported, and it is
 * NOT a failure condition — that is a calibration finding, not laziness, and it is worth stating
 * because it is a real hole:
 *
 *   - The >= 4 count runs over CSS **and** HTML concatenated, so one inline gradient repeated across
 *     4 pages counts 4 times. Measured: the accepted floor build has just TWO distinct gradient
 *     recipes and scores 6 against the >= 4 floor purely on duplicate occurrences.
 *   - Applying "each >= 15%" literally therefore fails the build the operator calls the floor, and
 *     also condemns the deliberately-uniform photo wash that § Design rules explicitly REQUIRES
 *     ("apply a uniform dark wash across the WHOLE image, not an edge-only gradient").
 *
 * So the numbers ship as facts a reviewer can act on, and `distinctGradientRecipes` makes the
 * duplicate-counting visible instead of silently inflating the floor.
 */
{
  const recipes = new Set();
  for (const m of all.matchAll(/(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/g)) recipes.add(m[0]);
  let perceptible = 0; const flat = [];
  for (const g of recipes) {
    if (/var\(--tw-gradient-stops\)/.test(g)) continue; // stops live on the element, not the rule
    const stops = [...g.matchAll(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|\btransparent\b|var\(--([a-z0-9-]+)\))/g)]
      .map((m) => (m[0] === 'transparent' ? '#00000000' : (m[2] ? varMap.get(m[2]) : m[0]))).filter(Boolean);
    let max = 0, comparable = false;
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const d = perceptualDelta(stops[i], stops[j]);
        if (d !== null) { comparable = true; max = Math.max(max, d); }
      }
    }
    if (!comparable) continue;
    if (max >= 0.15) perceptible++; else flat.push(`${max.toFixed(3)} ${g.slice(0, 48)}…`);
  }
  facts.distinctGradientRecipes = recipes.size;
  facts.perceptibleGradients = perceptible;
  if (flat.length) {
    warnings.push(
      `[depth] ${flat.length} gradient(s) have under 15% perceptual delta between stops and paint ` +
      `as flat fills: ${flat.slice(0, 3).join(' | ')}. They still count toward the >= 4 floor, which ` +
      'is how a page reaches "4 gradients" with nothing visibly graduated. A deliberate uniform ' +
      'photo wash is legitimate here; a decorative section gradient at this delta is not.');
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
