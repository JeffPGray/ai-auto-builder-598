#!/usr/bin/env node
/**
 * Deterministic favicon / app-icon generator.
 *
 * WHY THIS EXISTS: build/SKILL.md's "Logo & favicon" section has documented
 * the roundel-vs-wordmark rule since before this script existed, and it was
 * STILL silently skipped on a real build (2026-08-17: shipped with the
 * scaffold's stale default favicon.ico, zero app/icon.png or app/icon.svg).
 * The bundled global `web-asset-generator` skill is AskUserQuestion-driven
 * and cannot run headless inside the pipeline — almost certainly why the
 * step never fired. A rule the model has to remember every time is not a
 * gate; a script that runs every time is. Same lesson as richness-check.mjs.
 *
 * Rule (unchanged from build/SKILL.md):
 *   - real logo, shape roundel|square, not grade:rejected -> app/icon.png
 *     (letterboxes fine into a square)
 *   - anything else (horizontal-wordmark, stacked, no logo, rejected)
 *     -> app/icon.svg monogram, business initial on the accent colour
 * Either branch deletes the scaffold's stale app/favicon.ico.
 *
 * Usage: node scripts/generate-favicon.mjs <client-slug>
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/generate-favicon.mjs <client-slug>");
  process.exit(1);
}

const root = process.cwd();
const clientDir = path.join(root, "clients", slug);
const appDir = path.join(clientDir, "site", "src", "app");
const gatheredPath = path.join(clientDir, "data", "gathered-content.md");
const staleIco = path.join(appDir, "favicon.ico");

function parseBrandBlock(md) {
  // Split on top-level "## " headings rather than a single regex with a
  // "\n?$" end-of-string alternative — under the /m flag, $ matches the end
  // of EVERY line, so "\n?$" was matching after the block's very first
  // line and truncating the capture there. Splitting sidesteps the anchor
  // entirely.
  const sections = md.split(/\n(?=## )/);
  const brandSection = sections.find((s) => /^## Brand\b/.test(s.trim()));
  if (!brandSection) return null;
  const block = brandSection.replace(/^## Brand\s*/, "");
  const logoMatch = block.match(/Logo:\s*(\S+)/);
  const shapeMatch = block.match(/shape:\s*([a-z-]+)/i);
  const gradeMatch = block.match(/grade:\s*([a-z]+)/i);
  if (!logoMatch) return null;
  return {
    logoPath: logoMatch[1].trim(),
    shape: shapeMatch ? shapeMatch[1].trim().toLowerCase() : null,
    rejected: gradeMatch ? gradeMatch[1].trim().toLowerCase() === "rejected" : false,
  };
}

function extractBizName(md) {
  const m = md.match(/^#\s*(?:Gathered Content\s*[—-]\s*)?(.+)$/m);
  return m ? m[1].trim() : slug;
}

function extractAccentHex(globalsCssPath) {
  if (!fs.existsSync(globalsCssPath)) return "#111111";
  const css = fs.readFileSync(globalsCssPath, "utf8");
  const m =
    css.match(/--accent-fill-bright:\s*(#[0-9a-fA-F]{3,8})/) ||
    css.match(/--accent:\s*(#[0-9a-fA-F]{3,8})/) ||
    css.match(/--accent-fill:\s*(#[0-9a-fA-F]{3,8})/);
  return m ? m[1] : "#111111";
}

function monogramSvg(letter, hex) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${hex}"/>
  <text x="32" y="45" font-family="system-ui, -apple-system, sans-serif" font-weight="700"
        font-size="34" fill="#ffffff" text-anchor="middle">${letter}</text>
</svg>
`;
}

async function main() {
  if (!fs.existsSync(gatheredPath)) {
    throw new Error(`No gathered-content.md for ${slug} at ${gatheredPath}`);
  }
  const md = fs.readFileSync(gatheredPath, "utf8");
  const brand = parseBrandBlock(md);
  const bizName = extractBizName(md);
  const initial = (bizName.replace(/^(the|a|an)\s+/i, "").trim()[0] || "?").toUpperCase();
  const accentHex = extractAccentHex(path.join(appDir, "globals.css"));

  const useRealLogo =
    brand && !brand.rejected && (brand.shape === "roundel" || brand.shape === "square");

  const pngOut = path.join(appDir, "icon.png");
  const svgOut = path.join(appDir, "icon.svg");

  if (useRealLogo) {
    const logoAbs = path.join(clientDir, brand.logoPath);
    if (!fs.existsSync(logoAbs)) throw new Error(`Logo not found at ${logoAbs}`);
    await sharp(logoAbs)
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(pngOut);
    if (fs.existsSync(svgOut)) fs.unlinkSync(svgOut);
    console.log(`[generate-favicon] ${slug}: wrote icon.png from real logo (shape=${brand.shape})`);
  } else {
    fs.writeFileSync(svgOut, monogramSvg(initial, accentHex));
    if (fs.existsSync(pngOut)) fs.unlinkSync(pngOut);
    console.log(
      `[generate-favicon] ${slug}: wrote icon.svg monogram "${initial}" on ${accentHex} ` +
        `(shape=${brand?.shape ?? "none"}, rejected=${brand?.rejected ?? "n/a"})`,
    );
  }

  if (fs.existsSync(staleIco)) {
    fs.unlinkSync(staleIco);
    console.log(`[generate-favicon] ${slug}: removed stale scaffold favicon.ico`);
  }
}

main().catch((err) => {
  console.error(`[generate-favicon] FAILED for ${slug}:`, err.message);
  process.exit(1);
});
