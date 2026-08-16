#!/usr/bin/env node
/**
 * verify-photos.mjs <client-slug> [--json]
 *
 * HARD GATE: every image the site actually uses must be one gather positively cleared.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * On 2026-08-16 the abacus-plumbing build put `gmaps5` — a photograph of two people in horror-clown
 * makeup with blood-spattered hands — on the HOME PAGE and in a blog article of a Houston plumbing
 * company. It was caught by QA round 2, ninety minutes in, after fourteen routes had been written
 * around it. One more missed round and it goes to a real business owner under Gray Reserve's name.
 *
 * The infuriating part: **gather had already flagged it, in plain text, before the build started.**
 *
 *     /images/gmaps5.jpg  - 1042x1275 portrait - (not yet verified)
 *     Usable hero candidates: gmaps2, gmaps6
 *     Usable work photos: gmaps1, gmaps4, gmaps7, gmaps8
 *
 * gmaps5 is in no usable list and is explicitly unverified. The build used it regardless. So the
 * most expensive detector we own — a model looking at a rendered screenshot, two QA rounds deep —
 * was catching something a string comparison could have caught in 40 milliseconds.
 *
 * That is the whole justification. This does not replace the vision judgement (only a model can
 * decide what a photo DEPICTS, which is why § PHOTO VISION GATE in the gather skill exists). It
 * enforces that the judgement gather already made is actually OBEYED downstream.
 *
 * ── FAIL-CLOSED, DELIBERATELY ───────────────────────────────────────────────────────────────────
 * An image referenced by the site but absent from gathered-content.md is a FAIL, not a pass. The
 * alternative — treating "unknown" as "fine" — is precisely how the clown shipped. The escape hatch
 * for a legitimately new image is to document it in gathered-content.md, which is where a human or
 * a later QA run can see it.
 *
 * Exit 0 = pass. Exit 1 = at least one used photo is unverified/rejected/unknown. Exit 2 = misuse.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const JSON_OUT = args.includes('--json');

if (!slug) {
  console.error('usage: verify-photos.mjs <client-slug> [--json]');
  process.exit(2);
}

const clientDir = join(process.cwd(), 'clients', slug);
const gathered = join(clientDir, 'data', 'gathered-content.md');
const srcDir = join(clientDir, 'site', 'src');

if (!existsSync(gathered)) {
  console.error(`FAIL: ${gathered} not found — cannot verify photos without gather's verdicts.`);
  process.exit(1);
}
if (!existsSync(srcDir)) {
  console.error(`FAIL: ${srcDir} not found — nothing built yet.`);
  process.exit(1);
}

const md = readFileSync(gathered, 'utf8');

/* Phrases that mean "gather did NOT clear this". Matched case-insensitively against the photo's own
 * line. Kept explicit rather than clever: a regex that tries to infer approval from prose will
 * eventually approve something, and the whole point here is to fail closed. */
const REJECT_MARKERS = [
  'not yet verified', 'not verified', 'unverified',
  'too small', 'unclear', 'unusable', 'do not use', "don't use",
  'rejected', 'stock', 'irrelevant', 'unrelated', 'off-brand',
];

const stemOf = (s) => s.toLowerCase().replace(/\.(jpg|jpeg|png|webp|avif)$/i, '').replace(/^.*\//, '');

/** Photo stems gather explicitly listed as usable, e.g. "Usable work photos: gmaps1, gmaps4". */
const usable = new Set();
for (const line of md.split('\n')) {
  const m = line.match(/^\s*usable[^:]*:\s*(.+)$/i);
  if (!m) continue;
  for (const tok of m[1].split(/[,;]/)) {
    // Drop parenthetical asides: "gmaps2 (landscape van)" -> "gmaps2"
    const stem = stemOf(tok.trim()).split(/[\s(]/)[0];
    if (stem) usable.add(stem);
  }
}

/** Per-photo lines: "- /images/gmaps5.jpg - 1042x1275 portrait - (not yet verified)" */
const verdict = new Map(); // stem -> { ok, why }
for (const line of md.split('\n')) {
  const m = line.match(/\/images\/([A-Za-z0-9_\-.]+?)\.(?:jpg|jpeg|png|webp)\b/i);
  if (!m) continue;
  const stem = m[1].toLowerCase();
  const lower = line.toLowerCase();
  const hit = REJECT_MARKERS.find((r) => lower.includes(r));
  if (hit) verdict.set(stem, { ok: false, why: `gather marked it "${hit}"` });
  else if (!verdict.has(stem)) verdict.set(stem, { ok: true, why: 'described by gather' });
}

// An explicit "Usable ..." listing is the strongest positive signal and wins over a bare description.
for (const stem of usable) verdict.set(stem, { ok: true, why: 'listed as usable by gather' });

/* Every image the SITE references. Walk the built source, not the public/ directory — an unused
 * file sitting in public/ harms nobody; a referenced one is on the page. */
const referenced = new Map(); // stem -> Set(files)
const CODE = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.mdx']);
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!CODE.has(extname(p))) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/\/images\/([A-Za-z0-9_\-.]+?)\.(?:jpg|jpeg|png|webp|avif)\b/gi)) {
      // strip responsive-variant suffixes produced by optimise-images (name-640, name-1024...)
      const stem = m[1].toLowerCase().replace(/-(?:640|1024|1600|1920)$/, '');
      if (!referenced.has(stem)) referenced.set(stem, new Set());
      referenced.get(stem).add(p.replace(`${clientDir}/`, ''));
    }
  }
})(srcDir);

const fails = [];
const passes = [];
for (const [stem, files] of [...referenced].sort()) {
  if (/^logo|^icon|^favicon/.test(stem)) continue;           // brand assets, graded by § Logo
  const v = verdict.get(stem);
  if (!v) fails.push({ stem, why: 'NOT MENTIONED in gathered-content.md at all', files: [...files] });
  else if (!v.ok) fails.push({ stem, why: v.why, files: [...files] });
  else passes.push({ stem, why: v.why });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ slug, pass: fails.length === 0, fails, passes }, null, 2));
} else {
  for (const p of passes) console.log(`  ok    ${p.stem.padEnd(14)} ${p.why}`);
  for (const f of fails) {
    console.log(`  FAIL  ${f.stem.padEnd(14)} ${f.why}`);
    for (const file of f.files) console.log(`          used in ${file}`);
  }
  console.log(
    `\nPHOTO_CHECK=${fails.length === 0 ? 'PASS' : 'FAIL'}  ` +
    `(${passes.length} cleared, ${fails.length} not cleared, of ${referenced.size} referenced)`
  );
  if (fails.length) {
    console.log('\n  Every photo on the site must be one gather positively cleared. Fix by either:');
    console.log('    1. swapping the reference to a photo listed as usable in gathered-content.md, or');
    console.log('    2. Reading the image yourself, and if it genuinely depicts the business,');
    console.log('       recording that verdict in gathered-content.md so the decision is on the record.');
    console.log('  Do NOT silence this by deleting the line — the whole point is that the verdict is written down.');
  }
}

process.exit(fails.length ? 1 : 0);
