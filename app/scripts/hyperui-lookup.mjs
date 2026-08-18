#!/usr/bin/env node
/**
 * hyperui-lookup.mjs — zero-cost, zero-model deterministic query over the vendored HyperUI
 * index (.claude/skills/build/reference/hyperui/index.json).
 *
 * WHY THIS EXISTS (HYPERUI-01, lever 1 + 3): a build that needs ONE accordion example was
 * reading the full 591-line INDEX.md (469 files across 56 categories) top to bottom to find it —
 * linear scanning regardless of what was actually needed. This script returns only the matching
 * category's entries. It is a filter over data that already exists (index.json, built once by
 * build-hyperui-index.mjs) — no GitHub calls, no model call, no reasoning. "Given a category
 * name, return matching filenames" doesn't need Haiku, it needs no model at all — this script
 * does it for literal $0 and ~0 tokens, which beats even the cheapest model tier.
 *
 * Usage:
 *   node scripts/hyperui-lookup.mjs <category> [--tier application|marketing]
 *   node scripts/hyperui-lookup.mjs --list-categories [--tier application|marketing]
 *
 * Output: one line per matching file, plain text, light variants before dark:
 *   <path> [LOREM] words=<n> colours=<a,b,c>
 * <path> is relative to .claude/skills/build/reference/hyperui/ and directly Read-able from
 * there — e.g. `accordions/1.html` or `marketing-ctas/3-dark.html`.
 *
 * When reference/hyperui/descriptors.json has a visual descriptor for a file (added 2026-08-17,
 * written from the rendered components on hyperui.dev), it is appended as an indented
 * continuation line so a build can pick the RIGHT structure for a section from the lookup output
 * alone — without opening candidate files one by one. Dark variants inherit their light sibling's
 * descriptor by cross-reference.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills', 'build', 'reference', 'hyperui');

let index;
try {
  index = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
} catch {
  console.error(`no index.json at ${ROOT} — this is experiment-branch-only tooling; run build-hyperui-index.mjs first if the reference set is present`);
  process.exit(2);
}

const args = process.argv.slice(2);
const tierFlagIdx = args.indexOf('--tier');
const tierFilter = tierFlagIdx >= 0 ? args[tierFlagIdx + 1] : null;
if (tierFilter && !['application', 'marketing'].includes(tierFilter)) {
  console.error(`--tier must be "application" or "marketing", got "${tierFilter}"`);
  process.exit(2);
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(tierFlagIdx >= 0 && i === tierFlagIdx + 1));

if (args.includes('--list-categories')) {
  const cats = [...new Set(index.entries.filter((e) => !tierFilter || e.tier === tierFilter).map((e) => `${e.tier}/${e.category}`))].sort();
  console.log(cats.join('\n'));
  process.exit(0);
}

const category = positional[0];
if (!category) {
  console.error('usage: hyperui-lookup.mjs <category> [--tier application|marketing]');
  console.error('       hyperui-lookup.mjs --list-categories [--tier application|marketing]');
  process.exit(2);
}

const matches = index.entries.filter((e) => e.category === category && (!tierFilter || e.tier === tierFilter));
if (!matches.length) {
  console.error(`no entries for category "${category}"${tierFilter ? ` (tier=${tierFilter})` : ''} — run --list-categories to see valid names`);
  process.exit(1);
}

let descriptors = {};
try {
  descriptors = JSON.parse(readFileSync(join(ROOT, 'descriptors.json'), 'utf8'));
} catch { /* sidecar absent — output stays mechanical-stats-only */ }

matches.sort((a, b) => (a.variant === b.variant ? a.file.localeCompare(b.file) : a.variant.localeCompare(b.variant)));
for (const e of matches) {
  const flags = e.hasLoremIpsum ? ' [LOREM]' : '';
  const colours = e.genericColorClasses.length ? ` colours=${e.genericColorClasses.slice(0, 4).join(',')}` : '';
  console.log(`${e.path}${flags} words=${e.wordCount}${colours}`);
  const darkSibling = e.variant === 'dark' ? e.path.replace(/-dark\.html$/, '.html') : null;
  if (descriptors[e.path]) console.log(`  ↳ ${descriptors[e.path]}`);
  else if (darkSibling && descriptors[darkSibling]) console.log(`  ↳ dark-scheme variant of ${darkSibling} — same layout`);
}
