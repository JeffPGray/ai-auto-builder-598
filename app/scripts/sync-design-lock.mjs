#!/usr/bin/env node
/**
 * sync-design-lock.mjs <slug>
 *
 * Stamps status.md from this client's eight-line lock, then refuses a lock that
 * is too close to another client's (unique BETWEEN sites). Coherence WITHIN a
 * site is the three axes of ONE lock — not a shared page template.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STOP = new Set(['the','a','an','and','or','of','to','in','on','for','with','as','from','into','that','this','site','page']);
function toks(s) {
  return new Set((String(s).toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((w) => !STOP.has(w)));
}
function jaccard(a, b) {
  const A = toks(a); const B = toks(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / new Set([...A, ...B]).size;
}

const slug = process.argv[2];
if (!slug) {
  console.error('usage: sync-design-lock.mjs <slug>');
  process.exit(1);
}

const lockPath = join('clients', slug, 'data', 'design-lock.md');
const statusPath = join('clients', slug, 'data', 'status.md');
if (!existsSync(lockPath)) {
  console.error(`missing ${lockPath} — write the lock first (stages/consult-once.md)`);
  process.exit(2);
}

const lock = readFileSync(lockPath, 'utf8');
const get = (k) => (lock.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi')) || [])[1]?.trim() || '';
const idea = get('DESIGN_IDEA');
const move = get('SIGNATURE MOVE');
const canvas = get('CANVAS');
const type = get('HEADING / BODY') || get('HEADING/BODY');
const ground = get('GROUND');
const accent = get('ACCENT');
if (!idea || !move) {
  console.error('design-lock.md needs DESIGN_IDEA: and SIGNATURE MOVE: lines');
  process.exit(2);
}

const locksFile = join('data', 'design-locks.jsonl');
if (existsSync(locksFile)) {
  for (const line of readFileSync(locksFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let prev;
    try { prev = JSON.parse(line); } catch { continue; }
    if (!prev?.slug || prev.slug === slug) continue;
    const j = Math.max(jaccard(move, prev.move || ''), jaccard(idea, prev.idea || ''));
    if (j >= 0.45) {
      console.error(`LOCK_TWIN=${prev.slug} overlap=${j.toFixed(2)} — this SIGNATURE MOVE/DESIGN_IDEA is too close to another client. Invent from THIS gather; do not reuse a kit.`);
      process.exit(1);
    }
  }
}

const block = [
  `DESIGN_IDEA=${idea}`,
  `- Hero archetype: from SIGNATURE MOVE (${move})`,
  `- Signature move 1: ${move}`,
  `- Signature move 2: canvas — ${canvas || 'not recorded'}`,
  `- Signature move 3: type+ground — ${[type, ground, accent].filter(Boolean).join(' / ') || 'not recorded'}`,
  `- Differs from the last 8 builds: lock is compositional (${move.slice(0, 80)})`,
  `GROUND=${ground || 'NEUTRAL-CANVAS'}`,
].join('\n');

let status = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : `# ${slug}\n\n`;
if (/DESIGN_IDEA\s*=/.test(status)) {
  status = status.replace(/DESIGN_IDEA[\s\S]*?(?=\n[A-Z_]{3,}=|\n## |\n$|$)/, `${block}\n`);
} else {
  status = status.trimEnd() + `\n\n${block}\n`;
}
writeFileSync(statusPath, status);
mkdirSync('data', { recursive: true });
const rows = [];
if (existsSync(locksFile)) {
  for (const line of readFileSync(locksFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      if (p.slug && p.slug !== slug) rows.push(p);
    } catch { /* skip */ }
  }
}
rows.push({ slug, idea, move, canvas, type, ground, accent });
writeFileSync(locksFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`synced lock → ${statusPath}`);
console.log(block);
process.exit(0);
