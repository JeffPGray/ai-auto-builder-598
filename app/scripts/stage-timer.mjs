#!/usr/bin/env node
/**
 * stage-timer.mjs — per-stage wall-clock for a Klaudius build.
 *
 * WHY: cost_ledger.py only records one `build-total` blob. That is why hillards
 * (150.4 min) and a 5-min fragment are indistinguishable: author vs gates vs
 * QA Playwright vs deploy are collapsed. This file is the split.
 *
 * Sinks: data/stage-timer.jsonl (append-only) AND cost_ledger.py `record`
 * with --stage so `show SLUG` lists them. Never writes under clients/<slug>/site.
 *
 *   node scripts/stage-timer.mjs start SLUG copy-template
 *   node scripts/stage-timer.mjs end   SLUG copy-template
 *   node scripts/stage-timer.mjs show  SLUG
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKS = join(ROOT, 'data', 'stage-timer-marks.json');
const LOG = join(ROOT, 'data', 'stage-timer.jsonl');
const STAGES = new Set([
  'copy-template',
  'design',
  'author',
  'blogs',
  'gates',
  'qa-round-1',
  'qa-fix',
  'qa-round-2',
  'deploy',
]);

const cmd = process.argv[2];
const slug = process.argv[3];
const stage = process.argv[4];

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function loadMarks() {
  if (!existsSync(MARKS)) return {};
  try {
    return JSON.parse(readFileSync(MARKS, 'utf8'));
  } catch {
    return {};
  }
}

function saveMarks(m) {
  mkdirSync(dirname(MARKS), { recursive: true });
  writeFileSync(MARKS, JSON.stringify(m, null, 2));
}

function append(entry) {
  mkdirSync(dirname(LOG), { recursive: true });
  if (LOG.includes(`${join('clients')}${join('/', '')}`)) {
    /* belt: never write under clients/ */
  }
  if (LOG.split('/').includes('clients') && LOG.includes('/site/')) {
    die(`refusing to write timer under a client site: ${LOG}`);
  }
  appendFileSync(LOG, JSON.stringify(entry) + '\n');
}

function ledgerNote(slugName, stageName, ms, extra) {
  const py = join(ROOT, 'scripts', 'cost_ledger.py');
  const mins = (ms / 60000).toFixed(1);
  spawnSync('python3', [py, 'record', slugName, '--usd', '0', '--stage', stageName, '--note', `${mins} min wall${extra ? ` ${extra}` : ''}`], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}

if (cmd === 'start') {
  if (!slug || !stage) die('usage: stage-timer.mjs start SLUG STAGE');
  if (!STAGES.has(stage)) die(`unknown stage "${stage}". one of: ${[...STAGES].join(', ')}`);
  const marks = loadMarks();
  marks[`${slug}::${stage}`] = Date.now();
  saveMarks(marks);
  const entry = { ts: new Date().toISOString(), slug, stage, event: 'start' };
  append(entry);
  console.log(`STAGE_TIMER=START slug=${slug} stage=${stage}`);
  process.exit(0);
}

if (cmd === 'end') {
  if (!slug || !stage) die('usage: stage-timer.mjs end SLUG STAGE');
  const marks = loadMarks();
  const key = `${slug}::${stage}`;
  const started = marks[key];
  const ended = Date.now();
  const ms = typeof started === 'number' ? ended - started : null;
  delete marks[key];
  saveMarks(marks);
  const entry = {
    ts: new Date().toISOString(),
    slug,
    stage,
    event: 'end',
    ms,
    startedAt: started ? new Date(started).toISOString() : null,
  };
  append(entry);
  if (ms != null) ledgerNote(slug, stage, ms);
  console.log(
    ms == null
      ? `STAGE_TIMER=END slug=${slug} stage=${stage} ms=? (no matching start)`
      : `STAGE_TIMER=END slug=${slug} stage=${stage} ms=${ms} min=${(ms / 60000).toFixed(1)}`,
  );
  process.exit(0);
}

if (cmd === 'show') {
  if (!slug) die('usage: stage-timer.mjs show SLUG');
  if (!existsSync(LOG)) {
    console.log(`no stage-timer log yet`);
    process.exit(0);
  }
  const rows = readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.slug === slug);
  for (const e of rows) {
    const extra = e.event === 'end' && e.ms != null ? ` ${(e.ms / 60000).toFixed(1)} min` : '';
    console.log(`  ${e.ts}  ${e.stage.padEnd(14)} ${e.event}${extra}`);
  }
  process.exit(0);
}

die(`usage: stage-timer.mjs start|end|show SLUG [STAGE]
stages: ${[...STAGES].join(' ')}`);
