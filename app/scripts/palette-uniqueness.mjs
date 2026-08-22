#!/usr/bin/env node
/**
 * palette-uniqueness.mjs <slug> --accent '#rrggbb' [--town City] [--prefer cool|warm]
 *
 * Brand hue stays in-family (landscaping can stay green). What this blocks is TWO nearby
 * builds shipping the same green swatch — Erik forest + Lux forest in Frisco looking identical.
 *
 * Measured 2026-08-22: Lux defaulted to #1B5E3B while Erik already sat on forest green; fonts
 * also collapsed to Fraunces. Font ledger only catches SAME-TOWN after record; this script
 * also reads live clients/<slug>/site/src/app/globals.css --accent so skipped ledgers still collide.
 *
 * Rule:
 *   Δhue < 28° against a SAME-TOWN live/ledger accent → NUDGE ±32° (prefer --prefer cool|warm)
 *   Δhue < 18° against any of the last 8 live accents (any town) → WARN (optional nudge)
 *   Otherwise KEEP
 *
 * Prints PALETTE_UNIQUENESS=KEEP|NUDGE|WARN and a ready-to-run derive-palette accent.
 * Exit 0 always (advisory at pick time); design.md treats NUDGE as mandatory before derive.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const slug = args.find((a, i) => i >= 0 && !a.startsWith("--") && !a.startsWith("#"));
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
let accentIn = (opt("accent") || args.find((a) => /^#?[0-9a-f]{6}$/i.test(a)) || "").replace(/^#?/, "#");
let town = (opt("town") || "").toLowerCase().trim();
const prefer = opt("prefer", "cool"); // cool = +hue toward teal; warm = −hue toward olive/gold

if (!slug) {
  console.error("usage: palette-uniqueness.mjs <slug> [--accent '#rrggbb'] [--town City] [--prefer cool|warm] [--gate]");
  process.exit(2);
}

// ── minimal sRGB ↔ OKLCH (same math family as derive-palette) ──
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHex([r, g, b]) {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function rgbToOklab([r, g, b]) {
  const R = s2l(r / 255),
    G = s2l(g / 255),
    B = s2l(b / 255);
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l),
    m_ = Math.cbrt(m),
    s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}
function oklabToRgb({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const R = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [l2s(R) * 255, l2s(G) * 255, l2s(B) * 255];
}
function labToLch({ L, a, b }) {
  const C = Math.hypot(a, b);
  let h = Math.atan2(b, a);
  if (h < 0) h += Math.PI * 2;
  return { L, C, h };
}
function lchToLab({ L, C, h }) {
  return { L, a: C * Math.cos(h), b: C * Math.sin(h) };
}
const rad2deg = (r) => (r * 180) / Math.PI;
const deg2rad = (d) => (d * Math.PI) / 180;
function hueDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function shiftAccent(hex, deltaDeg) {
  const lab = rgbToOklab(hexToRgb(hex));
  const lch = labToLch(lab);
  const h = (rad2deg(lch.h) + deltaDeg + 360) % 360;
  return rgbToHex(oklabToRgb(lchToLab({ L: lch.L, C: lch.C, h: deg2rad(h) })));
}

function readAccentFromGlobals(cssPath) {
  if (!existsSync(cssPath)) return null;
  const m = readFileSync(cssPath, "utf8").match(/--accent:\s*(#[0-9a-fA-F]{6})/);
  return m ? m[1].toLowerCase() : null;
}
function readTownFromSiteData(path) {
  if (!existsSync(path)) return null;
  const src = readFileSync(path, "utf8");
  const city = src.match(/city:\s*"([^"]+)"/);
  return city ? city[1].toLowerCase() : null;
}

// Auto-fill from shipped client when flags omitted (post-build / --gate)
if (!/^#[0-9a-f]{6}$/i.test(accentIn)) {
  accentIn =
    readAccentFromGlobals(
      join(ROOT, "clients", slug, "site", "src", "app", "globals.css"),
    ) || "";
}
if (!town) {
  town =
    readTownFromSiteData(
      join(ROOT, "clients", slug, "site", "src", "app", "_components", "site-data.ts"),
    ) || "";
}
if (!/^#[0-9a-f]{6}$/i.test(accentIn)) {
  if (args.includes("--gate")) {
    console.log(`PALETTE_UNIQUENESS_CHECK=SKIP (no --accent and no --accent in clients/${slug}/site globals.css)`);
    process.exit(0);
  }
  console.error("usage: palette-uniqueness.mjs <slug> [--accent '#rrggbb'] [--town City] [--prefer cool|warm] [--gate]");
  process.exit(2);
}

// Live clients
const clientsDir = join(ROOT, "clients");
const live = [];
if (existsSync(clientsDir)) {
  for (const name of readdirSync(clientsDir)) {
    if (name === slug || name.startsWith("_")) continue;
    const accent = readAccentFromGlobals(
      join(clientsDir, name, "site", "src", "app", "globals.css"),
    );
    if (!accent) continue;
    const t = readTownFromSiteData(
      join(clientsDir, name, "site", "src", "app", "_components", "site-data.ts"),
    );
    const lab = rgbToOklab(hexToRgb(accent));
    const lch = labToLch(lab);
    live.push({
      slug: name,
      accent,
      town: t,
      hue: rad2deg(lch.h),
    });
  }
}

const proposed = accentIn.toLowerCase();
const propLch = labToLch(rgbToOklab(hexToRgb(proposed)));
const propHue = rad2deg(propLch.h);

const SAME_TOWN_MAX = 28;
const ANY_WARN_MAX = 18;
const NUDGE_DEG = 32;

const sameTownHits = live.filter(
  (r) => town && r.town && r.town === town && hueDelta(propHue, r.hue) < SAME_TOWN_MAX,
);
const closeAny = live
  .filter((r) => hueDelta(propHue, r.hue) < ANY_WARN_MAX)
  .sort((a, b) => hueDelta(propHue, a.hue) - hueDelta(propHue, b.hue));

let status = "KEEP";
let outAccent = proposed;
let note = "";

if (sameTownHits.length) {
  const hit = sameTownHits.sort(
    (a, b) => hueDelta(propHue, a.hue) - hueDelta(propHue, b.hue),
  )[0];
  const dir = prefer === "warm" ? -NUDGE_DEG : NUDGE_DEG;
  outAccent = shiftAccent(proposed, dir).toLowerCase();
  status = "NUDGE";
  note = `same-town collide ${hit.slug} accent=${hit.accent} Δhue=${hueDelta(propHue, hit.hue).toFixed(1)}° → shift ${dir > 0 ? "+" : ""}${dir}° (${prefer})`;
} else if (closeAny.length) {
  status = "WARN";
  note = `near ${closeAny[0].slug} accent=${closeAny[0].accent} Δhue=${hueDelta(propHue, closeAny[0].hue).toFixed(1)}° (cross-town; keep brand green unless twin score is high)`;
}

const outHue = rad2deg(labToLch(rgbToOklab(hexToRgb(outAccent))).h);
const gateMode = args.includes("--gate") || !opt("accent");
console.log(
  `PALETTE_UNIQUENESS=${status} slug=${slug} in=${proposed} out=${outAccent} hueIn=${propHue.toFixed(1)} hueOut=${outHue.toFixed(1)}` +
    (note ? ` ${note}` : ""),
);
if (status === "NUDGE") {
  console.log(`DERIVE_ACCENT=${outAccent}`);
  console.log(`# re-run: node scripts/derive-palette.mjs '${outAccent}' --harmony analogous-cool --ground-hue 140`);
}
// Gate vocabulary for gates.mjs: NUDGE on a SHIPPED accent is FAIL (must have nudged before derive).
if (gateMode) {
  const check =
    status === "KEEP" ? "PASS" : status === "NUDGE" ? "FAIL" : status === "WARN" ? "WARN" : "SKIP";
  console.log(`PALETTE_UNIQUENESS_CHECK=${check}`);
  process.exit(check === "FAIL" ? 1 : 0);
}
process.exit(0);
