#!/usr/bin/env node
/**
 * derive-palette.mjs <accent-hex> [--harmony <type>] [--character deep|vivid|muted|pale|dark]
 *                     [--ground light|cream|deep|dark] [--ground-hue '#hex'|<degrees>]
 *                     [--light '#hex,#hex'] [--dark '#hex,#hex'] [--json]
 *
 * ==================== GROUND FAMILY + GROUND HUE (added 2026-08-16) ====================
 *
 * WHY THIS EXISTS. Measured across two shipped clients (a plumber, a demolition contractor): the
 * neutral ladder was IDENTICAL to three decimals — surface-1 L 0.990/0.990, surface-6 L 0.219/0.219
 * — because the ladder's tint hue was hard-wired to the ACCENT hue and its lightness distribution
 * was a constant. Only the accent's hue rotated; every site was structurally the same white page
 * with a dark footer. The operator's own diagnosis: "we can't just drive down the middle... it
 * needs to analyze the company's colors for more than just their logo."
 *
 * Two independent decisions were previously fused into one (the accent) and now are not:
 *
 *   --ground-hue   WHICH hue tints the neutral ladder. Defaults to the accent hue (unchanged
 *                  behaviour when omitted). Pass a real second brand colour instead — the client's
 *                  own site background, a colour off their vehicle/signage/uniforms — and the
 *                  ladder tints toward THAT, not the accent. This is what breaks the "always
 *                  brown" effect: a warm gold accent no longer forces a warm cream/brown ground if
 *                  real evidence points the ladder somewhere else. Accepts a hex (its OKLCH hue is
 *                  extracted) or a bare number in degrees.
 *
 *   --ground       WHICH lightness family the ladder uses: light (the original, unchanged),
 *                  cream (compressed light end, higher chroma — a warm editorial page, chosen
 *                  DELIBERATELY rather than arrived at by accident), deep (mid-dark dominant ground
 *                  with light relief bands), dark (near-black dominant ground, more range than
 *                  deep). Defaults to `light` — a build must choose to leave the light family, this
 *                  script never silently changes what an existing caller gets.
 *
 * WHICH ground family and ground hue suit a given client is a BUILD-TIME judgement (evidence first:
 * their real site, their logo's full colour set, a vision pass over gathered photos; seeded and
 * trade-masked when evidence is thin) — this script only executes the named choice, deterministically,
 * exactly as it already does for --harmony. Do not hardcode a trade -> family mapping in here.
 *
 * CONTRAST VERIFICATION NOW COVERS THE WHOLE LADDER, not just the legacy 3-tone surface set. This
 * closes a real gap that predates this change: --ink and --accent-text were being solved against
 * only `surface`/`surface-alt` and verified against only those two, while a build actually paints
 * text on surface-3 and surface-4 too — rungs that were NEVER checked and, being darker than
 * surface-alt, could in principle have failed silently. Every rung in the chosen family is now
 * classified light (L>0.5) or dark (L<=0.5) and folded into the same worst-case verification every
 * other role already goes through. This can only make the gate STRICTER than before, never looser.
 *
 * DERIVES a complete WCAG-compliant colour system from ONE brand hue. This is
 * the "automatic adjustment" half of the contrast system: instead of picking a
 * brand accent and then checking it (which every site failed — a mid-tone
 * saturated accent essentially never clears 4.5:1 against white in either
 * direction; that is arithmetic, not taste), the build derives the values it
 * is allowed to use for each JOB the accent has, and each value is compliant
 * BY CONSTRUCTION.
 *
 * Brand identity lives in HUE, not lightness. So every derived role keeps its
 * hue exactly and moves only lightness (and chroma, only as far as the sRGB
 * gamut forces at that lightness). The math runs in OKLCH, where "same hue,
 * different lightness" is a single-axis move that stays perceptually the same
 * colour — HSL distorts perceived lightness across hues, which is why "darken
 * the HSL L" produces muddy off-brand results and this doesn't.
 *
 * ============================ FOUR TOKEN GROUPS ============================
 *
 * 1. ACCENT (the original seven — unchanged guarantees):
 *   --accent            brand value untouched. DECORATIVE ONLY: borders,
 *                       icon strokes, glows, plates, rules, focus rings.
 *   --accent-text       accent TEXT on light surfaces, >= 4.5:1 vs the worst.
 *   --accent-text-dark  accent TEXT on dark surfaces.
 *   --accent-fill / --on-accent-fill        deep fill pair (CTAs, chat, badges).
 *   --accent-fill-bright / --on-accent-bright  bright fill pair. NEVER white
 *                       text on the bright fill. Pairs never mix.
 *
 * 2. SECONDARY (hue-wheel harmony — makes the scheme DESIGNED, not templated):
 *   A second hue chosen by a named harmony relationship to the brand hue:
 *     analogous       ±30°, auto-picking the rotation farther from the error
 *                     anchor (27°) so the support colour can't read as a red flag
 *     analogous-warm  the ±30° rotation nearer the warm pole (~70°)
 *     analogous-cool  the ±30° rotation nearer the cool pole (~250°)
 *     complementary   +180° — maximum hue tension, for bold/energetic trades
 *     split           ±150°, picking the option farther from the error anchor —
 *                     complementary's contrast without its vibration
 *     triadic         ±120°, same tie-break — for playful multi-colour designs
 *     none            no secondary emitted (single-hue design, deliberate only)
 *   WHICH harmony suits WHICH trade is the build skill's decision (see
 *   build/SKILL.md § Colour roles — the industry table); this script only
 *   executes the named relationship, deterministically.
 *   Secondary chroma is capped at min(brandC × 0.85, 0.13): a support colour
 *   at full brand chroma competes instead of supporting — two sirens, no song.
 *   Tokens: --secondary (decorative), --secondary-text (>=4.5 on light),
 *   --secondary-fill / --on-secondary-fill (deep pair, >=4.5 internally).
 *
 * 3. NEUTRALS (brand-tinted, not stock grey):
 *   Surfaces are DERIVED from the brand hue at very low chroma unless
 *   explicitly overridden with --light/--dark. A warm gold brand on a cold
 *   grey-white is one of the clearest generated-vs-designed tells; a neutral
 *   tinted a few degrees toward the brand hue reads as deliberate.
 *   CHROMA CEILINGS (the load-bearing numbers, stated so they're auditable):
 *     light surfaces  C = 0.006 (page, L 0.988) / 0.010 (alt, L 0.956).
 *       Below ~0.004 sRGB quantisation at L≈0.99 rounds the tint to the same
 *       hex as pure grey — paying for a tint nobody receives. Above ~0.015 at
 *       L>=0.95 the surface reads as a COLOUR (a "stained page"), not paper
 *       with temperature. 0.006–0.010 is the deliberate-but-subliminal band.
 *     dark surface    C = 0.014 (L 0.245). Dark values hide chroma — the same
 *       C reads weaker at low L — so the dark surface carries ~2x the page's
 *       chroma to feel like the same temperature, still far below colour-cast
 *       territory (~0.03 at that L).
 *   Tokens: --surface --surface-alt --surface-dark --ink --ink-muted
 *           --on-dark --on-dark-muted. The muted pair is SOLVED (>=4.5 vs its
 *           real surfaces), which retires freehand 4.4:1 grey forever.
 *
 * 4. SEMANTICS (success / warning / error / info):
 *   Fixed convention anchors — error 27°, success 152°, warning 78°, info 245°
 *   (OKLCH hue). Convention is non-negotiable: a teal "error" to dodge a red
 *   brand would be a worse failure than the collision, because users read
 *   state by colour convention before they read the words.
 *   BRAND-COLLISION RULE (the defensible answer for a red-branded business):
 *   if the brand hue sits within 20° of a semantic anchor, the semantic KEEPS
 *   its anchor hue and separates by LIGHTNESS and FORM instead —
 *     (a) its text token solves to a stricter 6.0:1 (vs the usual 4.6), so it
 *         is measurably, visibly darker than --accent-text (4.6-target) in
 *         every composition; and
 *     (b) the collision is reported in the output, and the build skill's rule
 *         fires: colliding semantics NEVER appear as bare coloured text — they
 *         always ship inside the semantic pattern (icon + --X-surface tint +
 *         border), a form the brand accent is barred from using. Colour is
 *         never the only indicator anyway (WCAG 1.4.1); on a collision that
 *         rule stops being belt-and-braces and starts being the answer.
 *   Tokens per semantic X: --X (icon/border strength, >=3:1 on light — the
 *   WCAG non-text threshold), --X-text (>=4.5, or >=6.0 on collision, vs the
 *   worst of the light surfaces AND its own tint), --X-text-dark (>=4.5 vs
 *   the dark surface), --X-surface (the pale banner tint, L 0.955 C 0.035).
 *
 * Targets 4.6:1 (margin over 4.5 so antialiasing/rounding can't tip a pass
 * into a marginal fail; 3.05 over 3.0 for icon strength; 6.0 on semantic
 * collision) and verifies EVERY emitted pair before printing; if any pair
 * misses it exits 1 rather than printing a palette that would fail downstream.
 *
 * No dependencies. Pure math. Deterministic.
 */

// ---------- sRGB <-> OKLab / OKLCH ----------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const hexToRgb = (hex) => {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function rgbToOklab([r8, g8, b8]) {
  const r = s2l(r8 / 255), g = s2l(g8 / 255), b = s2l(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}
function oklabToLinear({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (lin) => lin.every((c) => c >= -1e-6 && c <= 1 + 1e-6);
const lchToLab = ({ L, C, h }) => ({ L, a: C * Math.cos(h), b: C * Math.sin(h) });
const labToLch = ({ L, a, b }) => ({ L, C: Math.hypot(a, b), h: Math.atan2(b, a) });

/** Max in-gamut chroma at (L, h), by binary search. */
function maxChroma(L, h) {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    inGamut(oklabToLinear(lchToLab({ L, C: mid, h }))) ? (lo = mid) : (hi = mid);
  }
  return lo;
}
/** OKLCH -> sRGB, clipping chroma (never hue, never L) to reach the gamut. */
function lchToRgb({ L, C, h }) {
  const c = Math.min(C, maxChroma(L, h));
  const lin = oklabToLinear(lchToLab({ L, C: c, h }));
  return lin.map((v) => Math.round(clamp01(l2s(clamp01(v))) * 255));
}

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => ((r * 180) / Math.PI + 360) % 360;
/** Circular distance between two hue angles in degrees, 0..180. */
const circDist = (a, b) => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
};

// ---------- WCAG ----------
const relLum = ([r, g, b]) => 0.2126 * s2l(r / 255) + 0.7152 * s2l(g / 255) + 0.0722 * s2l(b / 255);
const contrast = (rgb1, rgb2) => {
  const [hi, lo] = [relLum(rgb1), relLum(rgb2)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Solve for the L (holding hue; chroma = min(C, gamut max at L)) closest
 * to `startL` that achieves `target` contrast against `surface`.
 * dir = -1: darken (text on light surface) — returns the HIGHEST passing L.
 * dir = +1: lighten (text on dark surface) — returns the LOWEST passing L.
 */
function solveL({ C, h }, startL, surface, target, dir) {
  const at = (L) => contrast(lchToRgb({ L, C, h }), surface);
  if (at(startL) >= target) return startL; // already passes: change nothing
  let lo, hi;
  if (dir < 0) { lo = 0; hi = startL; }   // passing side is low L
  else { lo = startL; hi = 1; }           // passing side is high L
  const extreme = dir < 0 ? 0 : 1;
  if (at(extreme) < target) return null;  // impossible (only if surface is mid-tone AND target huge)
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const pass = at(mid) >= target;
    if (dir < 0) (pass ? (lo = mid) : (hi = mid));
    else (pass ? (hi = mid) : (lo = mid));
  }
  return dir < 0 ? lo : hi;
}

// ---------- CLI ----------
const args = process.argv.slice(2);
const accentHex = args.find((a) => !a.startsWith("--") && !/^(analogous|analogous-warm|analogous-cool|complementary|split|triadic|none)$/.test(a));
if (!accentHex) {
  console.error("usage: derive-palette.mjs '#rrggbb' [--harmony analogous|analogous-warm|analogous-cool|complementary|split|triadic|none] [--light '#hex,#hex'] [--dark '#hex,#hex'] [--json]");
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const harmony = opt("--harmony", "analogous");
const characterArg = opt("--character", "vivid");
if (!/^(analogous|analogous-warm|analogous-cool|complementary|split|triadic|none)$/.test(harmony)) {
  console.error(`bad --harmony: ${harmony}`);
  process.exit(2);
}
const asJson = args.includes("--json");

const TARGET = 4.6;       // margin over the 4.5 WCAG AA threshold
const ICON_TARGET = 3.05; // margin over the 3.0 WCAG non-text threshold
const COLLIDE_TARGET = 6.0; // semantic text when its hue collides with the brand
const ERROR_ANCHOR = 27;  // OKLCH hue of convention red — also the harmony tie-break pole

const accent = hexToRgb(accentHex);
const lch = labToLch(rgbToOklab(accent));
const { C: brandC } = lch;
const h = lch.h;                 // radians — the ACCENT's hue. Used for accent/secondary roles only.
const hDeg = rad2deg(h);         // degrees

// ---------- ground: WHICH hue tints the neutral ladder, and WHICH lightness family ----------
// See the header "GROUND FAMILY + GROUND HUE" section for why this is a separate decision from the
// accent's hue. Defaults reproduce the exact prior behaviour: groundHue = accent hue, family = light.
const groundHueArg = opt("--ground-hue", null);
const groundHue = groundHueArg == null
  ? h
  : /^#?[0-9a-f]{6}$/i.test(groundHueArg)
    ? labToLch(rgbToOklab(hexToRgb(groundHueArg))).h
    : deg2rad(Number(groundHueArg));
if (groundHueArg != null && Number.isNaN(groundHue)) {
  console.error(`bad --ground-hue: ${groundHueArg} (want a #hex or a number of degrees)`);
  process.exit(2);
}
const groundFamilyArg = opt("--ground", "light");

/*
 * Six-rung ladder, one array per family. Every family keeps the SAME six semantic roles (hero,
 * default, alt-section, recessed-band, contrast-break, deepest/footer) so downstream code and the
 * build skill's usage guidance do not have to branch on family — only the actual L/C values move.
 *
 * `light` is the ORIGINAL ladder, byte-for-byte (see the surface-1..6 header comment for the
 * reasoning behind these specific numbers) — an unset --ground reproduces prior output exactly.
 * `cream`/`deep`/`dark` are new, first-cut presets: a deliberately warm/high-chroma page for
 * `cream`, and a dominant-dark ground with light RELIEF bands at rungs 5-6 for `deep`/`dark` — the
 * inversion means "the mid-dark break" and "the deepest ground" roles literally invert to "a light
 * break" and "the palest relief", which is why rungs 5/6 read as *contrast* rungs, not fixed
 * lightness positions. These are a starting point for the design pass to refine, exactly as the
 * `light` ladder's own numbers were — never treat any of the four as final.
 */
const GROUND_FAMILIES = {
  light: [
    { L: 0.990, C: 0.006 }, // 1 hero / first section
    { L: 0.965, C: 0.010 }, // 2 default page background
    { L: 0.935, C: 0.013 }, // 3 alternating section / card ground
    { L: 0.895, C: 0.014 }, // 4 recessed band, quote/stat strips
    { L: 0.420, C: 0.014 }, // 5 mid-dark band — breaks a long light run
    { L: 0.220, C: 0.012 }, // 6 deepest ground — footer/CTA
  ],
  cream: [
    { L: 0.965, C: 0.018 },
    { L: 0.945, C: 0.020 },
    { L: 0.920, C: 0.022 },
    { L: 0.885, C: 0.020 },
    { L: 0.400, C: 0.016 },
    { L: 0.200, C: 0.014 },
  ],
  deep: [
    { L: 0.300, C: 0.030 }, // 1 hero — dominant dark ground
    { L: 0.260, C: 0.028 }, // 2 default background
    { L: 0.220, C: 0.024 }, // 3 alt section
    { L: 0.180, C: 0.020 }, // 4 recessed band
    { L: 0.880, C: 0.016 }, // 5 light RELIEF — breaks a long dark run
    { L: 0.120, C: 0.022 }, // 6 deepest, richest — footer/CTA anchor
  ],
  dark: [
    { L: 0.180, C: 0.022 },
    { L: 0.150, C: 0.020 },
    { L: 0.120, C: 0.018 },
    { L: 0.095, C: 0.016 },
    { L: 0.920, C: 0.014 }, // relief
    { L: 0.060, C: 0.018 }, // deepest
  ],
};
if (!GROUND_FAMILIES[groundFamilyArg]) {
  console.error(`bad --ground: ${groundFamilyArg} (want light|cream|deep|dark)`);
  process.exit(2);
}
const ladderSpec = GROUND_FAMILIES[groundFamilyArg];
const ladderRgb = ladderSpec.map(({ L, C }) => lchToRgb({ L, C, h: groundHue }));

// ---------- neutrals: brand-tinted surfaces (derived unless overridden) ----
const lightOverride = opt("--light", null);
const darkOverride = opt("--dark", null);
// Legacy 3-token set maps onto the ladder: surface = rung1 (hero/lightest-of-family), surface-alt =
// rung2, surface-dark = rung6 (deepest-of-family). This keeps `--surface`/`--surface-dark` meaning
// "the page's dominant ground" / "the deepest section" even when the family itself is dark — on a
// `dark` family, --surface is correctly a dark tone, because the page's dominant ground IS dark.
const lightSurfaces = lightOverride
  ? lightOverride.split(",").map((s) => s.trim()).filter(Boolean)
  : [rgbToHex(ladderRgb[0]), rgbToHex(ladderRgb[1])];
const darkSurfaces = darkOverride
  ? darkOverride.split(",").map((s) => s.trim()).filter(Boolean)
  : [rgbToHex(ladderRgb[5])];

/*
 * CONTRAST VERIFICATION NOW COVERS EVERY LADDER RUNG, not just the two legacy tokens above — a real
 * gap this change closes (see header). Rungs are classified light (L>0.5) / dark (<=0.5) rather
 * than by fixed position, so this works unmodified for a `dark` family whose rungs 5-6 are the
 * light-and-dark relief pair instead of rungs 1-2/6. An explicit --light/--dark override still wins
 * outright — an operator who hand-specifies surfaces is opting out of the ladder entirely.
 */
const allSurfaceHexes = new Set([...lightSurfaces, ...darkSurfaces]);
if (!lightOverride) for (const [i, s] of ladderSpec.entries()) if (s.L > 0.5) allSurfaceHexes.add(rgbToHex(ladderRgb[i]));
if (!darkOverride) for (const [i, s] of ladderSpec.entries()) if (s.L <= 0.5) allSurfaceHexes.add(rgbToHex(ladderRgb[i]));
const lightRgbs = [...allSurfaceHexes].map(hexToRgb).filter((c) => relLum(c) > relLum(hexToRgb("#808080")));
const darkRgbsAll = [...allSurfaceHexes].map(hexToRgb).filter((c) => relLum(c) <= relLum(hexToRgb("#808080")));
const darkRgbs = darkRgbsAll.length ? darkRgbsAll : darkSurfaces.map(hexToRgb); // family could be all-light

// Worst-case surfaces: for darkened text the hardest light surface is the
// LOWEST-luminance one (less headroom); for lightened text the hardest dark
// surface is the HIGHEST-luminance one.
const worstLight = lightRgbs.reduce((a, b) => (relLum(a) < relLum(b) ? a : b));
const worstDark = darkRgbs.reduce((a, b) => (relLum(a) > relLum(b) ? a : b));

// Neutral text roles, solved against the real surfaces. Hue is groundHue, NOT the accent hue — body
// text should read as "the same paper" as the ground it sits on; brand identity is carried by
// --accent/--secondary, which keep the accent hue exactly as before.
const inkMutedL = solveL({ C: 0.012, h: groundHue }, 0.6, worstLight, TARGET, -1);
const inkRgb = lchToRgb({ L: 0.235, C: 0.014, h: groundHue });
const onDarkMutedL = solveL({ C: 0.010, h: groundHue }, 0.55, worstDark, TARGET, +1);
const onDarkRgb = lchToRgb({ L: 0.965, C: 0.008, h: groundHue });

// ---------- accent roles (the original seven — logic unchanged) ----------
// --accent-text: darken vs worst light surface
const textL = solveL({ C: brandC, h }, lch.L, worstLight, TARGET, -1);
// --accent-text-dark: lighten vs worst dark surface
const textDarkL = solveL({ C: brandC, h }, lch.L, worstDark, TARGET, +1);

// Deep fill pair: on-colour first (near-white, whisper of the hue), then the
// fill is the accent darkened until the on-colour passes on it.
const onFill = lchToRgb({ L: 0.97, C: Math.min(brandC, 0.02), h });
const fillL = solveL({ C: brandC, h }, lch.L, onFill, TARGET, -1);

// Bright fill pair: the brand value as the surface, with a same-hue on-colour
// solved on whichever side of the accent has headroom. A mid/bright accent
// takes a deep ink; a DARK brand accent (navy, forest, oxblood) inverts to a
// pale same-hue on-colour instead — darker-still ink is arithmetic-impossible.
const inkC = Math.min(brandC, 0.09); // on-colour wants restrained chroma
let brightInkL = solveL({ C: inkC, h }, Math.min(lch.L, 0.3), accent, TARGET, -1);
let inkNote = "text on --accent-fill-bright";
if (brightInkL == null) {
  brightInkL = solveL({ C: Math.min(brandC, 0.02), h }, Math.max(lch.L, 0.7), accent, TARGET, +1);
  inkNote = "text on --accent-fill-bright (light: brand accent is dark)";
}

// ---------- secondary hue by named harmony ----------
function secondaryHueDeg(kind) {
  // Two-rotation tie-break, in priority order:
  // 1. avoid the violet band (280–330deg) if the alternate rotation is outside
  //    it — an unasked-for violet support colour on a near-white page is
  //    adjacent to the #1 AI-slop tell (purple-on-white) and reads generated,
  //    not designed. Seen, not theorised: green #6AB42F's split partner is
  //    284deg violet by pure "away from red" logic; the alternate, 344deg
  //    crimson, is the scheme a designer would actually pick for a green trade.
  // 2. then prefer the rotation farther from the error anchor (27deg), so the
  //    support colour can't read as a red flag.
  // `complementary` has no alternate rotation and is never adjusted — if a
  // brand's complement is violet, that is the operator's named choice (the
  // skill's industry table routes such brands to split/analogous instead).
  const violet = (d) => circDist(d, 305) <= 25;
  const pick = (opts) => {
    const [a, b] = opts.map((d) => ((d % 360) + 360) % 360);
    if (violet(a) !== violet(b)) return violet(a) ? b : a;
    return circDist(a, ERROR_ANCHOR) >= circDist(b, ERROR_ANCHOR) ? a : b;
  };
  const toward = (opts, pole) => opts.reduce((x, y) => (circDist(x, pole) <= circDist(y, pole) ? x : y));
  switch (kind) {
    case "analogous":      return pick([hDeg + 30, hDeg - 30]);
    case "analogous-warm": return toward([hDeg + 30, hDeg - 30], 70);
    case "analogous-cool": return toward([hDeg + 30, hDeg - 30], 250);
    case "complementary":  return hDeg + 180;
    case "split":          return pick([hDeg + 150, hDeg - 150]);
    case "triadic":        return pick([hDeg + 120, hDeg - 120]);
    default:               return null; // none
  }
}
const secDeg = secondaryHueDeg(harmony);
let secondaryRoles = {};
if (secDeg != null) {
  const hs = deg2rad(((secDeg % 360) + 360) % 360);

  /*
   * CHARACTER IS AN INDEPENDENT AXIS — added 2026-08-16.
   *
   * Previously the secondary inherited the ACCENT's lightness (`L: lch.L`) with chroma at 85%.
   * That is faithful character-matching, and it is exactly why the palette could not deliver
   * variety: Mike's brand orange #FF8D13 is a VIVID colour, so every harmony derived from it came
   * out vivid too — analogous gave brass, split gave electric cyan #00C5D9, triadic gave mint. On a
   * demolition contractor the warm option read as "all brown" and the cool options read as toys.
   * The operator's question was exactly this: "so there will be diverse colors that match the
   * theory vs 'all brown'".
   *
   * You cannot solve that while chaining BOTH lightness and chroma to the logo. The brand accent
   * must stay as-is (it is their identity), but the SECONDARY belongs in the character band the
   * SITE needs, per the colour reference: "hue is usually a weaker predictor of emotional response
   * than chroma and lightness". A deep teal and an electric cyan are the same hue family and
   * completely different products.
   *
   * So `--character` places the secondary's L/C, and harmony still picks its hue. Deep + split on
   * Mike's gives a dark, saturated teal: genuinely a different colour from the orange, unmistakably
   * serious, and it sits on the warm surface ladder without fighting it.
   */
  const CHARACTER = {
    deep:  { L: 0.42, C: Math.min(brandC * 1.00, 0.15) }, // dark but HIGH chroma — weight, capability
    vivid: { L: lch.L, C: Math.min(brandC * 0.85, 0.13) }, // legacy default: inherits the accent
    muted: { L: 0.60, C: 0.05 },                           // calm, trustworthy
    pale:  { L: 0.86, C: 0.03 },                           // airy, premium
    dark:  { L: 0.30, C: 0.04 },                           // restrained, luxury
  };
  const charArg = String(characterArg).toLowerCase();
  const band = CHARACTER[charArg] || CHARACTER.vivid;
  if (!CHARACTER[charArg]) console.error(`derive-palette: unknown --character "${charArg}", using vivid`);
  const Cs = band.C;
  const secBaseL = band.L;
  const secTextL = solveL({ C: Cs, h: hs }, lch.L, worstLight, TARGET, -1);
  const onSecFill = lchToRgb({ L: 0.97, C: Math.min(Cs, 0.02), h: hs });
  const secFillL = solveL({ C: Cs, h: hs }, lch.L, onSecFill, TARGET, -1);
  if (secTextL == null || secFillL == null) {
    console.error("derive-palette: could not solve secondary roles — surfaces too mid-toned?");
    process.exit(1);
  }
  secondaryRoles = {
    "secondary": { rgb: lchToRgb({ L: secBaseL, C: Cs, h: hs }), note: `harmony=${harmony} character=${charArg} (${(((secDeg % 360) + 360) % 360).toFixed(0)}deg). DECORATIVE ONLY, same law as --accent.` },
    "secondary-text": { rgb: lchToRgb({ L: secTextL, C: Cs, h: hs }), note: "secondary-coloured text on light surfaces" },
    "secondary-fill": { rgb: lchToRgb({ L: secFillL, C: Cs, h: hs }), note: "deep secondary fill behind --on-secondary-fill (secondary buttons, tags)" },
    "on-secondary-fill": { rgb: onSecFill, note: "text on --secondary-fill" },
  };
}

// ---------- semantics: fixed convention anchors, collision-aware ----------
const SEMANTIC = { error: 27, success: 152, warning: 78, info: 245 };
const collisions = [];
const semanticRoles = {};
for (const [name, anchor] of Object.entries(SEMANTIC)) {
  const collides = circDist(hDeg, anchor) < 20;
  if (collides) collisions.push(name);
  const hSem = deg2rad(anchor);
  const Csem = name === "warning" ? 0.12 : 0.13;
  const textTarget = collides ? COLLIDE_TARGET : TARGET;
  const surfRgb = lchToRgb({ L: 0.955, C: 0.035, h: hSem });
  // Text must hold on the light surfaces AND on its own banner tint.
  const worstForText = [...lightRgbs, surfRgb].reduce((a, b) => (relLum(a) < relLum(b) ? a : b));
  const iconL = solveL({ C: 0.15, h: hSem }, 0.62, worstLight, ICON_TARGET, -1);
  const semTextL = solveL({ C: Csem, h: hSem }, 0.55, worstForText, textTarget, -1);
  const semTextDarkL = solveL({ C: Csem, h: hSem }, 0.65, worstDark, TARGET, +1);
  if (iconL == null || semTextL == null || semTextDarkL == null) {
    console.error(`derive-palette: could not solve semantic '${name}' — surfaces too mid-toned?`);
    process.exit(1);
  }
  semanticRoles[name] = { rgb: lchToRgb({ L: iconL, C: 0.15, h: hSem }), note: `${name} icons/borders (>=3:1 non-text)${collides ? " [BRAND COLLISION — form rule applies]" : ""}` };
  semanticRoles[`${name}-text`] = { rgb: lchToRgb({ L: semTextL, C: Csem, h: hSem }), note: `${name} text on light + on --${name}-surface${collides ? ` (solved to ${COLLIDE_TARGET}:1 — brand hue collides, lightness separates)` : ""}` };
  semanticRoles[`${name}-text-dark`] = { rgb: lchToRgb({ L: semTextDarkL, C: Csem, h: hSem }), note: `${name} text on dark surfaces` };
  semanticRoles[`${name}-surface`] = { rgb: surfRgb, note: `${name} banner/badge tint behind --${name}-text` };
}

const bad = [textL, textDarkL, fillL, brightInkL, inkMutedL, onDarkMutedL].some((v) => v == null);
if (bad) {
  console.error("derive-palette: could not reach 4.6:1 for a role — surfaces too mid-toned?");
  process.exit(1);
}

const roles = {
  // -- group 1: accent (original seven, unchanged) --
  "accent": { rgb: accent, note: "DECORATIVE ONLY - borders, icons, glows, plates. Never text, never under text." },
  "accent-text": { rgb: lchToRgb({ L: textL, C: brandC, h }), note: `text on light surfaces (solved vs ${rgbToHex(worstLight)})` },
  "accent-text-dark": { rgb: lchToRgb({ L: textDarkL, C: brandC, h }), note: `text on dark surfaces (solved vs ${rgbToHex(worstDark)})` },
  "accent-fill": { rgb: lchToRgb({ L: fillL, C: brandC, h }), note: "deep fill behind --on-accent-fill (CTAs, chat, badges)" },
  "on-accent-fill": { rgb: onFill, note: "text on --accent-fill" },
  "accent-fill-bright": { rgb: accent, note: "brand-bright fill behind --on-accent-bright ONLY (never white text)" },
  "on-accent-bright": { rgb: lchToRgb({ L: brightInkL, C: inkNote.includes("light") ? Math.min(brandC, 0.02) : inkC, h }), note: inkNote },
  // -- group 2: secondary (harmony) --
  ...secondaryRoles,
  // -- group 3: brand-tinted neutrals --
  "surface": { rgb: lightOverride ? lightRgbs[0] : ladderRgb[0], note: lightOverride ? "page background (operator override)" : `page background — ground=${groundFamilyArg}, rung 1` },
  "surface-alt": { rgb: lightOverride ? (lightRgbs[1] || lightRgbs[0]) : ladderRgb[1], note: lightOverride ? "card/section surface (operator override)" : `card/section surface — ground=${groundFamilyArg}, rung 2` },
  "surface-dark": { rgb: darkOverride ? darkRgbs[0] : ladderRgb[5], note: darkOverride ? "dark section surface (operator override)" : `dark section surface — ground=${groundFamilyArg}, rung 6` },
  "ink": { rgb: inkRgb, note: "body text on light surfaces (ground-tinted near-black)" },
  "ink-muted": { rgb: lchToRgb({ L: inkMutedL, C: 0.012, h: groundHue }), note: `muted/secondary text on light surfaces — SOLVED, use instead of freehand grey` },
  /*
   * SURFACE LADDER — six ground-tinted steps (2026-08-16; hue decoupled from the accent 2026-08-16,
   * see the header "GROUND FAMILY + GROUND HUE" section for the full reasoning and the `--ground` /
   * `--ground-hue` flags that select the family and tint).
   *
   * Before the ladder existed the palette offered exactly THREE surfaces, which is the entire
   * vocabulary a builder had for section rhythm — "Tight constraint, then variation" and "Lightness
   * variation at fixed chroma" from the colour-science reference are the fix, and don't require a
   * second hue for a mono-brand client. Before the GROUND axis existed, every ladder was forced
   * through the accent's own hue and one fixed lightness curve, which is why two completely
   * different trades produced numerically identical grounds — only the family + tint below make
   * that a choice rather than an accident.
   */
  "surface-1": { rgb: ladderRgb[0], note: `ground=${groundFamilyArg} rung 1 — hero/first section` },
  "surface-2": { rgb: ladderRgb[1], note: `ground=${groundFamilyArg} rung 2 — default page background` },
  "surface-3": { rgb: ladderRgb[2], note: `ground=${groundFamilyArg} rung 3 — alternating section / card ground` },
  "surface-4": { rgb: ladderRgb[3], note: `ground=${groundFamilyArg} rung 4 — recessed band, quote/stat strips` },
  "surface-5": { rgb: ladderRgb[4], note: `ground=${groundFamilyArg} rung 5 — contrast break (mid-dark on a light family, light relief on a dark family)` },
  "surface-6": { rgb: ladderRgb[5], note: `ground=${groundFamilyArg} rung 6 — deepest/richest ground — footer/CTA anchor` },
  "on-dark": { rgb: onDarkRgb, note: "body text on --surface-dark (ground-tinted near-white)" },
  "on-dark-muted": { rgb: lchToRgb({ L: onDarkMutedL, C: 0.010, h: groundHue }), note: "muted text on --surface-dark — SOLVED" },
  // -- group 4: semantics --
  ...semanticRoles,
};

// ---------- verify every constrained pair before printing ----------
// [role, fg, description, bg, threshold]
const pairs = [];
for (const s of lightRgbs) pairs.push(["accent-text", roles["accent-text"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
for (const s of darkRgbs) pairs.push(["accent-text-dark", roles["accent-text-dark"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
pairs.push(["on-accent-fill", roles["on-accent-fill"].rgb, "on --accent-fill", roles["accent-fill"].rgb, 4.5]);
pairs.push(["on-accent-bright", roles["on-accent-bright"].rgb, "on --accent-fill-bright", roles["accent-fill-bright"].rgb, 4.5]);
if (roles["secondary-text"]) {
  for (const s of lightRgbs) pairs.push(["secondary-text", roles["secondary-text"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
  pairs.push(["on-secondary-fill", roles["on-secondary-fill"].rgb, "on --secondary-fill", roles["secondary-fill"].rgb, 4.5]);
}
for (const s of lightRgbs) {
  pairs.push(["ink", roles["ink"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
  pairs.push(["ink-muted", roles["ink-muted"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
}
for (const s of darkRgbs) {
  pairs.push(["on-dark", roles["on-dark"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
  pairs.push(["on-dark-muted", roles["on-dark-muted"].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
}
for (const name of Object.keys(SEMANTIC)) {
  const need = collisions.includes(name) ? COLLIDE_TARGET - 0.1 : 4.5;
  for (const s of lightRgbs) {
    pairs.push([name, roles[name].rgb, `surface ${rgbToHex(s)} (non-text)`, s, 3.0]);
    pairs.push([`${name}-text`, roles[`${name}-text`].rgb, `surface ${rgbToHex(s)}`, s, need]);
  }
  pairs.push([`${name}-text`, roles[`${name}-text`].rgb, `on --${name}-surface`, roles[`${name}-surface`].rgb, need]);
  for (const s of darkRgbs) pairs.push([`${name}-text-dark`, roles[`${name}-text-dark`].rgb, `surface ${rgbToHex(s)}`, s, 4.5]);
}

let failures = 0;
const report = pairs.map(([name, fg, vs, bg, need]) => {
  const r = contrast(fg, bg);
  if (r < need) failures++;
  return { role: name, fg: rgbToHex(fg), vs, bg: rgbToHex(bg), need, ratio: +r.toFixed(2), pass: r >= need };
});

if (asJson) {
  console.log(JSON.stringify({
    input: { accent: rgbToHex(accent), oklch: { L: +lch.L.toFixed(4), C: +brandC.toFixed(4), h: +hDeg.toFixed(1) }, light: lightSurfaces, dark: darkSurfaces },
    harmony: { type: harmony, secondaryHue: secDeg == null ? null : +((((secDeg % 360) + 360) % 360).toFixed(1)) },
    ground: {
      family: groundFamilyArg,
      hueDeg: +rad2deg(groundHue).toFixed(1),
      hueSource: groundHueArg == null ? "accent (default)" : "explicit --ground-hue",
      derived: !lightOverride && !darkOverride,
      ladder: ladderSpec.map((s, i) => ({ rung: i + 1, L: s.L, C: s.C, hex: rgbToHex(ladderRgb[i]) })),
    },
    semanticCollisions: collisions,
    tokens: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, rgbToHex(v.rgb)])),
    report,
    pass: failures === 0,
  }, null, 2));
} else {
  console.log(`\nBrand accent ${rgbToHex(accent)}  oklch(${lch.L.toFixed(3)} ${brandC.toFixed(3)} ${hDeg.toFixed(1)})`);
  console.log(`Harmony: ${harmony}${secDeg != null ? ` -> secondary hue ${(((secDeg % 360) + 360) % 360).toFixed(0)}deg` : ""}` +
    `${collisions.length ? `   SEMANTIC COLLISION: ${collisions.join(", ")} shares the brand hue — form rule applies (see skill)` : ""}`);
  console.log(`Neutrals: ${lightOverride || darkOverride ? "operator-overridden surfaces" : `ground=${groundFamilyArg}, tint hue ${rad2deg(groundHue).toFixed(1)}deg (${groundHueArg == null ? "= accent, default" : "explicit --ground-hue"})`}`);
  console.log(`Accent/secondary hue is preserved exactly. Ground rungs move on their own hue + family; only lightness moves within a rung's role.\n`);
  console.log(":root {  /* paste into globals.css; mirror into tailwind.config.ts */");
  for (const [k, v] of Object.entries(roles)) {
    console.log(`  --${k}: ${rgbToHex(v.rgb)};`.padEnd(34) + `/* ${v.note} */`);
  }
  console.log("}\n\nComputed ratios (WCAG AA needs 4.5:1 text / 3.0 non-text; derivation adds margin):");
  for (const r of report) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"} ${String(r.ratio).padEnd(5)} (needs ${r.need})  --${r.role} ${r.fg} ${r.vs}`);
  }
  // decorative honesty line: show what the RAW accent would have scored
  console.log(`\nFor the record, the raw accent as text on ${rgbToHex(worstLight)}: ` +
    `${contrast(accent, worstLight).toFixed(2)}:1; white on the raw accent: ${contrast([255,255,255], accent).toFixed(2)}:1.` +
    `\nThat is why --accent is decorative-only.`);
}
// In --json mode the status goes to stderr so stdout stays parseable JSON.
(asJson ? console.error : console.log)(`\nPALETTE_DERIVE=${failures ? "FAIL" : "PASS"}`);
process.exit(failures ? 1 : 0);
