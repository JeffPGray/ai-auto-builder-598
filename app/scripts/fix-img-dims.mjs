#!/usr/bin/env node
/**
 * fix-img-dims.mjs <client-slug> [--dry-run]
 *
 * Mechanically adds missing width/height to <img> tags in a client's site source, reading the
 * REAL pixel dimensions off the actual file in public/images/ via sharp — no model call, no
 * guessing. This is the exact defect richness-check.mjs's `[cls]` warning flags (see its
 * `undim` filter, ~line 303) — closing it here means a build never spends a turn on it.
 *
 * Only handles the case that accounts for the overwhelming majority of real hits: a literal
 * string src pointing at a file under public/images/ (`src="/images/foo.webp"` or the same in a
 * template literal with no interpolation). A dynamic/interpolated src (`src={`/images/${x}.webp`}`)
 * is left alone and reported — those need per-case judgement, not a mechanical fix.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) { console.error('usage: fix-img-dims.mjs <client-slug> [--dry-run]'); process.exit(1); }

const siteDir = join('clients', slug, 'site');
const srcDir = join(siteDir, 'src');
if (!existsSync(srcDir)) { console.error(`no source at ${srcDir}`); process.exit(2); }

const require = createRequire(join(process.cwd(), siteDir, 'package.json'));
let sharp;
try { sharp = require('sharp'); }
catch { console.error('sharp not resolvable from the client site — run npm install there first'); process.exit(3); }

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(p);
  }
  return out;
}
const files = walk(srcDir);

const IMG_TAG = /<img\b[^>]*>/g;
const SRC_LITERAL = /\bsrc=(?:"([^"]+)"|\{`([^`$]+)`\})/;
const HAS_WIDTH = /\bwidth=/;
const HAS_HEIGHT = /\bheight=/;

let totalFixed = 0, totalSkipped = 0;
const skippedDetail = [];

async function run() {
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const tags = [...text.matchAll(IMG_TAG)].map((m) => m[0]);
    if (!tags.length) continue;

    let next = text;
    for (const tag of tags) {
      if (HAS_WIDTH.test(tag) && HAS_HEIGHT.test(tag)) continue;

      const m = tag.match(SRC_LITERAL);
      const relSrc = m && (m[1] || m[2]);
      if (!relSrc || !relSrc.startsWith('/images/')) {
        totalSkipped++;
        skippedDetail.push(`${file}: <img> has no literal /images/ src (dynamic or missing) — needs manual fix`);
        continue;
      }

      const fsPath = join(siteDir, 'public', relSrc.replace(/^\//, ''));
      if (!existsSync(fsPath)) {
        totalSkipped++;
        skippedDetail.push(`${file}: ${relSrc} has no matching file on disk`);
        continue;
      }

      let meta;
      try { meta = await sharp(fsPath).metadata(); }
      catch (e) { skippedDetail.push(`${file}: sharp failed reading ${relSrc} (${e.message})`); totalSkipped++; continue; }
      if (!meta.width || !meta.height) { skippedDetail.push(`${file}: ${relSrc} has no readable dimensions`); totalSkipped++; continue; }

      let fixedTag = tag.replace(/\s+(\/?>)$/, '$1'); // trim trailing space before inserting, avoids a double space
      if (!HAS_WIDTH.test(fixedTag)) fixedTag = fixedTag.replace(/\/?>$/, ` width={${meta.width}}$&`);
      if (!HAS_HEIGHT.test(fixedTag)) fixedTag = fixedTag.replace(/\/?>$/, ` height={${meta.height}}$&`);

      next = next.replace(tag, fixedTag);
      totalFixed++;
      console.log(`  FIX: ${file}  ${relSrc} -> width={${meta.width}} height={${meta.height}}`);
    }

    if (next !== text && !DRY) writeFileSync(file, next);
  }

  if (skippedDetail.length) {
    console.log(`\n  ${skippedDetail.length} tag(s) left untouched (need manual fix, not mechanical):`);
    for (const d of skippedDetail) console.log(`    SKIP: ${d}`);
  }
  console.log(`\n  ${totalFixed} <img> tag(s) fixed${DRY ? ' (dry run, no files written)' : ''}, ${totalSkipped} skipped.\n`);
}

run();
