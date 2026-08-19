#!/usr/bin/env node
/**
 * fix-dashes.mjs <client-slug> [--dry-run]
 *
 * Mechanically replaces banned em-dashes (—, U+2014) and en-dashes (–, U+2013) in a client's
 * site source with house-style-safe punctuation — no model call. This is the exact defect the
 * build skill's own incremental check flags (§ Incremental per-file check, the
 * `\xe2\x80\x94|\xe2\x80\x93` grep) and the exact one round-1 QA caught tonight on cold-front-ac
 * (5 instances, one per blog article) — closing it mechanically means a build never burns a turn
 * re-writing a sentence just to remove a dash character.
 *
 * Scope, deliberately narrow: only touches .tsx/.ts files under site/src (reader-visible copy).
 * Skips JSX/JS comments (// ... and /* ... *\/) so in-code notes aren't mangled.
 *
 * Replacement rule (mechanical, not a rewrite):
 *   - em-dash " — " (dash with surrounding space, the overwhelmingly common form in prose)
 *     -> ", " (comma) — the safest universal substitute for a parenthetical/appositive break.
 *   - en-dash between two digits (a range, e.g. "9–5", "Mon-Fri 9–5") -> plain hyphen "-".
 *   - any other em/en-dash (no surrounding space, not a digit range) -> plain hyphen "-".
 * This is intentionally conservative — it never tries to restructure a sentence, it substitutes
 * punctuation. A build can still choose to write better prose around it; this closes the
 * mechanical defect so QA doesn't need a model turn for a punctuation-only fix.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) { console.error('usage: fix-dashes.mjs <client-slug> [--dry-run]'); process.exit(1); }

const srcDir = join('clients', slug, 'site', 'src');

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

// Strip comments to a same-length blank mask so indices still line up with the real source,
// without touching the source itself — comments are never reader-visible copy.
function maskComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const EM = '—';
const EN = '–';

let totalFixed = 0;
const files = walk(srcDir);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(EM) && !text.includes(EN)) continue;

  const mask = maskComments(text);
  let next = '';
  let fixedHere = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isDash = ch === EM || ch === EN;
    const isCode = mask[i] === ' ' && (text[i] === EM || text[i] === EN) ? mask[i] !== text[i] : false;
    // mask[i] is a space wherever a comment was stripped; if the real char is a dash AND the
    // mask position is blanked, this dash lives inside a comment — leave it untouched.
    const inComment = mask[i] !== text[i] && mask[i] === ' ';

    if (!isDash || inComment) { next += ch; continue; }

    const prev = text[i - 1], nextCh = text[i + 1];
    if (ch === EM) {
      if (prev === ' ' && nextCh === ' ') {
        // " — " -> ", " — drop the space we already emitted for `prev` so the comma sits
        // directly against the preceding word, not " ," with a stray leading space.
        next = next.replace(/ $/, '') + ', ';
        i++; // consume the trailing space too, we've already appended its replacement
        fixedHere++;
      } else { next += '-'; fixedHere++; }
    } else { // EN
      next += '-'; fixedHere++; // digit-range or bare — either way a plain hyphen is correct
    }
  }

  if (fixedHere > 0) {
    totalFixed += fixedHere;
    console.log(`  FIX: ${file}  ${fixedHere} dash(es) replaced`);
    if (!DRY) writeFileSync(file, next);
  }
}

console.log(`\n  ${totalFixed} dash(es) fixed across ${files.length} file(s) scanned${DRY ? ' (dry run, no files written)' : ''}.\n`);
