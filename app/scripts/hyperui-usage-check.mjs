#!/usr/bin/env node
/**
 * hyperui-usage-check.mjs <slug>
 *
 * EXPERIMENT-BRANCH-ONLY gate. Fixes the exact failure this branch's first real test exposed:
 * a build that had the vendored 469-file HyperUI reference set available, read INDEX.md once,
 * and then wrote entirely custom components — status.md said "None directly copied... informed
 * the FAQ section's approach, but no file was used as a structural template." That is a true,
 * honest sentence, and it is also a build that did not do the thing this branch exists to test.
 * Nothing upstream of QA required it to.
 *
 * THIS SCRIPT MAKES ADOPTION VERIFIABLE THE SAME WAY verify-photos.mjs MADE PHOTO CLEARANCE
 * VERIFIABLE: a build must cite, by exact vendored path, which components it structurally
 * started from — not "informed by" prose, a checkable claim. Reads the "## HyperUI components
 * used" section of clients/<slug>/data/status.md, validates every cited path is real, and
 * enforces a floor: >= 4 distinct application-tier components from >= 3 distinct categories,
 * PLUS >= 2 distinct marketing-tier SECTIONS (structural composition, not content).
 *
 * WHY A SECOND, SEPARATE MARKETING-TIER FLOOR — added 2026-08-16, real operator feedback on the
 * build that passed the application-tier-only floor: "it still doesn't feel like that hyper UI is
 * completely embedded... I don't see a lot of that sections library there." He was right: 4 real
 * atomic widgets (accordion, badges, stats block, timeline) were grafted onto a page whose actual
 * STRUCTURE — hero layout, feature grid, CTA band — was 100% custom, because the application tier
 * is small standalone components, not page-section composition. Marketing-tier files ARE the
 * section-composition library (feature-grids, sections, stats bands, ctas, team-sections,
 * logo-clouds, announcements) — `footers`/`headers` are excluded from this floor since the site
 * already has a fixed, tested pattern for those. The original marketing-tier risk (61% stock
 * content in the sibling project, scored 3-4/10) is still real, which is why rules 1-2 in
 * build/SKILL.md (replace every colour, replace every word) stay load-bearing — this floor
 * requires STRUCTURAL citation, not a licence to ship stock copy.
 *
 * WHY A SKIP, NOT A FAIL, WHEN THE REFERENCE SET IS ABSENT: `main` (and any non-experiment
 * branch) has no `.claude/skills/build/reference/hyperui/` directory at all — this gate must
 * never block a normal build. It only activates when the vendored set is present on disk, i.e.
 * only on experiment/hyperui-components.
 *
 * HONESTY LIMIT, stated plainly rather than oversold: citing a real path proves the path exists
 * and was named, not that the generated TSX actually inherited its structure. That is a floor,
 * not proof — but it is a materially higher bar than the zero-citation "informed by" prose that
 * let the first test ship with no verifiable HyperUI usage at all. As a partial, cheap secondary
 * signal (not a blocker), this script also greps the built site source for raw Tailwind colour
 * classes copied verbatim from a cited file — build/SKILL.md's rule 1 says every such class must
 * be replaced with a derived palette token, so a literal match is worth a warning, not a FAIL,
 * since a generic class like `bg-gray-900` can legitimately appear for unrelated reasons.
 *
 * Prints HYPERUI_USAGE_CHECK=PASS|FAIL|SKIP. FAIL is used the same way PHOTO_CHECK=FAIL is in
 * qa-reviewer.md: a hard-FAIL line the reviewer must report verbatim and never overrule by eye.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock } from './lib/file-lock.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF_ROOT = join(REPO_ROOT, '.claude', 'skills', 'build', 'reference', 'hyperui');
// RAISED 2026-08-16, operator directive after seeing the 4-component floor pass while the site
// "still has the same feel": the floor is a MINIMUM AUDIT TARGET, not a target to just clear.
// "Use it on every component possible" — floors raised so genuinely broad usage is required, not
// just checkbox compliance. Was 4/3; the application tier has 34 categories, so 6/4 is still a
// small fraction, not exhaustive use — but it can no longer be satisfied by e.g. one accordion,
// one badge, one stat block, one timeline (4 items, done). See build/SKILL.md's HyperUI section
// for the "default to a HyperUI structural starting point" instruction this floor backs up.
const MIN_COUNT = 6;
const MIN_CATEGORIES = 4;
// Was 2/2; raised the same way. Still excludes footers/headers (fixed, tested pattern already
// exists for those — see below) so the floor can't be satisfied by citing the two categories
// that were never the point.
// RAISED AGAIN 2026-08-18 (4/3 -> 10/7), after the Woodlands Air build cleared the 4/3 floor
// with 5 citations across 4 of 21 marketing categories (~19% of the section library). The
// numbers are derived from the library's actual shape, not picked round: of the 19 floor-
// eligible categories (21 minus excluded footers/headers), ~8 are relevant to essentially EVERY
// trade-site build — banners (hero), feature-grids (services), sections, stats, ctas, faqs,
// contact-forms, blog-cards — plus a situational tier (team-sections, logo-clouds,
// announcements, cards, newsletter-signup, pricing). Requiring 7 categories forces near-complete
// use of the always-relevant set plus one situational reach, while leaving ~12 categories
// legitimately unused — the floor must never be high enough to force citing carts/polls/
// product-cards on a plumber's site, because a coerced citation is exactly the false-compliance
// failure this gate's header warns about. 10 sections ≈ 2 per route on a 5-route site (every
// major page composition starts from the library, the operator's stated intent) yet under half
// the natural section-instance count, so it's clearable without padding. Read cost of the extra
// citations is noise: ~2-4KB per file vs a build that is 86% output-token time.
const MIN_MARKETING_SECTIONS = 10;
const MIN_MARKETING_CATEGORIES = 7;
// footers/headers excluded from the marketing-tier floor — the site already has a fixed, tested
// pattern for those (SiteFooter/SiteNav), so citing one wouldn't demonstrate new structural reach.
const MARKETING_FLOOR_EXCLUDED = new Set(['footers', 'headers']);

const slug = process.argv[2];
if (!slug) {
  console.error('usage: hyperui-usage-check.mjs <slug>');
  process.exit(2);
}

if (!existsSync(join(REF_ROOT, 'index.json'))) {
  console.log('HYPERUI_USAGE_CHECK=SKIP (no vendored HyperUI reference set on this branch)');
  process.exit(0);
}

const index = JSON.parse(readFileSync(join(REF_ROOT, 'index.json'), 'utf8'));
const byPath = new Map(index.entries.map((e) => [e.path, e]));

const statusPath = join(REPO_ROOT, 'clients', slug, 'data', 'status.md');
if (!existsSync(statusPath)) {
  console.log(`HYPERUI_USAGE_CHECK=FAIL — ${statusPath} does not exist`);
  process.exit(1);
}
const status = readFileSync(statusPath, 'utf8');

// Find the "## HyperUI components used" section by walking level-2 headings, not a single fragile
// regex — robust regardless of what section (if any) follows it or whether it's the last in the file.
const lines = status.split('\n');
let sectionLines = null;
let capturing = false;
for (const line of lines) {
  if (/^##\s+/.test(line)) {
    if (capturing) break;
    if (/^##\s+HyperUI components used\b/i.test(line.trim())) {
      capturing = true;
      sectionLines = [];
    }
    continue;
  }
  if (capturing) sectionLines.push(line);
}

if (!sectionLines) {
  console.log('HYPERUI_USAGE_CHECK=FAIL — status.md has no "## HyperUI components used" section (the old "## HyperUI references used" heading is not enough — rename it and cite real paths)');
  process.exit(1);
}
const body = sectionLines.join('\n');

// Each citation line looks like: - `application/accordions/1.html` -> FAQ section accordion
const cited = [...body.matchAll(/`([a-z0-9-]+\/[a-z0-9-]+\.html)`/gi)].map((m) => m[1]);
const uniqueCited = [...new Set(cited)];

if (!uniqueCited.length) {
  console.log('HYPERUI_USAGE_CHECK=FAIL — "## HyperUI components used" section has zero path citations in `category/file.html` format. "Informed by" prose does not count — cite exact vendored paths.');
  process.exit(1);
}

const invalid = uniqueCited.filter((p) => !byPath.has(p));
if (invalid.length) {
  console.log(`HYPERUI_USAGE_CHECK=FAIL — ${invalid.length} cited path(s) do not exist in the vendored set: ${invalid.join(', ')}`);
  process.exit(1);
}

const validEntries = uniqueCited.map((p) => byPath.get(p));
const applicationEntries = validEntries.filter((e) => e.tier === 'application');
const applicationCategories = new Set(applicationEntries.map((e) => e.category));

const marketingEntries = validEntries.filter((e) => e.tier === 'marketing' && !MARKETING_FLOOR_EXCLUDED.has(e.category));
const marketingCategories = new Set(marketingEntries.map((e) => e.category));

const failures = [];
if (applicationEntries.length < MIN_COUNT) {
  failures.push(`only ${applicationEntries.length} distinct application-tier component(s) cited, minimum is ${MIN_COUNT} (marketing-tier citations don't count toward this floor — see script header for why)`);
}
if (applicationCategories.size < MIN_CATEGORIES) {
  failures.push(`application-tier citations span only ${applicationCategories.size} distinct categor${applicationCategories.size === 1 ? 'y' : 'ies'} (${[...applicationCategories].join(', ') || 'none'}), minimum is ${MIN_CATEGORIES}`);
}
if (marketingEntries.length < MIN_MARKETING_SECTIONS) {
  failures.push(`only ${marketingEntries.length} distinct marketing-tier SECTION(s) cited (excluding footers/headers), minimum is ${MIN_MARKETING_SECTIONS} — atomic components alone (accordions, badges, stats blocks) don't demonstrate real structural influence on the page's actual composition (hero layout, feature grids, CTA bands). See build/SKILL.md's "MANDATORY, not just available" note on the marketing tier.`);
}
if (marketingCategories.size < MIN_MARKETING_CATEGORIES) {
  failures.push(`marketing-tier citations span only ${marketingCategories.size} distinct categor${marketingCategories.size === 1 ? 'y' : 'ies'} (${[...marketingCategories].join(', ') || 'none'}), minimum is ${MIN_MARKETING_CATEGORIES} — citing the same section category repeatedly (e.g. 4x stats) isn't broad structural reach, it's one idea reused.`);
}

if (failures.length) {
  console.log(`HYPERUI_USAGE_CHECK=FAIL — ${failures.join('; ')}`);
  process.exit(1);
}

// Secondary, non-blocking signal: did a cited file's raw Tailwind colour classes survive verbatim
// into the shipped source? (build/SKILL.md rule 1: every such class must become a palette token.)
const siteRoot = join(REPO_ROOT, 'clients', slug, 'site', 'src');
const sourceFiles = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (['.tsx', '.ts', '.css'].includes(extname(name))) sourceFiles.push(p);
  }
}
walk(siteRoot);
const sourceText = sourceFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

const colourLeaks = [];
for (const e of validEntries) {
  for (const cls of e.genericColorClasses) {
    const re = new RegExp(`(^|[\\s"'\`])${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"'\`]|$)`);
    if (re.test(sourceText)) colourLeaks.push(`${cls} (from ${e.path})`);
  }
}

console.log(`HYPERUI_USAGE_CHECK=PASS — ${applicationEntries.length} application-tier components across ${applicationCategories.size} categories (${[...applicationCategories].join(', ')}); ${marketingEntries.length} marketing-tier section(s) across ${marketingCategories.size} categories (${[...marketingCategories].join(', ') || 'none'})`);
if (colourLeaks.length) {
  console.log(`HYPERUI_USAGE_CHECK_WARNING — raw HyperUI Tailwind colour classes appear verbatim in shipped source (should be derived palette tokens per build/SKILL.md rule 1): ${[...new Set(colourLeaks)].join(', ')}`);
}

// ── Cross-build citation fingerprint (WARN-only, added 2026-08-18) ──
// Citing real paths proves library ADOPTION per build; it says nothing about REPETITION across
// builds — 1500 sites/month that all start from the same handful of sections converge on the
// same look even when every one of them passes the floors above. So on PASS (and only on PASS —
// a failed build never deploys, and recording its citations would pollute the ledger), the
// current build's marketing-tier citation set is appended to this client's record in
// data/design-fingerprints.json — the SAME ledger design-ledger.mjs already keeps per build, on
// purpose: one design memory, not two tracking files. Footers/headers are excluded from the
// recorded set for the same reason they're excluded from the floor — fixed patterns every build
// cites, which would inflate every overlap.
//
// The check is PAIRWISE against each of the last 8 prior builds individually, not against a
// pooled union of all 8 — a pooled set from 8 builds is too big to be discriminating, and the
// failure worth catching is "this looks just like the build from 3 runs ago" even when it
// doesn't resemble the literal previous one. Overlap is measured against the SMALLER of the two
// sets (so a prior build whose sections are fully contained in this one still reads 100%).
// Threshold 50%, per operator: with an auto-builder at volume some overlap is expected and fine
// — the target is "no two sites the same", not zero reuse. A lower bar (25% was floated) would
// fire on ordinary chance overlap between unrelated builds and train the operator to swipe the
// warning away, the alert-fatigue failure CLAUDE.md's notify.sh section already documents.
// WARN, never FAIL: this signal is new and uncalibrated — it must earn a floor before it gets
// one, the same road richness-check walked.
const FINGERPRINT_LEDGER = join(REPO_ROOT, 'data', 'design-fingerprints.json');
const CITATION_LOOKBACK = 8;
const CITATION_OVERLAP_THRESHOLD = 0.5;
const citationSet = marketingEntries.map((e) => e.path).sort();

let ledger = [];
if (existsSync(FINGERPRINT_LEDGER)) {
  try {
    const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
    if (Array.isArray(parsed)) ledger = parsed;
  } catch {
    // A corrupt ledger must never fail QA — same fail-open posture as design-ledger.mjs itself.
    console.log('HYPERUI_FINGERPRINT_NOTE — design-fingerprints.json unreadable; citation fingerprint skipped this run');
  }
}

if (ledger.length || existsSync(FINGERPRINT_LEDGER)) {
  // The ledger is newest-first (design-ledger.mjs record prepends), so "the last 8 prior
  // builds" are the first 8 entries that aren't this client's own record.
  const priors = ledger.filter((r) => r.slug !== slug).slice(0, CITATION_LOOKBACK);
  const overlapping = [];
  for (const prior of priors) {
    const priorSet = Array.isArray(prior.hyperuiMarketingCitations) ? prior.hyperuiMarketingCitations : [];
    if (!priorSet.length || !citationSet.length) continue;
    const shared = citationSet.filter((p) => priorSet.includes(p));
    const overlap = shared.length / Math.min(citationSet.length, priorSet.length);
    if (overlap >= CITATION_OVERLAP_THRESHOLD) {
      overlapping.push(`${prior.slug} (${Math.round(overlap * 100)}%: ${shared.join(', ')})`);
    }
  }
  if (overlapping.length) {
    console.log(`HYPERUI_FINGERPRINT_WARNING — this build's marketing-tier citation set overlaps >=${CITATION_OVERLAP_THRESHOLD * 100}% with ${overlapping.length} of the last ${priors.length} builds: ${overlapping.join('; ')}. Not a FAIL (uncalibrated signal), but if the rendered sections read as siblings too, pick different structural starting points before this becomes a pattern.`);
  }

  // Persist onto the client's existing record. design-ledger.mjs `record` runs at design-choice
  // time (before build) and REPLACES the record wholesale, so within a build cycle this append
  // (at QA time) always lands after it and survives. If no record exists — design-ledger was
  // skipped — say so rather than fabricating a stub, because a stub with null palette axes
  // could false-match another stub in design-ledger's own twin scoring.
  // 2026-08-18 (Fable): locked, and re-reads fresh inside the lock — same race class as the
  // sibling scripts, see design-ledger.mjs's record mode for the full reasoning.
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
        freshOwn.hyperuiMarketingCitations = citationSet;
        writeFileSync(FINGERPRINT_LEDGER, JSON.stringify(fresh, null, 2));
      }
    });
  } else {
    console.log(`HYPERUI_FINGERPRINT_NOTE — no design-fingerprints.json record for ${slug} (design-ledger.mjs record not run?); citations not persisted this run`);
  }
}

// ── Layout / section-shape fingerprint (Gap 2 of 4, WARN-only, added 2026-08-18) ──
// The citation fingerprint above answers "did this build start from the same HyperUI files as a
// recent one" — a component-level question. It says nothing about the question a business owner
// actually notices: "does this page LOOK laid out the same way as the last one" — hero, then a
// stat band, then three cards, then a photo CTA, in the same order, regardless of which HyperUI
// files each section started from or what copy is in them. Two builds can cite zero overlapping
// components and still read as siblings if they compose the same shapes in the same sequence.
// This is that check, one level up: a per-route SECTION-SHAPE SEQUENCE computed from the BUILT
// HTML (what ships, not what status.md claims), compared pairwise against recent builds the same
// way the citation check above does — same `.slice(0, 8)` lookback window, same
// `.filter(r => r.slug !== slug)` self-exclusion, same WARN-not-FAIL posture for an uncalibrated
// signal, same append-onto-the-existing-record persistence via `own`.
//
// CLASSIFICATION USES MARKERS ALREADY IN THE SHIPPED MARKUP — no new build-time annotation. Each
// top-level `<section>` on a route is classified into one shape code, first match wins:
// HERO (data-hero) > FAQ (<details) > FORM (<form>/<input>/<textarea>) > STATS (<dl> with >=3
// <dt>) > TIMELINE (<ol> with >=3 <li>, no <dl>) > PHOTOGRID (>=3 <img>, no card-text pattern) >
// a CARDS/SPLIT wrapper search (>=3 same-shape children under a grid/flex-wrap wrapper -> CARDS<n>,
// n bucketed 3/4/6; exactly 2 "major" children -> SPLIT) > CTA (<=2 links/buttons, <60 words) >
// PROSE (fallback). PHOTOBASE- is a PREFIX, not a row in that chain: independently of the above,
// if any <img> in the section carries both `absolute` and `inset-0` classes (a background photo
// plate under real content, not a gallery image), the section's otherwise-computed code — but
// only when that code fell through to CARDS/SPLIT/CTA/PROSE, since HERO/FAQ/FORM/STATS/TIMELINE/
// PHOTOGRID are already terminal, photo-driven-enough classifications on their own — is prefixed
// `PHOTOBASE-`. Ground suffix (`-D`/`-L`/`-X`) reads the section's OWN class attribute only (not
// descendants): `grain-dark` or a literal `bg-surface-dark` or numbered `bg-surface-5`/`-6` -> D;
// plain `grain`, bare `bg-surface`, or `bg-surface-1`..`-4` -> L; none of those present -> X.
//
// HONESTY LIMIT ON THE CLASSIFIER, stated the same way the HyperUI citation check states its own
// above: this is regex/tag-depth heuristics over raw HTML, not a real DOM parse, so it can be
// fooled by unusual markup. Two concrete gaps found while calibrating this against real shipped
// output (clients/the-woodlands-plumbing-and-air/site/out, 2026-08-18) are worth knowing before
// trusting a STATS/HERO absence as meaningful:
//   1. The current trade-site template's stat bands (e.g. "15+ years", "475 Google reviews") are
//      built as a `grid` of plain `<div>`s with a `<p data-count>`, NOT `<dl>`/`<dt>` — so on every
//      build produced by the present generator, STATS never fires; those sections read as CARDS<n>
//      instead. A real `<dl>` shows up only on older, pre-surface-ladder builds (verified on
//      impact-landscapes-frisco, which also predates the `data-hero` attribute entirely and reads
//      its hero section as whatever its content happens to classify as, not HERO). Neither is a bug
//      in this script — the markers really aren't in the newer markup — but it means STATS and HERO
//      are effectively floor-dependent on which build generation produced the site, not universal.
//   2. The CTA row's `<=2 links/buttons, <60 words` rule fires on ANY short section under that word
//      count, including a plain paragraph with zero links (e.g. several `/privacy` and `/terms`
//      subsections read CTA-X rather than PROSE-X) — the spec table doesn't require a link to be
//      PRESENT, only that the count not exceed 2, and 0 <= 2. Followed the rule as given rather than
//      tightening it unasked; flagging it here since it's a real, observable quirk of the output.
//
// THE WRAPPER SEARCH (CARDS vs SPLIT) walks every `grid`/`flex flex-wrap` element in the section in
// document order and, for the first one whose IMMEDIATE children (found via a tag-depth walk, not a
// real DOM tree — good enough to not be fooled by an icon's nested <svg><path>, not proof against
// every possible markup shape) satisfy either "≥3 children, ≥70% sharing one tag" (CARDS) or
// "exactly 2 children, at least one carrying an <img>, a heading, or >15 words" (SPLIT — the >15/
// img/heading test exists specifically so a 2-button CTA row, which is also `flex flex-wrap` with 2
// children, does not get misread as a text+image SPLIT; verified against the real CTA button row on
// the-woodlands' home page, which correctly falls through to CTA once neither of its two <a> children
// clears that bar). A wrapper that qualifies for neither is skipped and the search continues to the
// next grid/flex-wrap element in the section, rather than stopping on the first candidate found.
const LAYOUT_SIG_LOOKBACK = 8;
// Same 0.8 as nowhere else in this file — chosen fresh for this signal, not inherited from the 0.5
// citation-overlap threshold above. A full-page section-SHAPE sequence match is a much stronger claim
// than a component-citation overlap (there are only ~10 shape codes total vs hundreds of HyperUI
// paths, so chance agreement on any ONE symbol is common — the threshold has to sit high enough that
// only a near-total sequence match trips it). WARN, never FAIL: this is a brand-new signal on two
// uncalibrated axes at once (the classifier's own accuracy on real markup, proven only against the
// four builds available on 2026-08-18, and whether 0.8 is the right cut) — same posture as the
// citation check's own "must earn a floor before it gets one" rule.
const LAYOUT_SIMILARITY_THRESHOLD = 0.8;

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'param', 'embed']);

function countTag(html, tag) {
  return (html.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
}

function wordCount(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-zA-Z#0-9]+;/g, ' ');
  return (text.match(/\S+/g) || []).length;
}

// Walks forward from just after a wrapper element's own opening tag, tracking a generic tag-depth
// counter (every non-void opening tag pushes, every closing tag pops), and returns the wrapper's
// IMMEDIATE children as {tag, html} — depth transitions 0->1 start a child, 1->0 end it. Stops the
// moment depth goes negative, i.e. the wrapper's own closing tag. Not a real DOM parse (doesn't
// validate tag nesting is well-formed, doesn't know about HTML's implicit-close elements like <li>
// or <p>), but React's static-export output is always well-formed, explicitly-closed markup, so
// that gap doesn't bite here. Walks via `matchAll` rather than a manual `RegExp#exec` loop so a
// single tag-matching pass can simply be truncated with `break` once depth goes negative.
function scanImmediateChildren(html, startIndex) {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?>/g;
  let depth = 0;
  const children = [];
  let currentStart = -1;
  let currentTag = null;
  for (const m of html.matchAll(tagRe)) {
    if (m.index < startIndex) continue;
    const full = m[0];
    const tag = m[1].toLowerCase();
    const isClose = full[1] === '/';
    if (isClose) {
      depth -= 1;
      if (depth === 0 && currentStart !== -1) {
        children.push({ tag: currentTag, html: html.slice(currentStart, m.index + full.length) });
        currentStart = -1;
      }
      if (depth < 0) break; // reached the wrapper's own closing tag
      continue;
    }
    const isVoidOrSelf = VOID_TAGS.has(tag) || /\/>\s*$/.test(full);
    if (depth === 0) {
      currentStart = m.index;
      currentTag = tag;
    }
    if (!isVoidOrSelf) {
      depth += 1;
    } else if (depth === 0) {
      // a bare void/self-closing element straight under the wrapper (rare, but e.g. a lone <img>)
      children.push({ tag: currentTag, html: html.slice(currentStart, m.index + full.length) });
      currentStart = -1;
    }
  }
  return children;
}

// Finds the first `grid` or `flex flex-wrap` element in the section (document order) whose
// immediate children satisfy CARDS or SPLIT, per the module-header comment above. Returns
// { type: 'CARDS', count } / { type: 'SPLIT', count: 2 } / null.
function findWrapperShape(sectionHtml) {
  const openTagRe = /<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)>/g;
  for (const m of sectionHtml.matchAll(openTagRe)) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag) || tag === 'svg' || tag === 'path') continue;
    if (/\/\s*>$/.test(m[0])) continue; // self-closing tag, can't be a children-bearing wrapper
    const classMatch = m[2].match(/class="([^"]*)"/);
    if (!classMatch) continue;
    const classes = classMatch[1].split(/\s+/);
    const isGrid = classes.includes('grid');
    const isFlexWrap = classes.includes('flex') && classes.includes('flex-wrap');
    if (!isGrid && !isFlexWrap) continue;

    const children = scanImmediateChildren(sectionHtml, m.index + m[0].length);
    if (children.length >= 3) {
      const tagCounts = {};
      for (const c of children) tagCounts[c.tag] = (tagCounts[c.tag] || 0) + 1;
      const maxShare = Math.max(...Object.values(tagCounts)) / children.length;
      if (maxShare >= 0.7) return { type: 'CARDS', count: children.length }; // "≈same-shape", one outlier tolerated
    } else if (children.length === 2) {
      const major = children.some((c) => /<img\b/i.test(c.html) || /<h[1-4]\b/i.test(c.html) || wordCount(c.html) > 15);
      if (major) return { type: 'SPLIT', count: 2 };
    }
    // Neither qualifies (e.g. a 2-button CTA row is also `flex flex-wrap`) — keep scanning for the
    // next grid/flex-wrap wrapper in this section rather than stopping on the first candidate.
  }
  return null;
}

function hasPhotobaseImg(sectionHtml) {
  const imgTags = sectionHtml.match(/<img\b[^>]*>/gi) || [];
  return imgTags.some((tag) => {
    const cm = tag.match(/class="([^"]*)"/);
    if (!cm) return false;
    const classes = cm[1].split(/\s+/);
    return classes.includes('absolute') && classes.includes('inset-0');
  });
}

// 5 isn't a named bucket (the table only defines 3/4/6+) — collapses up into the "6+" bucket
// rather than down into "4", since it reads closer to "many" than to "four exactly".
function cardsBucket(n) {
  if (n <= 3) return 3;
  if (n === 4) return 4;
  return 6;
}

function classifyShape(sectionHtml, openTag) {
  if (/data-hero\b/.test(openTag)) return 'HERO';
  if (countTag(sectionHtml, 'details') >= 1) return 'FAQ';
  if (countTag(sectionHtml, 'form') >= 1 || countTag(sectionHtml, 'input') >= 1 || countTag(sectionHtml, 'textarea') >= 1) return 'FORM';

  const dlCount = countTag(sectionHtml, 'dl');
  const dtCount = countTag(sectionHtml, 'dt');
  if (dlCount >= 1 && dtCount >= 3) return 'STATS';

  const olCount = countTag(sectionHtml, 'ol');
  const liCount = countTag(sectionHtml, 'li');
  if (olCount >= 1 && liCount >= 3 && dlCount === 0) return 'TIMELINE';

  // Computed once, up front, so it can both veto PHOTOGRID (a wall of photo CARDS is not a bare
  // gallery) and, further down, supply the CARDS/SPLIT base code — see the module-header comment.
  const wrapper = findWrapperShape(sectionHtml);
  const imgCount = countTag(sectionHtml, 'img');
  if (imgCount >= 3 && !(wrapper && wrapper.type === 'CARDS')) return 'PHOTOGRID';

  let base;
  if (wrapper && wrapper.type === 'CARDS') base = `CARDS${cardsBucket(wrapper.count)}`;
  else if (wrapper && wrapper.type === 'SPLIT') base = 'SPLIT';
  else {
    const linkCount = countTag(sectionHtml, 'a') + countTag(sectionHtml, 'button');
    base = (linkCount <= 2 && wordCount(sectionHtml) < 60) ? 'CTA' : 'PROSE';
  }
  return hasPhotobaseImg(sectionHtml) ? `PHOTOBASE-${base}` : base;
}

function sectionGround(openTag) {
  const classMatch = openTag.match(/class="([^"]*)"/);
  const classes = classMatch ? classMatch[1].split(/\s+/) : [];
  const isDark = classes.includes('grain-dark') || classes.includes('bg-surface-dark') ||
    classes.some((c) => /^bg-surface-[56]$/.test(c));
  if (isDark) return 'D';
  const isLight = classes.includes('grain') || classes.includes('bg-surface') ||
    classes.some((c) => /^bg-surface-[1-4]$/.test(c));
  if (isLight) return 'L';
  return 'X';
}

// Recursively lists every `.html` file under a built `out/` dir, skipping `_next` (build assets,
// never a route). Deliberately separate from the `walk()` helper above this block, which is
// hardcoded to `.tsx`/`.ts`/`.css` for the colour-leak scan and reused as-is rather than
// generalised, so this doesn't risk changing that scan's behaviour.
function listHtmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '_next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listHtmlFiles(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function routeFromFile(outDir, filePath) {
  let rel = filePath.slice(outDir.length).replace(/\\/g, '/').replace(/^\//, '').replace(/\.html$/, '');
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  return `/${rel}`;
}

// { "/": "HERO-D|CARDS6-L|...", "/services": "...", ... } — one pipe-joined code sequence per
// non-404 route. Route files with zero top-level `<section>` tags (shouldn't happen on this
// template, but e.g. a redirect stub) are omitted rather than recorded as an empty string, so an
// empty signature can never false-match another empty one in the comparison below.
function computeLayoutSignature(outDir) {
  const files = listHtmlFiles(outDir).filter((f) => !/(?:^|[\\/])(?:404|_not-found)\.html$/.test(f));
  const signatures = {};
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const sections = html.match(/<section\b[^>]*>[\s\S]*?<\/section>/g) || [];
    if (!sections.length) continue;
    const codes = sections.map((sectionHtml) => {
      const openTag = (sectionHtml.match(/^<section[^>]*>/) || [''])[0];
      return `${classifyShape(sectionHtml, openTag)}-${sectionGround(openTag)}`;
    });
    signatures[routeFromFile(outDir, file)] = codes.join('|');
  }
  return signatures;
}

// Standard DP edit distance, over the ATOMIC CODES (one full symbol like `PHOTOBASE-CARDS4-D` per
// edit unit), never character-by-character — a one-symbol swap must cost 1, not the ~15 characters
// that symbol happens to be spelled with.
function levenshteinSymbols(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

function layoutSignatureSimilarity(sigA, sigB) {
  const a = sigA.split('|');
  const b = sigB.split('|');
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinSymbols(a, b) / maxLen;
}

const layoutOutDir = join(REPO_ROOT, 'clients', slug, 'site', 'out');
if (!existsSync(layoutOutDir)) {
  // Same caveat the citation block above doesn't need but this one does: this script can run at a
  // point in the pipeline before `next build` has produced `site/out` at all. That's not a defect
  // to report — it's the normal shape of a pre-build QA pass — so this SKIPs quietly rather than
  // failing, and never blocks anything else in this file that already ran above.
  console.log(`LAYOUT_FINGERPRINT_NOTE — clients/${slug}/site/out does not exist yet (pre-build run); layout signature skipped this run`);
} else {
  const layoutSignatures = computeLayoutSignature(layoutOutDir);
  if (!Object.keys(layoutSignatures).length) {
    console.log(`LAYOUT_FINGERPRINT_NOTE — no routable .html files with a top-level <section> found under clients/${slug}/site/out; layout signature skipped this run`);
  } else {
    const homeSignature = layoutSignatures['/'];
    const layoutMatches = [];
    if (homeSignature && (ledger.length || existsSync(FINGERPRINT_LEDGER))) {
      const layoutPriors = ledger.filter((r) => r.slug !== slug).slice(0, LAYOUT_SIG_LOOKBACK);
      for (const prior of layoutPriors) {
        const priorHome = prior.layoutSignatures && prior.layoutSignatures['/'];
        if (!priorHome) continue;
        const exact = priorHome === homeSignature;
        const similarity = layoutSignatureSimilarity(homeSignature, priorHome);
        // Belt-and-suspenders: an exact match always warns even if the similarity formula somehow
        // landed under the threshold (it can't with the current formula, but the two checks are
        // independent on purpose rather than one being derived from the other).
        if (exact || similarity >= LAYOUT_SIMILARITY_THRESHOLD) {
          const priorCodes = priorHome.split('|');
          const shared = [...new Set(homeSignature.split('|').filter((c) => priorCodes.includes(c)))];
          layoutMatches.push(`${prior.slug} (${Math.round(similarity * 100)}%${exact ? ', byte-identical' : ''}: shared ${shared.join(', ') || 'none'})`);
        }
      }
    }
    if (layoutMatches.length) {
      console.log(`LAYOUT_FINGERPRINT_WARNING — home page signature ${Math.round(LAYOUT_SIMILARITY_THRESHOLD * 100)}%+ similar to ${layoutMatches.length} of the last ${LAYOUT_SIG_LOOKBACK} builds' home pages: ${layoutMatches.join('; ')}. Not a FAIL (uncalibrated signal, see header) — if the rendered pages read as siblings too, vary the section order or composition before this becomes a pattern.`);
    } else {
      console.log(`LAYOUT_FINGERPRINT_NOTE — no layout warning: home page section-shape sequence is not ${Math.round(LAYOUT_SIMILARITY_THRESHOLD * 100)}%+ similar (nor byte-identical) to any of the last ${LAYOUT_SIG_LOOKBACK} prior builds' home pages.`);
    }

    // Same persistence pattern as the citation fingerprint above: append onto the client's existing
    // record rather than invent a second ledger, and say so plainly rather than fabricate a stub if
    // design-ledger.mjs never ran for this client.
    // 2026-08-18 (Fable): locked, and re-reads fresh inside the lock — same reasoning as the
    // citation-fingerprint write above.
    const layoutOwn = ledger.find((r) => r.slug === slug);
    if (layoutOwn) {
      await withFileLock(FINGERPRINT_LEDGER, () => {
        let fresh = [];
        if (existsSync(FINGERPRINT_LEDGER)) {
          try {
            const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
            if (Array.isArray(parsed)) fresh = parsed;
          } catch { /* unreadable — fall through with fresh=[], same fail-open posture as above */ }
        }
        const freshLayoutOwn = fresh.find((r) => r.slug === slug);
        if (freshLayoutOwn) {
          freshLayoutOwn.layoutSignatures = layoutSignatures;
          writeFileSync(FINGERPRINT_LEDGER, JSON.stringify(fresh, null, 2));
        }
      });
    } else {
      console.log(`LAYOUT_FINGERPRINT_NOTE — no design-fingerprints.json record for ${slug} (design-ledger.mjs record not run?); layout signature not persisted this run`);
    }
  }
}
