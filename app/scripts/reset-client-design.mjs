#!/usr/bin/env node
/**
 * reset-client-design.mjs <slug> [--yes]
 *
 * Clears a client's DESIGN state for a clean re-design pass, while KEEPING gather.
 *
 * WHY THIS EXISTS. On 2026-08-19 a design reset was done by hand: site/ deleted and status.md's
 * design lines stripped. `data/design-fingerprints.json` was NOT cleared, so it still held the
 * previous build's "Bodoni Moda / Albert Sans". The next build shipped Zilla Slab / Archivo and QA
 * correctly raised a CRITICAL claim-vs-artifact drift failure against a ledger entry that was simply
 * stale. A partial reset is worse than no reset: it makes the audit trail lie.
 *
 * Never touches gathered-content.md, images/, or docs/ — re-gathering is expensive and the content
 * is not what is being reset.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const slug = process.argv[2];
const YES = process.argv.includes('--yes');
if (!slug) { console.error('usage: reset-client-design.mjs <slug> [--yes]'); process.exit(1); }
const dir = join('clients', slug);
if (!existsSync(dir)) { console.error(`no client at ${dir}`); process.exit(2); }

const actions = [];
const sitePath = join(dir, 'site');
if (existsSync(sitePath)) actions.push(['rm -rf', sitePath]);

const statusPath = join(dir, 'data', 'status.md');
const STALE = [/VERIFY_GATES_OK_AT=.*\n/g, /DESIGN_IDEA\s*=.*\n/g, /- Signature move \d+:.*\n/gi,
  /- Hero archetype:.*\n/gi, /GROUND=.*\n/g, /- Palette family:.*\n/gi, /- Character:.*\n/gi,
  /- Harmony:.*\n/gi, /- Layout pattern:.*\n/gi, /DESIGN_SYSTEM=.*\n/g, /- Heading:.*\n/gi,
  /- Body font:.*\n/gi, /CANVAS_MODE=.*\n/g];
if (existsSync(statusPath)) actions.push(['strip design lines', statusPath]);

const fpPath = join('data', 'design-fingerprints.json');
let fpHit = false;
if (existsSync(fpPath)) {
  const raw = JSON.parse(readFileSync(fpPath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.builds || raw.records || []);
  fpHit = rows.some((r) => r.slug === slug);
  if (fpHit) actions.push(['drop fingerprint row', `${fpPath} (slug=${slug})`]);
}

for (const [what, where] of actions) console.log(`  ${what.padEnd(22)} ${where}`);
if (!actions.length) { console.log('  nothing to reset'); process.exit(0); }
if (!YES) { console.log('\n  dry run — pass --yes to apply\n'); process.exit(0); }

if (existsSync(sitePath)) rmSync(sitePath, { recursive: true, force: true });
if (existsSync(statusPath)) {
  let s = readFileSync(statusPath, 'utf8');
  for (const re of STALE) s = s.replace(re, '');
  writeFileSync(statusPath, s);
}
if (fpHit) {
  const raw = JSON.parse(readFileSync(fpPath, 'utf8'));
  if (Array.isArray(raw)) writeFileSync(fpPath, JSON.stringify(raw.filter((r) => r.slug !== slug), null, 2));
  else {
    for (const k of ['builds', 'records']) if (Array.isArray(raw[k])) raw[k] = raw[k].filter((r) => r.slug !== slug);
    writeFileSync(fpPath, JSON.stringify(raw, null, 2));
  }
}
console.log('\n  design state reset. gather/content/images untouched.\n');
