#!/usr/bin/env node
/**
 * inspect-logo.mjs <slug> [--write]
 *
 * BOTH lanes (shared + dedicated): decide nav chrome from the real logo file.
 * - White-plate lockups → light navbar + logo-only (no shortName duplicate)
 * - Dark ink / black marks → LIGHT navbar (never dark-on-dark)
 * - Light / white ink marks → dark navbar
 * - Tiny square marks → bump display height
 * - Wide wordmarks → height-first, width auto
 *
 * Writes clients/<slug>/data/logo-nav.json and optionally patches site-data.ts fields.
 * Author/preflight: run after gather places public/images/logo.webp.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const slug = process.argv.find((a, i) => i > 1 && !a.startsWith("--"));
const WRITE = process.argv.includes("--write");

if (!slug) {
  console.error("usage: inspect-logo.mjs <slug> [--write]");
  process.exit(2);
}

const logoPath = join(ROOT, "clients", slug, "site", "public", "images", "logo.webp");
const outPath = join(ROOT, "clients", slug, "data", "logo-nav.json");
const siteDataPath = join(ROOT, "clients", slug, "site", "src", "app", "_components", "site-data.ts");

if (!existsSync(logoPath)) {
  console.error(`LOGO_NAV=FAIL missing ${logoPath}`);
  process.exit(1);
}

let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("LOGO_NAV=FAIL sharp not installed (pnpm add -D sharp at repo root)");
  process.exit(1);
}

const meta = await sharp(logoPath).metadata();
const w = meta.width || 1;
const h = meta.height || 1;
const aspect = w / h;

const { data, info } = await sharp(logoPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

// Edge sample → white-plate detection
const bw = Math.max(2, Math.floor(w * 0.1));
const bh = Math.max(2, Math.floor(h * 0.1));
let edgeOpaque = 0;
let edgeWhite = 0;
let edgeDark = 0;

// Full opaque sample → ink luminance (drives contrast vs nav)
let inkOpaque = 0;
let inkSum = 0;
let inkDark = 0;
let inkLight = 0;

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * info.channels;
    const a = data[i + 3];
    if (a < 24) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const L = (r + g + b) / 3;

    inkOpaque++;
    inkSum += L;
    if (L <= 72) inkDark++;
    if (L >= 200) inkLight++;

    const edge = x < bw || x >= w - bw || y < bh || y >= h - bh;
    if (!edge) continue;
    edgeOpaque++;
    if (L >= 232) edgeWhite++;
    if (L <= 48) edgeDark++;
  }
}

const whiteRatio = edgeOpaque ? edgeWhite / edgeOpaque : 0;
const darkRatio = edgeOpaque ? edgeDark / edgeOpaque : 0;
const plate = whiteRatio >= 0.35 ? "light" : darkRatio >= 0.45 ? "dark" : "mixed";

const meanInkL = inkOpaque ? inkSum / inkOpaque : 128;
const inkDarkRatio = inkOpaque ? inkDark / inkOpaque : 0;
const inkLightRatio = inkOpaque ? inkLight / inkOpaque : 0;

/** @type {'lockup'|'wordmark'|'mark'} */
let mode = "mark";
if (aspect >= 1.65) mode = "wordmark";
else if (plate === "light" || (aspect >= 0.85 && aspect <= 1.25 && whiteRatio >= 0.25)) {
  mode = "lockup";
}

/**
 * Nav chrome must CONTRAST the logo ink.
 * Bug (2026-08-22 Lux): plate=dark → navTheme=dark put a black mark on bg-surface-dark.
 * White-plate lockups still want a light bar (the plate is the ground).
 * Dark ink → light nav. Light ink → dark nav. Mixed defaults to light (safer for trade marks).
 */
let navTheme;
let contrastNote = null;
if (plate === "light") {
  navTheme = "light";
} else if (meanInkL <= 110 || inkDarkRatio >= 0.35) {
  navTheme = "light";
  contrastNote = "dark-ink→light-nav";
} else if (meanInkL >= 180 || inkLightRatio >= 0.35) {
  navTheme = "dark";
  contrastNote = "light-ink→dark-nav";
} else {
  navTheme = "light";
  contrastNote = "mixed-ink→light-nav-safe";
}

// Hard guard: never ship dark nav with dark ink (invisible logo)
if (navTheme === "dark" && meanInkL < 120 && inkDarkRatio >= 0.25) {
  navTheme = "light";
  contrastNote = "forced-light-nav (blocked dark-on-dark)";
}

let logoOnly = mode === "lockup" || mode === "wordmark";

let logoImgClass = "h-10 w-10 shrink-0 object-contain";
if (mode === "lockup") {
  logoImgClass = "h-12 w-auto max-h-14 max-w-[11rem] sm:h-14 sm:max-w-[13rem] shrink-0 object-contain";
} else if (mode === "wordmark") {
  logoImgClass = "h-9 w-auto max-h-11 max-w-[12rem] sm:h-10 sm:max-w-[14rem] shrink-0 object-contain";
} else if (Math.min(w, h) < 96) {
  logoImgClass = "h-11 w-11 sm:h-12 sm:w-12 shrink-0 object-contain";
} else if (mode === "mark" && Math.min(w, h) >= 128) {
  logoOnly = true;
  logoImgClass = "h-14 w-14 sm:h-16 sm:w-16 shrink-0 object-contain";
}

const result = {
  slug,
  width: w,
  height: h,
  aspect: Math.round(aspect * 1000) / 1000,
  whiteRatio: Math.round(whiteRatio * 1000) / 1000,
  darkRatio: Math.round(darkRatio * 1000) / 1000,
  meanInkL: Math.round(meanInkL * 10) / 10,
  inkDarkRatio: Math.round(inkDarkRatio * 1000) / 1000,
  inkLightRatio: Math.round(inkLightRatio * 1000) / 1000,
  plate,
  mode,
  navTheme,
  contrastNote,
  logoOnly,
  logoImgClass,
  inspectedAt: new Date().toISOString(),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

if (WRITE && existsSync(siteDataPath)) {
  let src = readFileSync(siteDataPath, "utf8");
  const fields = {
    navTheme: JSON.stringify(navTheme),
    logoOnly: String(logoOnly),
    logoImgClass: JSON.stringify(logoImgClass),
  };
  for (const [key, lit] of Object.entries(fields)) {
    const re = new RegExp(`(\\b${key}\\s*:\\s*)([^,\\n]+)`);
    if (re.test(src)) {
      src = src.replace(re, `$1${lit}`);
    } else {
      src = src.replace(
        /(shortName:\s*[^,\n]+,)/,
        `$1\n  ${key}: ${lit},`,
      );
    }
  }
  writeFileSync(siteDataPath, src);
  console.log(`LOGO_NAV=WROTE site-data.ts navTheme=${navTheme} mode=${mode}`);
}

console.log(
  `LOGO_NAV=PASS slug=${slug} plate=${plate} mode=${mode} navTheme=${navTheme} logoOnly=${logoOnly}` +
    (contrastNote ? ` contrast=${contrastNote}` : "") +
    ` meanInkL=${result.meanInkL}`,
);
console.log(`  ${outPath}`);
process.exit(0);
