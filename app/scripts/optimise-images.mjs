#!/usr/bin/env node
/**
 * optimise-images.mjs <client-slug> [--dry-run] [--quality N]
 *
 * Resizes and converts every gathered photo to WebP before the site is built.
 *
 * WHY THIS IS NOT OPTIONAL. These sites are `output: 'export'`, so **`next/image` optimisation is
 * not available** — there is no server to resize on request. Whatever `/gather` downloaded is
 * byte-for-byte what a business owner's phone downloads on cell data. Nothing else in the pipeline
 * shrinks it.
 *
 * Measured on the live demolition-okc build, 2026-08-16:
 *
 *   PageSpeed desktop  100 / 100 / 100
 *   PageSpeed MOBILE    77  — LCP 5.3s, Speed Index 4.7s
 *   "Improve image delivery — Est savings of 748 KiB"
 *   hero.jpg alone:    790 KB          total images: 2,521 KB
 *
 * Desktop scored a perfect 100 on the same page, which is exactly why this needed a script and not
 * a guideline: on a fast pipe the weight is invisible, and the number that decides whether an owner
 * bounces is the one nobody looks at.
 *
 * WHY WEBP AND NOT AVIF: AVIF compresses better but encodes an order of magnitude slower, and at
 * 50-100 builds/day that cost lands on every build. WebP is ~25-35% smaller than JPEG at matched
 * quality with universal support (Safari since 14). AVIF is a later upgrade, not a blocker.
 *
 * ORIGINALS ARE KEPT. `data/images/` stays the source of truth (build skill § copy step), so a
 * re-run is idempotent and a bad conversion is always recoverable. Only the copy under
 * `site/public/images/` is replaced.
 */
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const qIdx = args.indexOf('--quality');
const QUALITY = qIdx !== -1 ? Number(args[qIdx + 1]) : 72;  // 72 is the knee: below it artefacts show on photos
const slug = args.find((a) => !a.startsWith('--') && a !== String(QUALITY));

if (!slug) {
  console.error('usage: optimise-images.mjs <client-slug> [--dry-run] [--quality N]');
  process.exit(1);
}

const src = join('clients', slug, 'data', 'images');
const dest = join('clients', slug, 'site', 'public', 'images');
if (!existsSync(src)) { console.error(`no images at ${src}`); process.exit(2); }

/* sharp resolves from the CLIENT SITE, not from app/ — the pipeline installs it there. Requiring it
 * from this script's own root fails on a machine where app/ has no node_modules, which is the normal
 * state after the post-deploy prune. */
const require = createRequire(join(process.cwd(), join('clients', slug, 'site'), 'package.json'));
let sharp;
try { sharp = require('sharp'); }
catch { console.error('sharp not resolvable from the client site — run npm install there first'); process.exit(3); }

/* RESPONSIVE VARIANTS, not one file.
 *
 * Format conversion alone does not solve this, and measuring proved it: hero.jpg is 1920x1285 at
 * 792KB, so the resize is a no-op, and demolition rubble is high-entropy detail that compresses
 * badly — WebP at q82 saved 2%, and even q55 only reached 481KB. Meanwhile PageSpeed gave the same
 * page 100 on desktop and 77 on mobile.
 *
 * That split is the whole answer: the waste is not the FORMAT, it is a phone downloading a 1920px
 * hero to paint it into a 390px viewport. So emit a ladder of widths and let the browser choose.
 * A 640px hero lands around 90KB — that is the mobile LCP fix, and it is worth roughly ten times
 * what any quality tweak buys. */
const LADDER = [640, 1024, 1600, 1920];

/* Width caps by ROLE, matched to the largest size each image is ever rendered at. A hero spans the
 * viewport so it earns 1920; a card thumbnail never exceeds ~600 CSS px, and shipping a 1600px file
 * into a 600px box is pure waste that no amount of compression recovers. */
const roleWidth = (name) => {
  const n = name.toLowerCase();
  if (n.includes('hero')) return 1920;
  if (n.includes('logo')) return 640;          // logos stay PNG for transparency; see below
  if (/^work|gallery|project/.test(n)) return 1200;
  return 1000;
};

mkdirSync(dest, { recursive: true });
const files = readdirSync(src).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));

// Encode with bounded concurrency (Fable consult, 2026-08-19) instead of one file fully awaited
// before the next starts. sharp/libvips releases the event loop during its native encode work, so
// files genuinely overlap; effort:6 (the deliberately slow setting) is exactly where this matters
// most. Bounded at 4, not unbounded — libvips has its own internal thread pool per operation, so
// firing everything at once would oversubscribe rather than help. Each file's own per-width loop
// stays sequential (variants of the same photo share no benefit from overlapping).
async function processFile(f) {
  const inPath = join(src, f);
  const kbIn = statSync(inPath).size / 1024;
  const stem = basename(f, extname(f));
  const isLogo = stem.toLowerCase().includes('logo');
  const isPng = extname(f).toLowerCase() === '.png';

  /* Logos keep their PNG: they carry alpha and sit on varying surfaces, and a WebP logo that loses
   * transparency is far more visible than the handful of KB it saves. They are already small. */
  if (isLogo && isPng) {
    if (!DRY) copyFileSync(inPath, join(dest, f));
    return [f, kbIn, kbIn, 'kept (logo/alpha)'];
  }

  const cap = roleWidth(stem);
  const meta = DRY ? { width: cap } : await sharp(inPath).metadata();
  const widths = LADDER.filter((w) => w <= Math.min(cap, meta.width || cap));
  if (!widths.length) widths.push(Math.min(cap, meta.width || cap));

  const outName = `${stem}.webp`;                 // the largest variant keeps the plain name
  const outPath = join(dest, outName);

  // Cache skip: if every variant this source needs already exists and is newer than the source
  // photo, the `sharp().webp({effort:6})` encode (the slow setting, deliberately) is pure repeat
  // work — every resume/re-run of this client re-encoded every photo from scratch even when
  // nothing about the source or the width ladder had changed. inPath itself never changes after
  // gather, so mtime comparison is a safe, sufficient cache key (no hash needed).
  const srcMtime = statSync(inPath).mtimeMs;
  const allVariantsFresh = !DRY && widths.every((w) => {
    const p = w === widths[widths.length - 1] ? outPath : join(dest, `${stem}-${w}.webp`);
    return existsSync(p) && statSync(p).mtimeMs >= srcMtime;
  });

  if (!DRY && !allVariantsFresh) {
    for (const w of widths) {
      const isLargest = w === widths[widths.length - 1];
      await sharp(inPath)
        .rotate()                                 // honour EXIF; scraped photos are often rotated
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 6 })    // effort 6: slower encode, ~8% smaller, build-time only
        .toFile(isLargest ? outPath : join(dest, `${stem}-${w}.webp`));
    }
    // Remove the superseded original from public/ so the old bytes cannot ship alongside.
    for (const ext of ['.jpg', '.jpeg', '.png']) {
      const stale = join(dest, stem + ext);
      if (existsSync(stale)) unlinkSync(stale);
    }
  }
  const kbOut = DRY ? kbIn : widths.reduce((n, w) => {
    const f2 = w === widths[widths.length - 1] ? outPath : join(dest, `${stem}-${w}.webp`);
    return n + (existsSync(f2) ? statSync(f2).size / 1024 : 0);
  }, 0);
  const variantNote = `${widths.join('/')}px`;
  const note = DRY ? '(dry run)' : allVariantsFresh
    ? `-> ${stem}.webp @ ${variantNote} (cached, source unchanged)`
    : `-> ${stem}.webp @ ${variantNote}`;
  return [f, kbIn, kbOut, note];
}

// Bounded-concurrency pool: CONCURRENCY files in flight at once, preserving each file's own
// sequential per-width encode. Simple manual pool (no new dependency) — a worker pulls the next
// unclaimed file as soon as its previous one finishes.
const CONCURRENCY = 4;
const rows = new Array(files.length);
let nextIndex = 0;
async function worker() {
  while (nextIndex < files.length) {
    const i = nextIndex++;
    rows[i] = await processFile(files[i]);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

let before = 0, after = 0;
for (const [, kbIn, kbOut] of rows) { before += kbIn; after += kbOut; }

for (const [f, i, o, note] of rows) {
  const pct = i > 0 ? Math.round((1 - o / i) * 100) : 0;
  console.log(`  ${f.padEnd(24)} ${String(Math.round(i)).padStart(5)}KB -> ${String(Math.round(o)).padStart(5)}KB  ${String(pct).padStart(3)}%  ${note}`);
}
console.log(`\n  TOTAL ${Math.round(before)}KB -> ${Math.round(after)}KB (${Math.round((1 - after / before) * 100)}% smaller)`);
console.log('  Reference images as .webp in the TSX. Originals kept in data/images/ — re-runnable.\n');
