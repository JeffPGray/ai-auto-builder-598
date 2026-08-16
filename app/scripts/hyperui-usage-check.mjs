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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const MIN_MARKETING_SECTIONS = 4;
const MIN_MARKETING_CATEGORIES = 3;
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
