#!/usr/bin/env node
/**
 * build-hyperui-index.mjs
 *
 * Builds a searchable JSON index over the vendored HyperUI reference set at
 * .claude/skills/build/reference/hyperui/ — 469 files (295 application components + 174 marketing
 * sections) fetched live from github.com/markmead/hyperui on 2026-08-16.
 *
 * WHY AN INDEX INSTEAD OF LEAVING IT AS A DIRECTORY TREE: 469 files across 56 categories is too
 * much to browse blindly inside a build session — `ls`-ing every directory burns turns the pipeline
 * doesn't have (this project's own measurement: 86% of build wall-clock is token generation, so
 * wasted exploration is directly expensive). This script pre-extracts, once, what a build actually
 * needs to DECIDE whether a file is worth reading in full: category, light/dark variant, rough
 * complexity (line count), and a lightweight signal for whether the file leans structural (few/no
 * color classes, little copy) vs content-heavy (the ones needing the most rewriting).
 *
 * Run once after vendoring; re-run if the reference set changes. Output:
 *   .claude/skills/build/reference/hyperui/index.json — the full structured index.
 *   .claude/skills/build/reference/hyperui/INDEX.md    — a human/model-readable summary table,
 *     grouped by category, so a build can grep ONE small file instead of walking the tree.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills', 'build', 'reference', 'hyperui');

// Optional hand-written visual descriptors (reference/hyperui/descriptors.json, keyed by path).
// Written 2026-08-17 from the rendered components on hyperui.dev — they describe what each file
// LOOKS like (layout, composition, imagery, controls), which the mechanical stats below cannot.
// Merged into INDEX.md as an indented "↳" line under each entry so a regeneration of this index
// never wipes them; dark variants automatically cross-reference their light sibling's descriptor.
let descriptors = {};
try {
  descriptors = JSON.parse(readFileSync(join(ROOT, 'descriptors.json'), 'utf8'));
} catch { /* sidecar absent — index still builds, just without descriptor lines */ }
const descriptorFor = (path) => {
  if (descriptors[path]) return descriptors[path];
  const m = path.match(/^(.*\/)(\d+)-dark\.html$/);
  if (m && descriptors[`${m[1]}${m[2]}.html`]) {
    return `dark-scheme variant of \`${m[1]}${m[2]}.html\` — same layout (see its descriptor)`;
  }
  return null;
};

const APPLICATION_CATEGORIES = new Set([
  'accordions', 'badges', 'breadcrumbs', 'button-groups', 'charts', 'checkboxes', 'details-list',
  'dividers', 'dropdown', 'empty-states', 'file-uploaders', 'filters', 'grids', 'inputs', 'loaders',
  'media', 'modals', 'pagination', 'progress-bars', 'quantity-inputs', 'radio-groups',
  'range-inputs', 'selects', 'side-menu', 'skip-links', 'stats', 'steps', 'tables', 'tabs',
  'textareas', 'timelines', 'toasts', 'toggles', 'vertical-menu',
]);

const entries = [];
for (const dirName of readdirSync(ROOT)) {
  const dirPath = join(ROOT, dirName);
  if (!statSync(dirPath).isDirectory()) continue;

  const isMarketing = dirName.startsWith('marketing-');
  const category = isMarketing ? dirName.replace(/^marketing-/, '') : dirName;
  const tier = isMarketing ? 'marketing' : 'application';

  for (const file of readdirSync(dirPath)) {
    if (!file.endsWith('.html')) continue;
    const filePath = join(dirPath, file);
    const src = readFileSync(filePath, 'utf8');
    const isDark = /-dark\.html$/.test(file);

    // Rough content-weight signal: how many words of text sit inside tags vs how much is markup.
    // A high ratio means "this file's VALUE is mostly copy" (marketing sections, most of them);
    // a low ratio means "this file's VALUE is mostly structure/behaviour" (most application
    // components) — exactly the axis build/SKILL.md's guidance cares about.
    const bodyMatch = src.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : src;
    const textContent = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = textContent ? textContent.split(' ').length : 0;
    const hasLoremIpsum = /lorem,?\s+ipsum/i.test(src);
    const colorClasses = [...new Set(src.match(/\b(bg|text|border|ring|from|via|to)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|slate|zinc|neutral|stone)-\d{2,3}\b/g) || [])].sort();

    entries.push({
      tier,               // 'application' | 'marketing'
      category,           // e.g. 'accordions', 'ctas'
      file,               // e.g. '1-dark.html'
      path: `${dirName}/${file}`,  // relative to reference/hyperui/
      variant: isDark ? 'dark' : 'light',
      wordCount,
      hasLoremIpsum,
      genericColorClasses: colorClasses,
    });
  }
}

entries.sort((a, b) => a.tier === b.tier ? (a.category === b.category ? a.file.localeCompare(b.file) : a.category.localeCompare(b.category)) : a.tier.localeCompare(b.tier));

writeFileSync(join(ROOT, 'index.json'), JSON.stringify({ generated: 'vendored 2026-08-16 from github.com/markmead/hyperui', total: entries.length, entries }, null, 2));

// ── Human/model-readable summary, grouped by category ──
const byTier = { application: {}, marketing: {} };
for (const e of entries) {
  (byTier[e.tier][e.category] ??= []).push(e);
}

let md = `# HyperUI reference index\n\n${entries.length} files vendored from github.com/markmead/hyperui on 2026-08-16.\n\n`;
md += `**Every entry with hasLoremIpsum=true or any genericColorClasses MUST have that content/colour replaced before shipping** — see build/SKILL.md § "EXPERIMENT BRANCH ONLY — HyperUI component reference".\n\n`;
if (Object.keys(descriptors).length) {
  md += `> Entries with an indented \`↳\` line carry a visual descriptor (layout, composition, imagery, controls) taken from the rendered component — search these to pick the right structure for a section instead of citing blind. Quoted names are HyperUI's official component titles. Source of truth: \`descriptors.json\` in this directory (merged in by \`scripts/build-hyperui-index.mjs\`; edit the JSON, not this file).\n\n`;
}

for (const [tierName, cats] of Object.entries(byTier)) {
  md += `## ${tierName === 'application' ? 'Application (UI primitives — structure/technique)' : 'Marketing (sections — content-heavy, rewrite everything)'}\n\n`;
  for (const [cat, files] of Object.entries(cats).sort(([a], [b]) => a.localeCompare(b))) {
    const loremCount = files.filter((f) => f.hasLoremIpsum).length;
    md += `### ${cat} (${files.length} files${loremCount ? `, ${loremCount} carry lorem ipsum` : ''})\n`;
    for (const f of files) {
      const dirName = tierName === 'marketing' ? `marketing-${cat}` : cat;
      const flags = [f.variant === 'dark' ? 'dark' : null, f.hasLoremIpsum ? 'LOREM' : null].filter(Boolean).join(',');
      md += `- \`${dirName}/${f.file}\`${flags ? ` [${flags}]` : ''} — ~${f.wordCount}w`;
      if (f.genericColorClasses.length) md += `, colours: ${f.genericColorClasses.slice(0, 4).join(' ')}${f.genericColorClasses.length > 4 ? '…' : ''}`;
      md += '\n';
      const desc = descriptorFor(`${dirName}/${f.file}`);
      if (desc) md += `  ↳ ${desc}\n`;
    }
    md += '\n';
  }
}

writeFileSync(join(ROOT, 'INDEX.md'), md);

console.log(`Indexed ${entries.length} files (${entries.filter((e) => e.tier === 'application').length} application, ${entries.filter((e) => e.tier === 'marketing').length} marketing)`);
console.log(`  ${entries.filter((e) => e.hasLoremIpsum).length} carry lorem ipsum placeholder text`);
console.log(`  Wrote index.json + INDEX.md`);
