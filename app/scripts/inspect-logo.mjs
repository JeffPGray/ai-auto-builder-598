#!/usr/bin/env node
/**
 * inspect-logo.mjs <slug> [--write]
 *
 * BOTH lanes (shared + dedicated): decide nav chrome from the real logo file.
 * - White-plate lockups → light navbar + logo-only (no shortName duplicate)
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

// Sample border + corners for white-plate detection (ignore transparent)
const { data, info } = await sharp(logoPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const bw = Math.max(2, Math.floor(w * 0.1));
const bh = Math.max(2, Math.floor(h * 0.1));
let opaque = 0;
let white = 0;
let dark = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const edge = x < bw || x >= w - bw || y < bh || y >= h - bh;
    if (!edge) continue;
    const i = (y * w + x) * info.channels;
    const a = data[i + 3];
    if (a < 24) continue;
    opaque++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const L = (r + g + b) / 3;
    if (L >= 232) white++;
    if (L <= 48) dark++;
  }
}
const whiteRatio = opaque ? white / opaque : 0;
const darkRatio = opaque ? dark / opaque : 0;
const plate = whiteRatio >= 0.35 ? "light" : darkRatio >= 0.45 ? "dark" : "mixed";

/** @type {'lockup'|'wordmark'|'mark'} */
let mode = "mark";
if (aspect >= 1.65) mode = "wordmark";
else if (plate === "light" || (aspect >= 0.85 && aspect <= 1.25 && whiteRatio >= 0.25)) {
  mode = "lockup"; // square/near-square with readable plate — not a 40px favicon
}

const navTheme = plate === "light" ? "light" : "dark";
const logoOnly = mode === "lockup" || mode === "wordmark";

let logoImgClass = "h-10 w-10 shrink-0 object-contain";
if (mode === "lockup") {
  // Was crushed to 40² — give the plate real presence
  logoImgClass = "h-12 w-auto max-h-14 max-w-[11rem] sm:h-14 sm:max-w-[13rem] shrink-0 object-contain";
} else if (mode === "wordmark") {
  logoImgClass = "h-9 w-auto max-h-11 max-w-[12rem] sm:h-10 sm:max-w-[14rem] shrink-0 object-contain";
} else if (Math.min(w, h) < 96) {
  // Tiny source mark — display larger than intrinsic pixel density suggests
  logoImgClass = "h-11 w-11 sm:h-12 sm:w-12 shrink-0 object-contain";
} else if (mode === "mark" && Math.min(w, h) >= 128) {
  // Large square brand icon — readable alone; redundant shortName reads as a bug
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
  plate,
  mode,
  navTheme,
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
      // insert after shortName line
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
  `LOGO_NAV=PASS slug=${slug} plate=${plate} mode=${mode} navTheme=${navTheme} logoOnly=${logoOnly}`,
);
console.log(`  ${outPath}`);
process.exit(0);
