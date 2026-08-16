#!/usr/bin/env node
/**
 * design-ledger.mjs check <slug> --ground <family> --ground-hue <deg> --formula <1-5>
 *                    [--harmony <type>] [--character <band>]
 * design-ledger.mjs record <slug> --ground <family> --ground-hue <deg> --formula <1-5>
 *                    [--harmony <type>] [--character <band>]
 *
 * Cross-build convergence check — ported from gr-no-website-builds's feelsTooClose()
 * (frame-spec-render/composer/art-director.mjs:1616), adapted to klaudius's own axes and to
 * klaudius's own cost model.
 *
 * ── WHY IT RUNS AT DESIGN-CHOICE TIME, NOT POST-BUILD (the one real change from the source
 * pattern, and it is load-bearing) ──
 * The sibling repo's version fires AFTER a full HTML document is generated and forces a REGEN —
 * measured there at 5-10 minutes per full-document re-emission, which is exactly what turns a
 * 23-minute build into 46. Klaudius's own measured cost is 86% output-token generation (2026-08-16).
 * A twin caught before a single TSX file is written costs nothing to fix — the build skill just
 * picks a different masked option and calls `check` again. A twin caught after the site is written
 * costs a full rebuild. So: call this once the design decisions (ground, formula, harmony,
 * character) are made in § Colour / § Ground / § Mandatory typography formula, BEFORE any page.tsx
 * exists. There is no `--regen` mode here on purpose — regenerating already-written code is a
 * /qa-fix concern, not this script's.
 *
 * ── WHY REGISTER, NOT EXACT MATCH (the sibling's own hard-won lesson, ported verbatim) ──
 * An exact-name/exact-value check is escaped by wearing a different LABEL in the identical visual
 * class — the sibling caught a build that swapped font family names but kept "heavy geometric
 * display sans propped on a mono", which a viewer reads as the same type anyway. Ported here as:
 * hue compared in 30° bins (not exact hex/degree equality), typography compared by FORMULA NUMBER
 * (1-5, the visual class from build/SKILL.md's § typography formula) rather than by font family
 * name — two different font names in the same formula number are the same register to a viewer.
 *
 * ── WEIGHTS ── ground family + formula number are DOMINANT (a viewer's strongest signal for "have
 * I seen this site before"); ground-hue bin, harmony, and character are supporting. A score >= 5
 * against any of the last 10 builds is a twin — mirrors the source's own threshold and its own
 * reasoning ("2 dominant axes, or all three").
 *
 * Cap: last 40 fingerprints, oldest evicted — same cap as the sibling's fingerprints.json, for the
 * same reason (a design memory this long is enough to prevent an obvious run of twins without
 * needing unbounded storage).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CAP = 40;
const TWIN_THRESHOLD = 5;
const LEDGER = join(process.cwd(), 'data', 'design-fingerprints.json');

const args = process.argv.slice(2);
const mode = args[0];
const slug = args[1];
const opt = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

if (!['check', 'record'].includes(mode) || !slug) {
  console.error('usage: design-ledger.mjs check|record <slug> --ground <family> --ground-hue <deg> --formula <1-5> [--harmony <type>] [--character <band>]');
  process.exit(2);
}

const fp = {
  slug,
  ground: opt('ground'),
  hueBin: opt('ground-hue') != null ? Math.floor(((Number(opt('ground-hue')) % 360) + 360) % 360 / 30) * 30 : null,
  formula: opt('formula') != null ? Number(opt('formula')) : null,
  harmony: opt('harmony'),
  character: opt('character'),
  ts: opt('ts', null), // caller may stamp; script itself must not call Date.now() when run from a workflow
};
if (!fp.ground || fp.hueBin == null || fp.formula == null) {
  console.error('missing required fields: --ground, --ground-hue, --formula are all mandatory');
  process.exit(2);
}

function load() {
  if (!existsSync(LEDGER)) return [];
  try {
    const d = JSON.parse(readFileSync(LEDGER, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch {
    // A corrupt ledger must never crash the build — fail open to "no history", not to a thrown error.
    console.error('design-ledger: ledger file unreadable, treating as empty');
    return [];
  }
}

function score(a, b) {
  let s = 0;
  if (a.ground === b.ground) s += 2;      // dominant — the ground family is the strongest "have I seen this" signal
  if (a.formula === b.formula) s += 2;    // dominant — same typography REGISTER (not name)
  if (a.hueBin === b.hueBin) s += 1;
  if (a.harmony && b.harmony && a.harmony === b.harmony) s += 1;
  if (a.character && b.character && a.character === b.character) s += 1;
  return s;
}

const recent = load();

if (mode === 'check') {
  let twin = null;
  let best = 0;
  for (const r of recent.slice(0, 10)) {
    if (r.slug === slug) continue; // never compare a build against its own prior fingerprint (a re-run of the same client)
    const s = score(fp, r);
    if (s > best) best = s;
    if (s >= TWIN_THRESHOLD) { twin = r; break; }
  }
  if (twin) {
    console.log(`TWIN of ${twin.slug} (score ${best}/7): ground=${fp.ground} formula=${fp.formula} hueBin=${fp.hueBin} vs ground=${twin.ground} formula=${twin.formula} hueBin=${twin.hueBin}`);
    console.log('DESIGN_LEDGER=TWIN');
    console.log('Pick a different option from the trade-masked set (a different ground family, a different typography formula, or a materially different ground hue) and check again.');
    process.exit(1);
  }
  console.log(`No twin found (closest score ${best}/${TWIN_THRESHOLD + 2}). Safe to proceed.`);
  console.log('DESIGN_LEDGER=CLEAR');
  process.exit(0);
}

if (mode === 'record') {
  const next = [fp, ...recent.filter((r) => r.slug !== slug)].slice(0, CAP);
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(next, null, 2));
  console.log(`recorded ${slug} -> ${LEDGER} (${next.length}/${CAP} entries)`);
}
