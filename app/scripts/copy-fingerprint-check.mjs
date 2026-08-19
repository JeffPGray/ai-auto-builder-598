#!/usr/bin/env node
/**
 * copy-fingerprint-check.mjs <slug>
 *
 * Gap 4 of 4 from Fable's sameness-gap design spec (SAMENESS-01/04 in .claude/ledger.json) — the
 * last of four cross-build sameness checks (typography: font-uniqueness-check.mjs; layout/section
 * rhythm: the LAYOUT_FINGERPRINT_* block inside hyperui-usage-check.mjs; transplant fidelity:
 * hyperui-transplant-check.mjs). This one is about PROSE: does this build's copy read as the same
 * VOICE as a recent one, even though every word was individually generated fresh.
 *
 * THE INSIGHT THAT KEEPS THIS AT $0 MODEL COST: real cross-build sameness at scale mostly shows up
 * as recycled PHRASE SKELETONS — "When your ⟨X⟩ breaks, you need ⟨Y⟩ who ⟨Z⟩", "Proudly serving
 * ⟨town⟩ since ⟨year⟩" — detectable by n-gram overlap AFTER masking the tokens that legitimately
 * differ per client (business name, town, owner, digits). Full semantic style comparison needs a
 * model call; this skeleton layer is what an operator actually notices reading two sites back to
 * back, and it's a deterministic string computation, same posture as every other gate in this file.
 *
 * RELATIONSHIP TO ship-scan.mjs — DELIBERATELY NOT DUPLICATED: ship-scan.mjs's SLOP_FAIL/SLOP_WARN
 * lists own the ABSOLUTE copy lexicon — phrases that are bad regardless of history ("in today's
 * fast-paced world", "look no further"). This script owns RELATIVE copy — content that is perfectly
 * fine the first time and only becomes a problem because a recent OTHER build already shipped the
 * same skeleton. Different failure mode, different data source (a cross-build ledger vs a fixed
 * phrase list), so this stays a separate script rather than growing ship-scan's lexicon.
 *
 * PIPELINE:
 *   1. Extract prose from clients/<slug>/site/out/**\/*.html — text content of h1/h2/h3/p/li/dt/dd/
 *      blockquote/a found inside the page's real <section> content, with <header>/<nav>/<footer>/
 *      <script>/<style> stripped first (same "exclude the shared chrome" reasoning
 *      hyperui-usage-check.mjs already applies when it excludes footers/headers from its citation
 *      floor — SiteNav/SiteFooter boilerplate is identical across every build almost by
 *      construction and would swamp every real comparison). 404/_not-found routes are skipped.
 *   2. MASK client-specific tokens, sourced from the client's OWN real data (gathered-content.md +
 *      site-data.ts, both read tolerantly — see § MASKING below for exactly what's recognised and
 *      the honesty limit on it) — business name (+ each word ≥4 chars) -> ⟨b⟩, town/area-served
 *      names -> ⟨t⟩, owner name (+ each name-part ≥4 chars, a deliberate extension past the letter
 *      of the spec — see § MASKING) -> ⟨n⟩, industry/trade words ≥4 chars -> ⟨x⟩ (the spec listed
 *      trade nouns among the things to mask but didn't assign them a letter; ⟨x⟩ keeps them
 *      distinct from the other three so a same-industry, different-business match is never conflated
 *      with an actual business-identity leak), any digit run -> ⟨#⟩ (covers phone numbers, years,
 *      review counts, licence numbers in one unconditional rule — no need to source these
 *      specifically, unlike the other four classes).
 *   3. SHINGLE the masked, lowercased, punctuation-stripped token stream into every 5-word window,
 *      per page (shingles never span a page boundary — see § SHINGLING), and build a MinHash sketch
 *      with 128 permutations so every client gets a FIXED-SIZE fingerprint (128 numbers) regardless
 *      of how much copy the site has. That sketch, not the raw shingle set, is what's persisted to
 *      data/design-fingerprints.json — raw shingles would bloat a file three other scripts already
 *      parse on every run (font-uniqueness-check.mjs, hyperui-usage-check.mjs,
 *      hyperui-transplant-check.mjs all read this same file).
 *   4. COMPARE pairwise against the last 8 prior builds' stored copySketch values — same
 *      `.filter(r => r.slug !== slug).slice(0, 8)` newest-first window every sibling gate in this
 *      file uses (design-ledger.mjs's `record` mode prepends, so the ledger array is already
 *      newest-first; nothing here re-sorts it). Estimated Jaccard = the fraction of the 128 sketch
 *      positions that agree between two builds.
 *   5. WARN (never FAIL — see § GATE SEVERITY) at estimated-Jaccard >= WARN_THRESHOLD, and for every
 *      build that trips it, RE-DERIVE that prior build's masked prose fresh from its own files on
 *      disk (its full text is never stored — only its 128-number sketch is) and report the top 3-5
 *      longest shared literal runs so the warning names actual shared phrases, not just a score.
 *
 * § MASKING — sources and honesty limit.
 * gathered-content.md and site-data.ts are free-form per-build artefacts, not a fixed schema (this
 * was checked directly against 4 real clients before writing the regexes below: one client's
 * site-data.ts exports a `biz` object, another exports flat top-level consts with no `biz` object
 * at all; field labels vary "Business name:" / "Name:" / a bare H1 title). The extraction below is
 * therefore a set of tolerant, label-alternation regexes over both files, not a strict parse — the
 * same "not a real DOM parse, not a real schema" honesty limit every sibling script in this file
 * states about itself. A missed trade noun or an unrecognised business-name label under-masks and
 * inflates an estimated overlap; an over-eager word match over-masks and hides a real one. Given
 * this gate is WARN-only and judgement-laden by design (see § GATE SEVERITY), erring toward
 * OVER-masking common words (the trade-noun pass masks every category/industry word ≥4 chars, not
 * just a hand-picked list) is the safer failure direction — it trades sensitivity for fewer false
 * warnings on legitimately shared trade vocabulary ("plumbing", "electrical", "licensed").
 * Deliberate extension past the spec's literal wording: owner name gets the same "+ each name-part
 * ≥4 chars" treatment the spec only specified for business name, because trade-site copy plausibly
 * refers to an owner by first name alone ("Phil says…", a quote attribution) — masking only the
 * full "Phil Anderson" string would miss that.
 *
 * § SHINGLING — per-page, not per-build. Shingles are built from each HTML file's own masked token
 * stream independently and unioned into one Set for the sketch, rather than concatenating every
 * page's tokens into one stream first. Concatenating first would manufacture a fake 5-word window
 * spanning the last words of one page directly into the first words of the next — an artefact of
 * page ORDER on disk, not a real adjacency in anything a reader ever sees.
 *
 * § GATE SEVERITY — WARN only, indefinitely, per explicit instruction: this is the most
 * judgement-laden of the four sameness gaps. Masking has real, stated holes (above), and a hard
 * FAIL here would block a build over prose that may be entirely legitimate — "fully licensed and
 * insured" appears on nearly every real trade business's site on earth and would still match after
 * masking (it contains no business name, town, owner, digit, or trade-noun token at all). Never
 * promote this to a hard gate without new evidence, and if it ever is, do it in a separate change
 * with its own calibration pass — same promotion path SAMENESS-03's own header describes for
 * UNSTAMPED/DECORATIVE once real stamped builds exist to check it against.
 *
 * WARN_THRESHOLD = 0.15 IS AN EXPLICIT PLACEHOLDER, not a derived constant — see the constant's own
 * comment below for the reasoning and for what the real measured pairwise numbers looked like when
 * this script was verified against actual clients (2026-08-18). Revisit once more real client
 * copy-sketches exist to calibrate against, same "must earn a floor before it gets one" posture
 * hyperui-usage-check.mjs's own citation/layout thresholds state about themselves.
 *
 * Prints COPY_FINGERPRINT_CHECK=PASS|WARN|SKIP. SKIP fires when clients/<slug>/site/out doesn't
 * exist yet (pre-build run), when this build's own extracted prose yields zero shingles (nothing
 * real to sketch — never persist a degenerate all-sentinel MinHash sketch, it would falsely
 * 100%-match any other degenerate sketch), or when no prior ledger record carries a comparable
 * copySketch yet (the system's own bootstrapping problem — not a finding). On any non-SKIP run
 * (PASS or WARN — WARN never blocks a deploy, so a WARN'd build's sketch still belongs in history
 * for the NEXT build to compare against), the 128-element sketch is persisted onto this slug's own
 * record in data/design-fingerprints.json — same "own record, write on some pass condition" pattern
 * hyperui-usage-check.mjs and font-uniqueness-check.mjs already use, generalised here to "any real
 * (non-SKIP) run" because this gate has no hard-FAIL branch that would make "PASS only" meaningful.
 * Fail-open on a corrupt ledger; never fabricate a stub record for a slug that doesn't have one yet
 * (same posture as every sibling script that touches this file).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock } from './lib/file-lock.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FINGERPRINT_LEDGER = join(REPO_ROOT, 'data', 'design-fingerprints.json');
const LOOKBACK = 8;
const SHINGLE_SIZE = 5;
const NUM_PERM = 128;
const MIN_WORD_LEN = 4;
const SHARED_RUN_TOP_N = 5;

// PLACEHOLDER THRESHOLD, per the spec this script implements from. The honest expectation stated
// up front was that independent prose should sit near 0.01-0.05 TRUE Jaccard after masking, and
// that 0.15 would mean roughly one shipped 5-word skeleton in seven is shared with a specific prior
// build. VERIFIED 2026-08-18 against every real pairwise combination available at the time — the 4
// real clients with both a built out/ and real gathered-content.md/site-data.ts (the-woodlands-
// plumbing-and-air, abacus-plumbing, demolition-okc, impact-landscapes-frisco; only
// the-woodlands-plumbing-and-air had an existing design-fingerprints.json record to persist a
// sketch onto, so only 3 of the 6 pairs were exercised through this script's own ledger-comparison
// path — the other 3 were computed by calling this file's own buildCopyProfile/minhashSketch
// functions directly, which is the identical computation, just not routed through the ledger; see
// the verification note this shipped with for the full method and both sets of numbers).
// TRUE Jaccard (intersection/union of the real shingle sets, the ground truth MinHash estimates)
// ranged 0.0000-0.0159 across all 6 pairs — at or below the low end of the honest-expectation
// range, nowhere near 0.15. The MinHash-ESTIMATED Jaccard this gate actually compares against was
// 0.0000 for all 6 pairs, including the one true-Jaccard=0.0159 pair — not a bug (verified
// separately against a synthetic 0.75-true-Jaccard case, which correctly estimated ~0.83): 128
// permutations have real resolution limits below ~0.02 true Jaccard, where the expected matching-
// position count is under 2-3 out of 128 and can easily land on exactly 0. That is a genuine,
// worth-knowing property of this configuration (spec-directed 128 perms, not a choice made here) —
// it means small, organic overlap reads as a clean 0.000 rather than a noisy near-zero value, which
// is the SAFE direction for a WARN-only gate (fewer false warnings), but it also means this gate has
// limited sensitivity to a moderate real skeleton match (true Jaccard in, say, the 0.05-0.10 range)
// until more real copy volume exists per client to shrink the sampling error. 0.15 is therefore a
// deliberately conservative placeholder that will not fire on ordinary independent builds — left as
// specified (not tightened) because 4 clients across 3 different trades is not enough to derive a
// real number yet; the fixture-based WARN-path test in the same verification note confirms the
// mechanism itself (threshold check + shared-phrase reporting) fires correctly once a real skeleton
// match exists. Revisit downward (toward the 0.03-0.06 range the real TRUE-Jaccard numbers would
// support) once ~10+ real client sketches with real prose volume exist in the ledger, same
// calibration bar every other WARN-only signal in this codebase sets for itself.
const WARN_THRESHOLD = 0.15;

const slug = process.argv[2];
if (!slug) {
  console.error('usage: copy-fingerprint-check.mjs <slug>');
  process.exit(2);
}

// ── HTML entity + JS-string-escape decoding — small, local, not a general-purpose library. Covers
// what actually appears in this template's gathered content and shipped markup. ──
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…',
};
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}
function decodeJsStringEscapes(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

// ── § Prose extraction — one client build's site/out/ -> per-page masked token arrays. ──

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'param', 'embed']);
const CONTENT_TAG_RE = /<(h1|h2|h3|p|li|dt|dd|blockquote|a)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function stripChrome(html) {
  let out = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'header', 'nav', 'footer']) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  return out;
}

// Extracts real prose from one built HTML page: strips header/nav/footer/script/style chrome
// (matching the reasoning hyperui-usage-check.mjs already applies to its own citation floor — see
// module header), scopes to <section>...</section> content (verified against real shipped output,
// 2026-08-18: on a real page this leaves under 2% of body bytes outside <section> once chrome is
// stripped, mostly a sticky mobile CTA snippet that masking neutralises anyway — falls back to the
// whole stripped body if a template has zero <section> tags, so this never silently returns empty
// on a differently-structured build), then walks h1/h2/h3/p/li/dt/dd/blockquote/a in document order.
// A single alternation-with-backreference regex, matchAll'd once, naturally avoids double-counting
// an <a> nested inside a <p> — the <p> match already consumes through its own closing tag, so
// matchAll's cursor is past the nested <a> by the time it looks for the next match.
function extractPageProse(html) {
  const stripped = stripChrome(html);
  const sections = stripped.match(/<section\b[^>]*>[\s\S]*?<\/section>/gi);
  const scope = sections && sections.length ? sections.join(' ') : stripped;
  const chunks = [];
  for (const m of scope.matchAll(CONTENT_TAG_RE)) {
    const inner = m[2].replace(/<[^>]+>/g, ' ');
    chunks.push(decodeEntities(inner));
  }
  return chunks.join(' ');
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// ── § Masking — builds the client's own mask list from gathered-content.md + site-data.ts. ──

// Finds "- **Label:** value" / "**Label:** value" / "Label: value" for the first label in
// `labels` that matches anywhere in `text` (case-insensitive). Tolerant of 0-2 leading "*",
// an optional dash bullet, and the colon landing inside or outside the bold markers — the shape
// every real gathered-content.md observed so far uses, in slightly different combinations.
function extractLineValue(text, labels) {
  const alt = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?:^|\\n)\\s*-?\\s*\\*{0,2}\\s*(?:${alt})\\s*:?\\s*\\*{0,2}\\s*:?\\s*(.+)`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function extractH1Title(text) {
  const m = text.match(/^#\s+(.+)$/m);
  if (!m) return null;
  return m[1]
    .replace(/\s*[-–—]\s*gathered content\s*$/i, '')
    .trim();
}

// All `key: "value"` / `key: 'value'` assignments for any key in `keys`, in source order.
function extractQuotedByKeys(text, keys) {
  const alt = keys.join('|');
  const re = new RegExp(`\\b(?:${alt})\\s*:\\s*["'\`]([^"'\`]+)["'\`]`, 'g');
  return [...text.matchAll(re)].map((m) => decodeJsStringEscapes(m[1]));
}

// Contents of a `key: [ "a", "b" ]` array literal, as individual quoted strings.
function extractQuotedArray(text, key) {
  const m = text.match(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/["'\`]([^"'\`]+)["'\`]/g)].map((mm) => decodeJsStringEscapes(mm[1]));
}

function stripParentheticals(s) {
  return s.replace(/\([^)]*\)/g, ' ').trim();
}

// Returns the full { words, code } mask list for one client, deduped, unsorted (caller sorts by
// descending phrase length before applying). Every candidate is real data pulled from THIS client's
// own gathered-content.md / site-data.ts — never a generic stopword list.
function buildMaskList(clientSlug) {
  const gathered = readIfExists(join(REPO_ROOT, 'clients', clientSlug, 'data', 'gathered-content.md'));
  const siteData = readIfExists(join(REPO_ROOT, 'clients', clientSlug, 'site', 'src', 'app', '_components', 'site-data.ts'));

  const list = [];
  const seen = new Set();
  function add(raw, code, { splitWords = false } = {}) {
    if (!raw) return;
    const cleaned = stripParentheticals(raw);
    const words = tokenize(cleaned);
    if (!words.length) return;
    const key = `${words.join(' ')}|${code}`;
    if (!seen.has(key)) { seen.add(key); list.push({ words, code }); }
    if (splitWords) {
      for (const w of words) {
        if (w.length < MIN_WORD_LEN) continue;
        const k2 = `${w}|${code}`;
        if (!seen.has(k2)) { seen.add(k2); list.push({ words: [w], code }); }
      }
    }
  }

  // Business name: H1 title, the gathered-content.md "Business name:"/"Name:" bullet (plus any
  // "(also known as X)" alias captured separately before the bullet's own parentheticals are
  // stripped), and site-data.ts's `name`/`nameClean`/`shortName` fields.
  const h1 = extractH1Title(gathered);
  if (h1) add(h1, '⟨b⟩', { splitWords: true });
  const nameLine = extractLineValue(gathered, ['business name', 'name']);
  if (nameLine) {
    const alias = nameLine.match(/also known as ([^)]+)/i);
    if (alias) add(alias[1], '⟨b⟩', { splitWords: true });
    add(nameLine, '⟨b⟩', { splitWords: true });
  }
  for (const n of extractQuotedByKeys(siteData, ['name', 'nameClean', 'shortName'])) {
    add(n, '⟨b⟩', { splitWords: true });
  }

  // Owner: gathered-content.md "Owner:" bullet + site-data.ts `owner` field. Split into
  // individual ≥4-char name parts too — a deliberate extension past the spec's literal wording,
  // see the module header's § MASKING note on why (plausible bare-first-name mentions in copy).
  const ownerLine = extractLineValue(gathered, ['owner']);
  if (ownerLine) add(ownerLine, '⟨n⟩', { splitWords: true });
  for (const o of extractQuotedByKeys(siteData, ['owner'])) add(o, '⟨n⟩', { splitWords: true });

  // Town / area served: gathered-content.md "Location:"/"City:"/"Town:"/"Address:" bullets (first
  // 1-2 comma-separated segments, skipping short/zip-code-looking fragments) + site-data.ts
  // `city`/`address`/`areaServed` fields.
  const locationLine = extractLineValue(gathered, ['location', 'city', 'town', 'area served']);
  if (locationLine) {
    const cleaned = stripParentheticals(locationLine);
    for (const seg of cleaned.split(',').slice(0, 2)) {
      const t = seg.trim();
      if (t.length >= 3 && !/^\d+$/.test(t)) add(t, '⟨t⟩');
    }
  }
  for (const c of extractQuotedByKeys(siteData, ['city'])) add(c, '⟨t⟩');
  for (const a of extractQuotedByKeys(siteData, ['address'])) {
    for (const seg of a.split(',').slice(0, 2)) {
      const t = seg.trim();
      if (t.length >= 3 && !/^[\d\s]+$/.test(t)) add(t, '⟨t⟩');
    }
  }
  for (const t of extractQuotedArray(siteData, 'areaServed')) add(t, '⟨t⟩');

  // Trade nouns: the Category/Industry field, split into individual ≥4-char words. Deliberately
  // broad (masks every word in the field, not a hand-picked subset) — see module header's § MASKING
  // note on why over-masking common trade vocabulary is the safer failure direction for a WARN-only
  // gate. No dedicated class letter was assigned in the spec for this category; ⟨x⟩ is used here to
  // keep it distinct from business/town/owner/digit so a same-industry match never reads as an
  // actual identity leak between two different businesses.
  const categoryLine = extractLineValue(gathered, ['category', 'industry']);
  if (categoryLine) {
    for (const w of tokenize(categoryLine)) {
      if (w.length < MIN_WORD_LEN) continue;
      const k = `${w}|⟨x⟩`;
      if (!seen.has(k)) { seen.add(k); list.push({ words: [w], code: '⟨x⟩' }); }
    }
  }

  return list;
}

// Greedy longest-match-first substitution over a token array. `phraseList` must already be sorted
// by descending word-count so a multi-word phrase (e.g. the full business name) always wins over a
// shorter one (e.g. one of its individual words) that could also match at the same position.
function maskPhrases(tokens, phraseList) {
  const out = [];
  let i = 0;
  outer: while (i < tokens.length) {
    for (const { words, code } of phraseList) {
      if (i + words.length > tokens.length) continue;
      let match = true;
      for (let k = 0; k < words.length; k += 1) {
        if (tokens[i + k] !== words[k]) { match = false; break; }
      }
      if (match) {
        out.push(code);
        i += words.length;
        continue outer;
      }
    }
    out.push(tokens[i]);
    i += 1;
  }
  return out;
}

const CLASS_TOKENS = new Set(['⟨b⟩', '⟨t⟩', '⟨n⟩', '⟨x⟩']);
function maskDigits(tokens) {
  return tokens.map((t) => (CLASS_TOKENS.has(t) ? t : t.replace(/\d+/g, '⟨#⟩')));
}

// Full pipeline for one client: reads its own out/, masks against its own gathered data, returns
// { pagesTokens: Map<route, string[]>, shingles: Set<string> }. Re-run fresh on demand (never
// cached across builds) both for the current slug and, at WARN time only, for whichever prior
// slug(s) tripped the threshold — see § WARN reporting below for why that recomputation is cheap
// enough to only pay for on a warn.
function buildCopyProfile(clientSlug) {
  const outDir = join(REPO_ROOT, 'clients', clientSlug, 'site', 'out');
  if (!existsSync(outDir)) return null;

  const maskList = buildMaskList(clientSlug).sort((a, b) => b.words.length - a.words.length);
  const files = listHtmlFiles(outDir);
  const pagesTokens = new Map();
  const shingles = new Set();

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const prose = extractPageProse(html);
    const rawTokens = tokenize(prose);
    if (!rawTokens.length) continue;
    const masked = maskDigits(maskPhrases(rawTokens, maskList));
    pagesTokens.set(routeFromFile(outDir, file), masked);
    for (let i = 0; i + SHINGLE_SIZE <= masked.length; i += 1) {
      shingles.add(masked.slice(i, i + SHINGLE_SIZE).join(' '));
    }
  }
  return { pagesTokens, shingles };
}

function listHtmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '_next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listHtmlFiles(p));
    else if (name.endsWith('.html') && !/^(404|_not-found)\.html$/i.test(name)) out.push(p);
  }
  return out;
}

function routeFromFile(outDir, filePath) {
  let rel = filePath.slice(outDir.length).replace(/\\/g, '/').replace(/^\//, '').replace(/\.html$/, '');
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  return `/${rel}`;
}

// ── § MinHash — 128-permutation sketch over an FNV-1a-32 hash of each shingle, using the standard
// (a*x + b) mod MERSENNE_PRIME universal-hash family (the same technique the `datasketch` Python
// library uses for MinHash, chosen here for the same reason: a single well-known, correct
// construction beats a bespoke one). BigInt throughout the hash math — a*x for two ~32-bit numbers
// exceeds JS's 53-bit safe-integer range, so plain Number multiplication would silently corrupt the
// sketch. The 128 (a, b) coefficient pairs are generated ONCE at module load from a FIXED seed —
// this is load-bearing, not cosmetic: two builds' sketches are only comparable if they were built
// from the identical permutation family, so this must never be randomized per run. ──
const MERSENNE_PRIME = (1n << 61n) - 1n;

function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0xc0ffee);
const PERMS = Array.from({ length: NUM_PERM }, () => ({
  a: BigInt(Math.floor(rng() * 0xfffffffe) + 1),
  b: BigInt(Math.floor(rng() * 0xffffffff)),
}));

function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Returns the 128-element sketch as an array of decimal strings — BigInt isn't natively
// JSON-serialisable, and decimal strings compare for equality exactly (no precision loss), which
// is all the estimated-Jaccard step below needs; nothing ever needs to parse them back to BigInt.
function minhashSketch(shingleSet) {
  const mins = new Array(NUM_PERM).fill(MERSENNE_PRIME);
  for (const shingle of shingleSet) {
    const x = BigInt(fnv1a(shingle));
    for (let i = 0; i < NUM_PERM; i += 1) {
      const h = (PERMS[i].a * x + PERMS[i].b) % MERSENNE_PRIME;
      if (h < mins[i]) mins[i] = h;
    }
  }
  return mins.map((v) => v.toString());
}

function estimatedJaccard(sketchA, sketchB) {
  let agree = 0;
  const n = Math.min(sketchA.length, sketchB.length);
  for (let i = 0; i < n; i += 1) if (sketchA[i] === sketchB[i]) agree += 1;
  return n === 0 ? 0 : agree / n;
}

// ── § Shared-phrase reporting — only computed for a pair that already tripped WARN_THRESHOLD, so
// this expensive step never runs on an ordinary passing comparison. Finds the longest contiguous
// token runs (>= SHINGLE_SIZE) common to both builds' masked prose via a hash-bucketed extension
// search (bucket every SHINGLE_SIZE-window of A by its joined text, then for each window of B that
// lands in a bucket, extend the match forward token-by-token) rather than a full O(n*m) LCS —
// correct for finding maximal contiguous runs, and fast enough to run on demand. Reports the top
// N by length, deduped by exact text and by discarding any run whose B-range is already covered by
// a longer run already picked. ──
function findSharedRuns(tokensA, tokensB, minLen = SHINGLE_SIZE, topN = SHARED_RUN_TOP_N) {
  const posByShingle = new Map();
  for (let i = 0; i + minLen <= tokensA.length; i += 1) {
    const key = tokensA.slice(i, i + minLen).join(' ');
    if (!posByShingle.has(key)) posByShingle.set(key, []);
    posByShingle.get(key).push(i);
  }
  const runs = [];
  for (let j = 0; j + minLen <= tokensB.length; j += 1) {
    const key = tokensB.slice(j, j + minLen).join(' ');
    const candidates = posByShingle.get(key);
    if (!candidates) continue;
    for (const i of candidates) {
      let len = minLen;
      while (i + len < tokensA.length && j + len < tokensB.length && tokensA[i + len] === tokensB[j + len]) len += 1;
      runs.push({ j, len, text: tokensB.slice(j, j + len).join(' ') });
    }
  }
  runs.sort((a, b) => b.len - a.len);
  const seenText = new Set();
  const picked = [];
  for (const r of runs) {
    if (seenText.has(r.text)) continue;
    const overlapsExisting = picked.some((p) => !(r.j + r.len <= p.j || r.j >= p.j + p.len));
    if (overlapsExisting) continue;
    seenText.add(r.text);
    picked.push(r);
    if (picked.length >= topN) break;
  }
  return picked.map((r) => r.text);
}

// ── Main ──

const outDir = join(REPO_ROOT, 'clients', slug, 'site', 'out');
if (!existsSync(outDir)) {
  console.log(`COPY_FINGERPRINT_CHECK=SKIP (clients/${slug}/site/out does not exist yet — pre-build run)`);
  process.exit(0);
}

const profile = buildCopyProfile(slug);
if (!profile || profile.shingles.size === 0) {
  console.log(`COPY_FINGERPRINT_CHECK=SKIP (no extractable prose found under clients/${slug}/site/out — nothing real to sketch)`);
  process.exit(0);
}
const sketch = minhashSketch(profile.shingles);

let ledger = [];
if (existsSync(FINGERPRINT_LEDGER)) {
  try {
    const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
    if (Array.isArray(parsed)) ledger = parsed;
  } catch {
    console.log('COPY_FINGERPRINT_NOTE — design-fingerprints.json unreadable; treating as empty (fail-open)');
  }
}

const priors = ledger.filter((r) => r.slug !== slug).slice(0, LOOKBACK);
const priorsWithSketch = priors.filter((r) => Array.isArray(r.copySketch) && r.copySketch.length === NUM_PERM);

// NOTE the deliberate absence of an early `process.exit` in this branch, unlike the two SKIPs
// above. Those two fire before a real sketch exists at all (no out/, or zero shingles) — there is
// nothing to persist. This one fires AFTER a real, valid sketch has already been computed for
// THIS build; it just has nothing yet to compare it against. If this exited early without
// persisting, no client's sketch would EVER make it into data/design-fingerprints.json (this
// script is the only place copySketch is ever written), and every future run would hit this same
// SKIP forever — a permanent bootstrapping deadlock. So this SKIP still falls through to the
// persistence step at the bottom, exactly like the WARN/PASS branches below it.
if (!priorsWithSketch.length) {
  console.log(
    `COPY_FINGERPRINT_CHECK=SKIP (no prior build in the last ${LOOKBACK} ledger records carries a copySketch yet — nothing to compare against; this is the system's own bootstrapping state, not a finding. This build's own sketch is still recorded below so the NEXT build has something to compare against.)`
  );
} else {
  const scored = priorsWithSketch
    .map((r) => ({ slug: r.slug, jaccard: estimatedJaccard(sketch, r.copySketch) }))
    .sort((a, b) => b.jaccard - a.jaccard);
  const triggering = scored.filter((r) => r.jaccard >= WARN_THRESHOLD);

  console.log(
    `Copy fingerprint — estimated Jaccard vs last ${priorsWithSketch.length} prior build(s) with a comparable sketch: ${scored
      .map((r) => `${r.slug}=${r.jaccard.toFixed(3)}`)
      .join(', ')}`
  );

  if (triggering.length) {
    for (const t of triggering) {
      const priorProfile = buildCopyProfile(t.slug);
      if (!priorProfile) {
        console.log(`  ${t.slug}: could not recompute shared-phrase detail — clients/${t.slug}/site/out no longer on disk`);
        continue;
      }
      const currentTokens = [...profile.pagesTokens.values()].flat();
      const priorTokens = [...priorProfile.pagesTokens.values()].flat();
      const shared = findSharedRuns(currentTokens, priorTokens);
      console.log(
        `  ${t.slug} (${(t.jaccard * 100).toFixed(1)}%): ${shared.length ? shared.map((s) => `"${s}"`).join('; ') : '(no literal run >= ' + SHINGLE_SIZE + ' tokens found — overlap is in the sketch estimate, not a single long shared span)'}`
      );
    }
    console.log(
      `COPY_FINGERPRINT_CHECK=WARN — estimated copy-skeleton overlap >= ${WARN_THRESHOLD} with ${triggering.length} of the last ${priorsWithSketch.length} prior build(s): ${triggering.map((t) => `${t.slug} (${(t.jaccard * 100).toFixed(1)}%)`).join(', ')}. Not a FAIL (WARN-only indefinitely — see script header): hand-read the shared phrases above against both builds' actual pages. If they read as genuinely recycled skeletons, vary the wording; if they read as ordinary trade-copy conventions ("fully licensed and insured"), this is a known, accepted false-positive shape and no action is needed.`
    );
  } else {
    console.log(`COPY_FINGERPRINT_CHECK=PASS — no prior build's estimated overlap reached ${WARN_THRESHOLD}.`);
  }
}

// ── Persist onto the client's own record — any real (non-SKIP) run, PASS or WARN alike, since WARN
// never blocks a deploy and every real build's sketch belongs in history for the NEXT comparison.
// Never fabricate a stub record for a slug that doesn't have one (design-ledger.mjs `record` mode
// not run for this client) — same posture every sibling script in this file takes. ──
// 2026-08-18 (Fable): locked, and re-reads fresh inside the lock — same race class as the sibling
// scripts in this file, see design-ledger.mjs's record mode for the full reasoning.
const own = ledger.find((r) => r.slug === slug);
if (own) {
  await withFileLock(FINGERPRINT_LEDGER, () => {
    let fresh = [];
    if (existsSync(FINGERPRINT_LEDGER)) {
      try {
        const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
        if (Array.isArray(parsed)) fresh = parsed;
      } catch { /* unreadable — fall through with fresh=[], same fail-open posture as above */ }
    }
    const freshOwn = fresh.find((r) => r.slug === slug);
    if (freshOwn) {
      freshOwn.copySketch = sketch;
      writeFileSync(FINGERPRINT_LEDGER, JSON.stringify(fresh, null, 2));
    }
  });
} else {
  console.log(`COPY_FINGERPRINT_NOTE — no design-fingerprints.json record for ${slug} (design-ledger.mjs record not run?); copy sketch not persisted this run`);
}

/*
 * NO `process.exit(0)` HERE — it used to be, and it silently ate this gate's own verdict.
 *
 * On a PIPE, process.stdout writes in Node are asynchronous, and process.exit() discards whatever
 * is still queued. This script's WARN branch prints the shared-phrase evidence (tens of KB) and
 * THEN the COPY_FINGERPRINT_CHECK= line, so the verdict is exactly what sits at the back of the
 * queue when exit() fires. Measured 2026-08-19, same slug, same run, two capture methods:
 *     `... 2>&1 | wc -c`          -> 65,706 bytes, ZERO COPY_FINGERPRINT_CHECK= lines
 *     `... > file 2>&1; wc -c`    -> 66,590 bytes, verdict present
 * The missing 884 bytes are the verdict. It only ever worked because qa-capture.sh happens to
 * redirect to a file (synchronous), so the bug was invisible for as long as nobody wrapped this
 * gate in anything that pipes — a wrapper, a CI capture, `| tee`, a tool that captures stdout.
 *
 * Falling off the end exits 0 anyway, after Node flushes. If a future edit needs a non-zero exit,
 * set `process.exitCode = N` and return — never process.exit() after printing.
 */
