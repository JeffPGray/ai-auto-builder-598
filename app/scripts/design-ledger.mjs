#!/usr/bin/env node
/**
 * design-ledger.mjs check <slug> --ground <family> --ground-hue <deg> --formula <1-5>
 *                    [--harmony <type>] [--character <band>]
 *                    [--heading-font <family>] [--body-font <family>] [--town <city>]
 * design-ledger.mjs record <slug> --ground <family> --ground-hue <deg> --formula <1-5>
 *                    [--harmony <type>] [--character <band>]
 *                    [--heading-font <family>] [--body-font <family>] [--town <city>]
 *
 * ── FONT-NAME LEDGER (added 2026-08-18) ──
 * `--heading-font`/`--body-font`/`--town` are a SEPARATE, independently-reported check from the
 * ground/formula/harmony/character TWIN score above — literal font-family-name reuse and
 * formula/register similarity are different failure classes with different remedies (swap one
 * shortlist entry vs re-run the whole convergence pick), so they are scored and reported
 * separately rather than folded into `score()`'s 0-7 total. See `FONT_LEDGER=` output below.
 * This replaces build/SKILL.md's old "scan 3-4 recent client globals.css files" ad hoc uniqueness
 * step (§ How to pick fonts) with a deterministic check across full build history.
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
import { withFileLock } from './lib/file-lock.mjs';

const CAP = 40;
const TWIN_THRESHOLD = 5;
const FONT_LOOKBACK = 8;
const LEDGER = join(process.cwd(), 'data', 'design-fingerprints.json');

const args = process.argv.slice(2);
const mode = args[0];
const slug = args[1];
const opt = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

if (!['check', 'record'].includes(mode) || !slug) {
  console.error('usage: design-ledger.mjs check|record <slug> --ground <family> --ground-hue <deg> --formula <1-5> [--harmony <type>] [--character <band>] [--heading-font <family>] [--body-font <family>] [--town <city>]');
  process.exit(2);
}

// Normalises a font family for comparison: lowercase, underscores (the next/font/google import
// identifier form, e.g. `Libre_Caslon_Display`) become spaces, quotes stripped, whitespace
// collapsed — so the import identifier and the human-readable name always compare equal, and so
// do trivial spacing/quoting differences between two callers' CLI invocations.
function normFont(s) {
  if (!s) return null;
  const n = String(s).toLowerCase().replace(/_/g, ' ').replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
  return n || null;
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

// Font/town fields are optional and only ever written onto the record when actually passed —
// leaving them `undefined` (dropped by JSON.stringify) rather than `null` means an old/sparse
// record never accidentally matches another sparse record on a shared absence.
const headingFontArg = opt('heading-font');
const bodyFontArg = opt('body-font');
const townArg = opt('town');
if (headingFontArg) fp.headingFont = headingFontArg;
if (bodyFontArg) fp.bodyFont = bodyFontArg;
if (townArg) fp.town = townArg;

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

  let designFail = false;
  if (twin) {
    console.log(`TWIN of ${twin.slug} (score ${best}/7): ground=${fp.ground} formula=${fp.formula} hueBin=${fp.hueBin} vs ground=${twin.ground} formula=${twin.formula} hueBin=${twin.hueBin}`);
    console.log('DESIGN_LEDGER=TWIN');
    console.log('Pick a different option from the trade-masked set (a different ground family, a different typography formula, or a materially different ground hue) and check again.');
    designFail = true;
  } else {
    console.log(`No twin found (closest score ${best}/${TWIN_THRESHOLD + 2}). Safe to proceed.`);
    console.log('DESIGN_LEDGER=CLEAR');
  }

  // ── Font-name ledger — SEPARATE, independently-reported check (see file header). Scored and
  // exited independently of DESIGN_LEDGER above: literal font-family-name reuse is a different
  // rule (plain string equality, no threshold) from formula/register similarity, with a
  // different, cheaper remedy at this point in the build (pick a different shortlist entry,
  // zero TSX written yet). Never compare a build against its own prior record.
  const fontRecent = recent.filter((r) => r.slug !== slug).slice(0, FONT_LOOKBACK);
  let fontFail = false;

  // Heading-font reuse: hard FAIL, immediately, no calibration period — build/SKILL.md already
  // makes "never reuse the same heading font as another site" mandatory prose, and this is a
  // plain string-equality measurement with nothing to tune.
  if (fp.headingFont) {
    const collision = fontRecent.find(
      (r) => r.headingFont && normFont(r.headingFont) === normFont(fp.headingFont)
    );
    if (collision) {
      console.log(
        `FONT_LEDGER=REUSE — heading font "${fp.headingFont}" collides with ${collision.slug}'s heading font "${collision.headingFont}". Never reuse a heading font (build/SKILL.md § How to pick fonts) — pick a different shortlist entry.`
      );
      fontFail = true;
    }
  }

  // Same-town body-font reuse: WARN ONLY for now. Town-matching data quality is unverified at
  // this point (plain lowercase-normalised exact string match, no fuzzy matching) — promote this
  // to a hard FAIL once real town data proves reliable across ~10 builds. Does not set fontFail.
  if (fp.town && fp.bodyFont) {
    const townCollisions = fontRecent.filter(
      (r) =>
        r.town &&
        r.bodyFont &&
        normFont(r.town) === normFont(fp.town) &&
        normFont(r.bodyFont) === normFont(fp.bodyFont)
    );
    for (const c of townCollisions) {
      console.log(
        `FONT_LEDGER=WARN — body font "${fp.bodyFont}" was already used in ${fp.town} by ${c.slug}. Not a hard FAIL yet (town-matching data quality unverified) — neighbouring owners see each other's sites, so prefer a different body font if practical.`
      );
    }
  }

  if (!fontFail) {
    if (fp.headingFont || fp.bodyFont) {
      console.log('FONT_LEDGER=CLEAR');
    } else {
      console.log('FONT_LEDGER=SKIP (no --heading-font/--body-font passed)');
    }
  }

  process.exit(designFail || fontFail ? 1 : 0);
}

if (mode === 'record') {
  // 2026-08-18 (Fable): locked, and re-reads the ledger FRESH inside the lock rather than trusting
  // `recent` (loaded early in the script, at line ~129) — another concurrent dispatch could have
  // recorded in between. `recent` is still fine for the earlier `check` mode's TWIN comparison
  // (soft staleness there just means comparing against a slightly-older history, not a lost write).
  await withFileLock(LEDGER, () => {
    const fresh = load();
    const next = [fp, ...fresh.filter((r) => r.slug !== slug)].slice(0, CAP);
    mkdirSync(dirname(LEDGER), { recursive: true });
    writeFileSync(LEDGER, JSON.stringify(next, null, 2));
    console.log(`recorded ${slug} -> ${LEDGER} (${next.length}/${CAP} entries)`);
  });
}
