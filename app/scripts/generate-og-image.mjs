#!/usr/bin/env node
/**
 * Deterministic Open Graph / Twitter share card (1200×630).
 *
 * Spec builds still need a real share preview — iMessage / Slack / LinkedIn
 * otherwise show nothing or a random page scrape. Index lift + IndexNow stay
 * on /seo at conversion; this asset ships on every build.
 *
 * Prefers design-lock CANVAS: filename, else hero-home.*, else first public image.
 * Writes public/og.jpg and prints the path for layout metadata.
 *
 * Usage: node scripts/generate-og-image.mjs <client-slug>
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/generate-og-image.mjs <client-slug>");
  process.exit(1);
}

const root = process.cwd();
const clientDir = path.join(root, "clients", slug);
const publicDir = path.join(clientDir, "site", "public");
const imagesDir = path.join(publicDir, "images");
const lockPath = path.join(clientDir, "data", "design-lock.md");
const outPath = path.join(publicDir, "og.jpg");

function canvasFromLock() {
  if (!fs.existsSync(lockPath)) return null;
  const md = fs.readFileSync(lockPath, "utf8");
  const m = md.match(/CANVAS:\s*.*?\b([a-z0-9][\w.-]+\.(?:jpe?g|png|webp))\b/i);
  return m ? m[1] : null;
}

function pickSource() {
  const candidates = [];
  const canvas = canvasFromLock();
  if (canvas) {
    candidates.push(path.join(imagesDir, canvas));
    candidates.push(path.join(clientDir, "data", "images", canvas));
  }
  for (const name of ["hero-home.jpeg", "hero-home.jpg", "hero-home.png", "hero-poster.jpg"]) {
    candidates.push(path.join(imagesDir, name));
    candidates.push(path.join(clientDir, "data", "images", name));
    candidates.push(path.join(publicDir, name));
  }
  if (fs.existsSync(imagesDir)) {
    for (const f of fs.readdirSync(imagesDir)) {
      if (/\.(jpe?g|png|webp)$/i.test(f) && !/logo/i.test(f)) {
        candidates.push(path.join(imagesDir, f));
      }
    }
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  if (!fs.existsSync(publicDir)) {
    throw new Error(`No public/ dir at ${publicDir} — copy-template first`);
  }
  const src = pickSource();
  if (!src) throw new Error(`No source image for OG card under ${imagesDir}`);

  await sharp(src)
    .rotate()
    .resize(1200, 630, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outPath);

  console.log(`[generate-og-image] ${slug}: wrote public/og.jpg from ${path.relative(clientDir, src)}`);
}

main().catch((err) => {
  console.error(`[generate-og-image] FAILED for ${slug}:`, err.message);
  process.exit(1);
});
