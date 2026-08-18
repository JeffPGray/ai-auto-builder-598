#!/usr/bin/env node
/**
 * hyperui-transplant-check.mjs <slug>
 *
 * EXPERIMENT-BRANCH-ONLY gate. Closes the honesty gap `hyperui-usage-check.mjs` already states
 * about itself in its own header comment: "citing a real path proves the path exists and was
 * named, not that the generated TSX actually inherited its structure." That script verifies the
 * CITATION is real. This script verifies the SHIPPED MARKUP actually resembles what was cited.
 *
 * THE UNSOLVABLE PART, MADE SOLVABLE BY A CONVENTION: there is no way to infer which shipped
 * section corresponds to which citation from the citation alone — a build might cite
 * `marketing-stats/1.html` and ship five different `<dl>` blocks, and nothing in status.md says
 * which one is "the one". Rather than guess, build/SKILL.md's "Record usage as a checkable claim"
 * section now ALSO requires a `data-hyperui="<exact cited path>"` stamp on the root element of
 * whatever shipped, the same "an attribute beats inferring intent from Tailwind class soup"
 * principle `data-photo-treatment` already established for photo art direction. A citation with no
 * matching stamp anywhere in the built output is exactly the honor-system gap this script exists
 * to catch — see UNSTAMPED below.
 *
 * WHAT IT MEASURES, per citation in status.md's "## HyperUI components used" section:
 *   1. Every element in the built HTML (`clients/<slug>/site/out/**\/*.html`) carrying
 *      `data-hyperui="<that exact path>"`. Zero matches -> UNSTAMPED.
 *   2. For each match, a structural similarity SCORE against the vendored reference file, INVARIANT
 *      to the substitutions the skill mandates (every colour becomes a palette token, every word
 *      becomes real content) — computed from two signals a colour/word swap cannot move:
 *        - tag-shape: a depth-first serialization of tag names + nesting only (text and attributes
 *          ignored), with runs of >2 identical-shape siblings collapsed to `shapeXn` so a build that
 *          ships 4 stat cards instead of the reference's 3 still reads as the same shape family.
 *          Two such strings are compared with a plain longest-common-subsequence ratio.
 *        - layout-class skeleton: only the Tailwind utility PREFIXES that describe layout
 *          (grid/flex family, gap-/items-/justify-/order-/col-/row-/max-w-/aspect-/inset-,
 *          absolute/relative, + their responsive sm:/md:/lg:/xl:/2xl: variants) collected across
 *          every element in the subtree, colours/spacing-scale/fonts all ignored, compared as a
 *          Jaccard similarity over MULTISETS (duplicate layout classes count, they are not deduped
 *          away) so "the same wrapper repeated 4 times" is not scored as if it were 1.
 *        score = 0.6 * tagShapeLCSRatio + 0.4 * layoutClassJaccard
 *   3. Verdict per citation: FAITHFUL (score >= 0.6), LOOSE (0.35-0.6, a legitimate adaptation),
 *      DECORATIVE (< 0.35, the path was named but the structure shares almost nothing real).
 *   4. Inverse checks, cheap and unambiguous — no calibration needed for either:
 *        - a `data-hyperui` value stamped in the shipped output that ISN'T in status.md's citation
 *          list (a stamped-but-uncited element — a bookkeeping lie the other direction)
 *        - a citation whose path doesn't exist in the vendored index at all (an invalid path — the
 *          exact check `hyperui-usage-check.mjs` already runs for its own citations, mirrored here)
 *
 * GATE SEVERITY:
 *   HARD FAIL — an invalid path, an uncited stamp, OR an UNSTAMPED/DECORATIVE verdict. All four are
 *   now hard failures. UNSTAMPED/DECORATIVE started WARN-only pending calibration (see git history
 *   for the original reasoning) — that calibration trigger has now fired for real: 2026-08-18, Jeff
 *   hand-inspected a DECORATIVE-flagged real build (aot-mechanical, live, already emailed to a real
 *   business) against its actual rendered output and confirmed the scoring holds — the site read as
 *   visibly flat/generic despite passing HyperUI citations. Per this script's own pre-written
 *   escalation plan, that is the exact trigger to promote to hard FAIL, and it has been promoted.
 *   Explicit operator context for why this stays a hard floor, not a future WARN regression: "the
 *   reason we bought this [Klaudius] is 6 months of failures with our [old] engine, we aren't doing
 *   that again." A WARN a build can pass under is not a floor, it's a suggestion — this gate now
 *   blocks a deploy rather than merely noting the defect.
 *
 * HONESTY LIMIT ON THE SCORER ITSELF: this is a regex/tag-depth tokenizer over raw HTML strings,
 * not a real DOM parse or a semantic diff — it can be fooled by unusual markup, and the 0.6/0.35
 * thresholds are a first-pass judgement call, not a derived constant. It is a materially higher bar
 * than an uncheckable citation, which is the entire reason this script exists — it is not proof.
 *
 * WHY A SKIP, NOT A FAIL, WHEN THE REFERENCE SET IS ABSENT: identical reasoning to
 * `hyperui-usage-check.mjs` — `main` (and any non-experiment branch) has no vendored
 * `.claude/skills/build/reference/hyperui/` directory at all, so this must never block a normal
 * build. It only activates when the vendored set is present on disk.
 *
 * Prints HYPERUI_TRANSPLANT_CHECK=PASS|FAIL|SKIP plus a per-citation table. (WARN is unreachable
 * since the 2026-08-18 promotion above — every branch that used to print WARN now exits FAIL.)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { withFileLock } from './lib/file-lock.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF_ROOT = join(REPO_ROOT, '.claude', 'skills', 'build', 'reference', 'hyperui');

// First-pass judgement calls, not derived constants — see the HONESTY LIMIT note above. Calibrated
// against the hand-built fixture (faithful/decorative/unstamped) this script shipped with; revisit
// once real stamped builds exist to compare against.
const FAITHFUL_THRESHOLD = 0.6;
const LOOSE_THRESHOLD = 0.35;

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'param', 'embed']);
// Bare prefixes (no trailing "-") match ANY class starting with that word — "grid" also matches
// "grid-cols-3"/"grid-rows-2"; "flex" also matches "flex-wrap"/"flex-col". Dashed prefixes require
// the dash so e.g. "gap-4" matches but a hypothetical unrelated word starting the same way would not.
const LAYOUT_PREFIXES = ['grid', 'flex', 'col-', 'row-', 'gap-', 'items-', 'justify-', 'order-', 'max-w-', 'aspect-', 'inset-'];
const LAYOUT_EXACT = new Set(['absolute', 'relative']);
const RESPONSIVE_PREFIX_RE = /^(sm|md|lg|xl|2xl):/;

const slug = process.argv[2];
if (!slug) {
  console.error('usage: hyperui-transplant-check.mjs <slug>');
  process.exit(2);
}

if (!existsSync(join(REF_ROOT, 'index.json'))) {
  console.log('HYPERUI_TRANSPLANT_CHECK=SKIP (no vendored HyperUI reference set on this branch)');
  process.exit(0);
}

const index = JSON.parse(readFileSync(join(REF_ROOT, 'index.json'), 'utf8'));
const byPath = new Map(index.entries.map((e) => [e.path, e]));

const statusPath = join(REPO_ROOT, 'clients', slug, 'data', 'status.md');
if (!existsSync(statusPath)) {
  console.log(`HYPERUI_TRANSPLANT_CHECK=FAIL — ${statusPath} does not exist`);
  process.exit(1);
}
const status = readFileSync(statusPath, 'utf8');

// ── Citation parsing — copied verbatim from hyperui-usage-check.mjs rather than factored into a
// shared module, so this script never risks breaking the already-shipped, already-committed sibling
// gate by changing its imports. The heading-walk (not a single fragile regex) is deliberate there:
// robust regardless of what section follows or whether it's the last one in the file. ──
function parseCitedPaths(statusText) {
  const lines = statusText.split('\n');
  let sectionLines = null;
  let capturing = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (capturing) break;
      if (/^##\s+HyperUI components used\b/i.test(line.trim())) { capturing = true; sectionLines = []; }
      continue;
    }
    if (capturing) sectionLines.push(line);
  }
  if (!sectionLines) return null;
  const body = sectionLines.join('\n');
  return [...new Set([...body.matchAll(/`([a-z0-9-]+\/[a-z0-9-]+\.html)`/gi)].map((m) => m[1]))];
}

// 2026-08-18: proof-of-read hash, paired with the same [hex6] token hyperui-lookup.mjs prints
// next to every path it returns — `[hash]` sha256(vendored file bytes).slice(0,6). Parsed
// separately from parseCitedPaths (which stays the source of truth for WHICH paths are cited) so
// a missing/wrong hash is its own failure mode, not entangled with path validity. The point is
// narrow and deliberate: the only way to produce the correct hash is to have run the sanctioned
// lookup (or recomputed identically) against the REAL file — a path invented from memory, or
// copied from build/SKILL.md's own (now placeholder) example block, cannot carry a correct one.
function parseCitedHashes(statusText) {
  const lines = statusText.split('\n');
  let capturing = false;
  const out = new Map();
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (capturing) break;
      if (/^##\s+HyperUI components used\b/i.test(line.trim())) capturing = true;
      continue;
    }
    if (!capturing) continue;
    const m = line.match(/`([a-z0-9-]+\/[a-z0-9-]+\.html)`\s*\[([0-9a-f]{6})\]/i);
    if (m) out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

const uniqueCited = parseCitedPaths(status);
if (uniqueCited === null) {
  console.log('HYPERUI_TRANSPLANT_CHECK=FAIL — status.md has no "## HyperUI components used" section (hyperui-usage-check.mjs should already be failing this build for the same reason)');
  process.exit(1);
}

const outDir = join(REPO_ROOT, 'clients', slug, 'site', 'out');
if (!existsSync(outDir)) {
  console.log(`HYPERUI_TRANSPLANT_CHECK=SKIP (clients/${slug}/site/out does not exist yet — pre-build run)`);
  process.exit(0);
}

// ── HTML tag-tree utilities. Not a real DOM parse — a depth-counting tokenizer over the array of
// tag matches (never a stateful regex cursor loop), sufficient because React's static-export output
// is always well-formed, explicitly-closed markup (same assumption hyperui-usage-check.mjs's own
// scanImmediateChildren makes and documents). ──
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

// Walks forward from a tag's opening `<` (found at startIndex in the full document), tracking
// depth over every tag from that point on, and returns {tag, html} spanning the whole element
// including its matching close tag. Void/self-closing elements return immediately.
function extractElement(html, startIndex) {
  const sub = html.slice(startIndex);
  const matches = [...sub.matchAll(TAG_RE)];
  if (!matches.length || matches[0].index !== 0 || matches[0][1]) return null; // must land on an opening tag
  const tag = matches[0][2].toLowerCase();
  if (VOID_TAGS.has(tag) || matches[0][3]) return { tag, html: matches[0][0] };
  let depth = 1;
  for (let i = 1; i < matches.length; i += 1) {
    const m = matches[i];
    const isClose = !!m[1];
    const t = m[2].toLowerCase();
    const selfClosing = !!m[3] || VOID_TAGS.has(t);
    if (isClose) {
      depth -= 1;
      if (depth === 0) return { tag, html: sub.slice(0, m.index + m[0].length) };
    } else if (!selfClosing) {
      depth += 1;
    }
  }
  return null; // malformed / truncated — caller treats as "could not extract"
}

// Builds a {tag, children:[]} tree from an element's own HTML (its outer tags included, harmlessly
// — the walk nets to a single top-level child under the synthetic #root). SVG subtrees collapse to
// a single opaque `svg` leaf: icon internals (paths, groups) vary between icon sets for the
// identical visual icon and would otherwise dominate the shape signature with noise unrelated to
// page structure.
function buildTree(html) {
  const matches = [...html.matchAll(TAG_RE)];
  const root = { tag: '#root', children: [] };
  const stack = [root];
  let i = 0;
  while (i < matches.length) {
    const m = matches[i];
    const isClose = !!m[1];
    const tag = m[2].toLowerCase();
    if (tag === 'svg') {
      if (isClose) { i += 1; continue; }
      stack[stack.length - 1].children.push({ tag: 'svg', children: [] });
      if (m[3]) { i += 1; continue; } // self-closing <svg/>, nothing to skip
      // Skip forward to the matching </svg>, tracking nested <svg> depth (defs/use rarely nest one,
      // but this is cheap insurance) rather than assuming the very next </svg> is the right one.
      let svgDepth = 1;
      let j = i + 1;
      while (j < matches.length && svgDepth > 0) {
        const mm = matches[j];
        if (mm[2].toLowerCase() === 'svg') {
          if (mm[1]) svgDepth -= 1;
          else if (!mm[3]) svgDepth += 1;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    const selfClosing = !!m[3] || VOID_TAGS.has(tag);
    if (isClose) {
      if (stack.length > 1) stack.pop();
      i += 1;
      continue;
    }
    const node = { tag, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i += 1;
  }
  return root;
}

// Depth-first tag-shape serialization: `tag(child,child)` or bare `tag` for a leaf. Runs of MORE
// THAN 2 identical-shape consecutive siblings collapse to `shapeXn` — so a 3-stat reference and a
// 4-stat shipped build both collapse (to `...x3` / `...x4`), and the shared `shapeX` prefix still
// scores well under LCS even though the trailing digit differs.
function serializeShape(node) {
  if (!node.children.length) return node.tag;
  const shapes = node.children.map(serializeShape);
  const collapsed = [];
  let i = 0;
  while (i < shapes.length) {
    let j = i;
    while (j < shapes.length && shapes[j] === shapes[i]) j += 1;
    const runLen = j - i;
    if (runLen > 2) collapsed.push(`${shapes[i]}x${runLen}`);
    else for (let k = 0; k < runLen; k += 1) collapsed.push(shapes[i]);
    i = j;
  }
  return `${node.tag}(${collapsed.join(',')})`;
}

function shapeStringOf(elementHtml) {
  const tree = buildTree(elementHtml);
  return tree.children.length ? serializeShape(tree.children[0]) : '';
}

function isLayoutClass(cls) {
  const base = cls.replace(RESPONSIVE_PREFIX_RE, '');
  if (LAYOUT_EXACT.has(base)) return true;
  return LAYOUT_PREFIXES.some((p) => base.startsWith(p));
}

// Every layout-relevant class on every element in the subtree, as a flat (non-deduped) list — the
// caller compares two of these as a multiset, so "grid" appearing on 4 nested wrappers is a
// different signal than it appearing on 1.
function layoutClassesOf(elementHtml) {
  const out = [];
  for (const m of elementHtml.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls && isLayoutClass(cls)) out.push(cls);
    }
  }
  return out;
}

// Plain longest-common-subsequence length over two strings, rolling one row at a time. String
// lengths here are section-sized (low hundreds of characters at most), so this is trivial.
function lcsLength(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

function lcsRatio(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  return lcsLength(a, b) / Math.max(a.length, b.length);
}

// Multiset Jaccard: intersection takes the min count per class, union takes the max — so a shipped
// subtree with 4 "grid" occurrences against a reference with 1 does NOT score as a perfect match.
function jaccardMultiset(a, b) {
  const countA = new Map();
  for (const c of a) countA.set(c, (countA.get(c) || 0) + 1);
  const countB = new Map();
  for (const c of b) countB.set(c, (countB.get(c) || 0) + 1);
  const keys = new Set([...countA.keys(), ...countB.keys()]);
  if (!keys.size) return 1; // neither side has any layout classes — vacuously identical, not a mismatch
  let inter = 0;
  let union = 0;
  for (const k of keys) {
    const ca = countA.get(k) || 0;
    const cb = countB.get(k) || 0;
    inter += Math.min(ca, cb);
    union += Math.max(ca, cb);
  }
  return union === 0 ? 1 : inter / union;
}

function findStampedElements(html, targetPath) {
  const escaped = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-hyperui="${escaped}"[^>]*>`, 'g');
  const found = [];
  for (const m of html.matchAll(re)) {
    const el = extractElement(html, m.index);
    if (el) found.push(el);
  }
  return found;
}

function firstOpenTagIndex(html) {
  const m = html.match(/<[a-zA-Z]/);
  return m ? m.index : -1;
}

// Vendored files are a full HTML document (see build/SKILL.md's HyperUI section / a real file
// under .claude/skills/build/reference/hyperui/): `<head>` carries only the vendor's own CSS/JS
// links, and `<body>` wraps the actual component in a single root element — verified directly
// against .claude/skills/build/reference/hyperui/marketing-stats/1.html before hardcoding this.
function vendorReferenceElement(vendorPath) {
  const text = readFileSync(join(REF_ROOT, vendorPath), 'utf8');
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyInner = bodyMatch ? bodyMatch[1] : text;
  const start = firstOpenTagIndex(bodyInner);
  return start === -1 ? null : extractElement(bodyInner, start);
}

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

const htmlFiles = listHtmlFiles(outDir);
const fileContents = new Map(htmlFiles.map((f) => [f, readFileSync(f, 'utf8')]));

// ── Bookkeeping checks (unambiguous, no scoring) ──
const invalidCitations = uniqueCited.filter((p) => !byPath.has(p));

// Proof-of-read hash check — only meaningful for citations whose path is otherwise valid; an
// invalid path already fails for its own reason above and isn't double-counted here.
const citedHashes = parseCitedHashes(status);
const hashFailures = [];
for (const p of uniqueCited) {
  if (!byPath.has(p)) continue;
  const real = createHash('sha256').update(readFileSync(join(REF_ROOT, p))).digest('hex').slice(0, 6);
  const claimed = citedHashes.get(p);
  if (!claimed) hashFailures.push(`${p} has no [hash] token (run \`node scripts/hyperui-lookup.mjs <category>\` and copy its printed [hex6] verbatim — a bare path with no hash is unproven)`);
  else if (claimed !== real) hashFailures.push(`${p} hash [${claimed}] does not match the vendored file's actual hash [${real}] (the file changed since the hash was recorded, or the hash was copied from a different citation — re-run the lookup and use its current output)`);
}

const allStampedValues = new Set();
for (const html of fileContents.values()) {
  for (const m of html.matchAll(/data-hyperui="([^"]*)"/g)) allStampedValues.add(m[1]);
}
const uncitedStamps = [...allStampedValues].filter((v) => !uniqueCited.includes(v));

// ── Structural fidelity scoring, one result per valid citation ──
const results = [];
for (const citPath of uniqueCited) {
  if (!byPath.has(citPath)) continue; // reported separately as an invalid citation, above
  const vendorEl = vendorReferenceElement(citPath);
  const vendorShape = vendorEl ? shapeStringOf(vendorEl.html) : '';
  const vendorLayout = vendorEl ? layoutClassesOf(vendorEl.html) : [];

  const instances = [];
  for (const [file, html] of fileContents) {
    for (const el of findStampedElements(html, citPath)) instances.push({ file, el });
  }

  if (!instances.length) {
    results.push({ path: citPath, verdict: 'UNSTAMPED', score: null, instances: 0 });
    continue;
  }
  if (!vendorEl) {
    // The vendored file itself couldn't be parsed into a root element — a vendor-catalog defect,
    // not a build defect. Report LOOSE (can't prove faithful, can't call it decorative either)
    // rather than crash the gate over vendor-side data quality.
    results.push({ path: citPath, verdict: 'LOOSE', score: null, instances: instances.length });
    continue;
  }

  let best = -1;
  for (const { el } of instances) {
    const shapeScore = lcsRatio(shapeStringOf(el.html), vendorShape);
    const layoutScore = jaccardMultiset(layoutClassesOf(el.html), vendorLayout);
    const score = 0.6 * shapeScore + 0.4 * layoutScore;
    if (score > best) best = score;
  }
  const verdict = best >= FAITHFUL_THRESHOLD ? 'FAITHFUL' : best >= LOOSE_THRESHOLD ? 'LOOSE' : 'DECORATIVE';
  results.push({ path: citPath, verdict, score: best, instances: instances.length });
}

// ── Verdict ──
const warnItems = results.filter((r) => r.verdict === 'UNSTAMPED' || r.verdict === 'DECORATIVE');

const hardFailures = [];
if (invalidCitations.length) {
  hardFailures.push(`${invalidCitations.length} cited path(s) do not exist in the vendored set: ${invalidCitations.join(', ')}`);
}
if (uncitedStamps.length) {
  hardFailures.push(`${uncitedStamps.length} data-hyperui value(s) stamped in the shipped output but NOT cited in status.md: ${uncitedStamps.join(', ')}`);
}
if (warnItems.length) {
  const summary = warnItems.map((r) => `${r.path} (${r.verdict}${r.score === null ? '' : `, ${r.score.toFixed(2)}`})`).join(', ');
  hardFailures.push(`${warnItems.length} citation(s) UNSTAMPED or DECORATIVE (promoted to hard FAIL 2026-08-18, see header): ${summary}. Fix: either genuinely transplant the cited component's real structure, or cite a different component that the shipped markup actually resembles.`);
}
if (hashFailures.length) {
  hardFailures.push(`${hashFailures.length} citation(s) failed the proof-of-read hash check: ${hashFailures.join('; ')}`);
}

console.log('\nHyperUI transplant fidelity — per citation:');
console.log('  path'.padEnd(42) + 'verdict'.padEnd(12) + 'score'.padEnd(8) + 'instances');
for (const r of results) {
  const scoreStr = r.score === null ? '-' : r.score.toFixed(2);
  console.log(`  ${r.path}`.padEnd(42) + r.verdict.padEnd(12) + scoreStr.padEnd(8) + String(r.instances));
}
if (invalidCitations.length) {
  console.log(`  (${invalidCitations.length} additional cited path(s) invalid — not scored: ${invalidCitations.join(', ')})`);
}
console.log('');

if (hardFailures.length) {
  console.log(`HYPERUI_TRANSPLANT_CHECK=FAIL — ${hardFailures.join('; ')}`);
  process.exit(1);
}

// ── Persistence, PASS/WARN only (a hard FAIL already exited above — never pollute the ledger with
// a build that shouldn't deploy). Same file, same "own record, on a pass condition" pattern
// hyperui-usage-check.mjs already uses for hyperuiMarketingCitations/layoutSignatures. This is for
// FUTURE CALIBRATION ANALYSIS ONLY — nothing reads transplantScores back for a gate decision yet. ──
const FINGERPRINT_LEDGER = join(REPO_ROOT, 'data', 'design-fingerprints.json');
const scored = results.filter((r) => r.score !== null);
if (scored.length) {
  // 2026-08-18 (Fable): mkdir-based lock — this file is unlocked-read-modify-written by five
  // separate scripts, and two concurrent QA batteries (once dispatch goes multi-lane, WATCH_DIR
  // already supports it) can silently drop each other's record without one. See lib/file-lock.mjs.
  await withFileLock(FINGERPRINT_LEDGER, () => {
    let ledger = [];
    if (existsSync(FINGERPRINT_LEDGER)) {
      try {
        const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
        if (Array.isArray(parsed)) ledger = parsed;
      } catch {
        console.log('HYPERUI_TRANSPLANT_NOTE — design-fingerprints.json unreadable; transplant scores not persisted this run');
        return;
      }
    }
    const own = ledger.find((r) => r.slug === slug);
    if (own) {
      own.transplantScores = Object.fromEntries(scored.map((r) => [r.path, Math.round(r.score * 100) / 100]));
      writeFileSync(FINGERPRINT_LEDGER, JSON.stringify(ledger, null, 2));
    } else {
      console.log(`HYPERUI_TRANSPLANT_NOTE — no design-fingerprints.json record for ${slug} (design-ledger.mjs record not run?); transplant scores not persisted this run`);
    }
  });
}

// Any UNSTAMPED/DECORATIVE verdict is already folded into hardFailures above and exits before here.
console.log(`HYPERUI_TRANSPLANT_CHECK=PASS — ${results.length} citation(s) checked, all stamped and structurally faithful or a legitimate adaptation.`);
process.exit(0);
