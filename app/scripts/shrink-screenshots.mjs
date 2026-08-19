#!/usr/bin/env node
/**
 * shrink-screenshots.mjs <client-slug> [--width 900] [--quality 72] [--dry-run]
 *
 * Downscale QA screenshots BEFORE the reviewer reads them visually.
 *
 * WHY THIS EXISTS — it is a context-budget fix, not a disk fix.
 *
 * Measured 2026-08-16 on the abacus-plumbing QA subagent: its context held 21 image blocks
 * totalling 2.74 MB, which was **89.4% of everything in that subagent** (tool output 0.30 MB, text
 * 0.03 MB). The subagent then hit auto-compaction mid-review — visible from the outside as the
 * build going completely silent, because a parent session writes NOTHING to its own transcript for
 * the entire time a sub-agent is running. Jeff has seen this on every build since build 3 and
 * reasonably read it as a hang.
 *
 * It is not a hang, and it is not the MCP idle-hang either. It is the QA reviewer drowning in its
 * own screenshots, then paying for a compaction to keep going — once per QA round, up to 3 rounds.
 *
 * WHY DOWNSCALING IS SAFE HERE, AND WHERE IT WOULD NOT BE.
 * QA's visual review asks layout questions: is the nav above the fold, is a column ragged, is a
 * photo cropped through someone's face, does the subpage hold the same standard as the home page.
 * None of that needs 1:1 pixels — a 900px-wide render answers every one of them. What downscaling
 * WOULD break is pixel-level work, so this deliberately does NOT touch:
 *   - contrast-check.mjs / --tokens  (samples RENDERED PIXELS; resampling shifts colour values)
 *   - font-check.mjs                 (proves a webface actually loaded)
 *   - the gallery-void measurement   (a geometry measurement, computed from the DOM)
 * Those are all deterministic scripts that read the page directly, never these files. Keeping them
 * off this path is the whole reason it is safe to compress what the MODEL looks at.
 *
 * ⛔ Do NOT "save more" by reducing the NUMBER of screenshots. Reviewing fewer pages and reporting
 * PASS is the single worst failure this pipeline has (qa-reviewer.md says so explicitly): it is
 * indistinguishable from a clean run and it is how unreviewed pages reach a business owner. Shrink
 * the bytes, never the coverage.
 */
import { readdirSync, statSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const num = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : Number(args[i + 1]); };

/* DEFAULTS ARE DELIBERATELY CONSERVATIVE. An earlier draft used 900px/q72; Jeff pushed back that it
 * was too aggressive and he is right — this is the gate that already let a 2/10 build through, and
 * blurring its evidence to save bytes is the worst possible trade.
 *
 * The two levers are NOT equal:
 *   - PNG -> WebP at high quality is where nearly all the saving is, and it is perceptually free on
 *     flat UI screenshots (large areas of solid colour compress enormously).
 *   - DOWNSCALING is what actually destroys evidence — hairline borders, small-caps eyebrow text,
 *     the exact thing a reviewer squints at to judge whether type looks bespoke or templated.
 * So: convert aggressively, resize barely.
 *
 * 1280 is chosen to sit ABOVE the lg: breakpoint (1024) so desktop layout is unchanged, and it is a
 * ~11% linear reduction from a 1440 shot — far too small to hide a layout defect. */
const WIDTH = num('width', 1280);
const QUALITY = num('quality', 88);
/* Mobile shots are already ~375-390px wide. Never resize those — there is nothing to gain and a
 * mobile crop defect is exactly what we are hunting. Format conversion still applies. */
const MOBILE_MAX_WIDTH = 500;
const DRY = args.includes('--dry-run');

if (!slug) {
  console.error('usage: shrink-screenshots.mjs <client-slug> [--width 900] [--quality 72] [--dry-run]');
  process.exit(2);
}

const dir = join(process.cwd(), 'clients', slug, 'site', 'qa-screenshots');
if (!existsSync(dir)) {
  // Not an error: the reviewer may not have taken shots yet, and a hard exit here would fail a QA
  // run for a reason that has nothing to do with the site.
  console.log(`  no qa-screenshots directory for ${slug} yet — nothing to shrink`);
  process.exit(0);
}

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  // Fail OPEN, loudly. A missing optional dep must not block QA — the reviewer can still read the
  // full-size PNGs, it will just cost context. Silence here would be the worse failure.
  console.log('  sharp unavailable — skipping shrink (QA will read full-size PNGs and may compact)');
  process.exit(0);
}

// qa-reviewer.md now captures directly as .webp (playwright-cli --type webp, 2026-08-18) — the
// PNG->WebP conversion this script exists for is already done at capture time for those shots, so
// matching .png too is just backward compatibility for any older/manual capture. Match both.
const shots = readdirSync(dir).filter((f) => /^qa-.*\.(png|webp)$/.test(f)).sort();
if (!shots.length) {
  console.log('  no qa-*.png/.webp screenshots found — nothing to shrink');
  process.exit(0);
}

let before = 0;
let after = 0;
let failed = 0;

for (const f of shots) {
  const src = join(dir, f);
  const b = statSync(src).size;
  before += b;

  if (DRY) { after += b; continue; }

  const isAlreadyWebp = /\.webp$/.test(f);
  const tmp = join(dir, `.${f}.tmp.webp`);
  const dest = join(dir, f.replace(/\.png$/, '.webp'));
  try {
    // Read the real width rather than trusting the filename: a shot named `qa-mobile-*` that came
    // back at desktop width (a viewport that never applied) is itself a defect worth SEEING, not
    // one to silently resize away.
    const meta = await sharp(src).metadata();
    const isMobile = (meta.width || 0) <= MOBILE_MAX_WIDTH;

    const pipe = sharp(src);
    if (!isMobile) pipe.resize({ width: WIDTH, withoutEnlargement: true });
    await pipe.webp({ quality: QUALITY }).toFile(tmp);
    renameSync(tmp, dest);
    // Only unlink src if it's a DIFFERENT path from dest (the .png -> .webp rename case). When
    // src was already .webp, dest === src (the regex above has nothing to replace), and renameSync
    // just overwrote it with the shrunk version in place — unlinking here would delete the file we
    // just created. This exact bug (self-deleting the just-written output on already-webp input)
    // is why isAlreadyWebp exists: it was live for the ~40s between the capture-side webp switch
    // and this fix, caught before any real client had screenshots run through it.
    if (!isAlreadyWebp) unlinkSync(src);
    after += statSync(dest).size;
  } catch (e) {
    // Keep the original on ANY failure. A QA review with a heavy screenshot beats a QA review with
    // a missing one — a shot that vanishes is a page that silently goes unreviewed.
    failed++;
    after += b;
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nothing useful to do */ }
    console.log(`  KEPT ${f} (shrink failed: ${e.message})`);
  }
}

const pct = before ? (100 - (after / before) * 100).toFixed(0) : '0';
console.log(
  `  ${DRY ? 'WOULD SHRINK' : 'shrank'} ${shots.length} screenshots to ${WIDTH}px/q${QUALITY}: ` +
  `${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB (${pct}% smaller)` +
  (failed ? `, ${failed} kept as PNG after errors` : '')
);
console.log('  Review the .webp files — they carry the same layout information at a fraction of the context cost.');
