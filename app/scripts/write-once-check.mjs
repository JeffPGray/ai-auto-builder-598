#!/usr/bin/env node
/**
 * write-once-check.mjs — fail a second Write to the same route page.tsx.
 *
 * Measured (cold-front-ac): 34 Writes across 13 routes. That iteration belongs
 * before the write, not after. Children on experiment/speed-cut are single-shot:
 * one Write per route, then exit. This script is the mechanical backstop.
 *
 *   node scripts/write-once-check.mjs SLUG --note src/app/about/page.tsx
 *   node scripts/write-once-check.mjs SLUG            # print log; exit 1 if any path >1
 *
 * Log lives in clients/<slug>/data/write-once.json — gather/data, never site/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const slug = process.argv[2];
if (!slug) {
  console.error('usage: write-once-check.mjs SLUG [--note relative/path.tsx]');
  process.exit(1);
}
const noteIdx = process.argv.indexOf('--note');
const note = noteIdx >= 0 ? process.argv[noteIdx + 1] : null;
const logPath = join('clients', slug, 'data', 'write-once.json');

function load() {
  if (!existsSync(logPath)) return { slug, paths: {} };
  try {
    return JSON.parse(readFileSync(logPath, 'utf8'));
  } catch {
    return { slug, paths: {} };
  }
}

function norm(p) {
  return normalize(String(p).replace(/^\/+/, '')).replace(/\\/g, '/');
}

const state = load();
state.paths = state.paths || {};

if (note) {
  const p = norm(note);
  const n = (state.paths[p] || 0) + 1;
  state.paths[p] = n;
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, JSON.stringify(state, null, 2));
  if (n > 1) {
    console.error(`WRITE_ONCE=FAIL path=${p} count=${n} — second Write to the same route. Fix in the child before Write, do not iterate.`);
    process.exit(1);
  }
  console.log(`WRITE_ONCE=OK path=${p} count=1`);
  process.exit(0);
}

const dupes = Object.entries(state.paths).filter(([, n]) => n > 1);
for (const [p, n] of Object.entries(state.paths)) {
  console.log(`  ${n}  ${p}`);
}
if (dupes.length) {
  console.error(`WRITE_ONCE=FAIL ${dupes.length} path(s) written more than once`);
  process.exit(1);
}
console.log(`WRITE_ONCE=PASS files=${Object.keys(state.paths).length}`);
process.exit(0);
