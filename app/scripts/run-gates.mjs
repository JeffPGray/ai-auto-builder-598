#!/usr/bin/env node
/**
 * run-gates.mjs <slug> [--json] [--only a,b] [--except a,b] [--out FILE] [--quiet]
 *
 * ONE command, ONE verdict block, ONE exit code for every deterministic gate.
 *
 * WHY. "Did all the gates pass?" was not an observable fact. It was a conclusion a model assembled
 * by hand from a dozen separate log files, at the end of a long context, after writing thousands of
 * words — and assembly is where verdicts went missing. The measured failures on 2026-08-19:
 * HERO_VIDEO_PLAYBACK_CHECK=FAIL scrolled past into a recorded HERO_VIDEO=OK; a gate that crashed
 * printed no verdict at all and was read as fine; a WARN and a FAIL sat in adjacent log files with
 * nothing summing them. None of those are judgement errors. They are all the same clerical error,
 * and clerical errors are what scripts are for.
 *
 * This does not replace any gate. It runs the ones already in the pipeline, concurrently, and
 * prints a single block that cannot be partially read:
 *
 *     ══ GATE VERDICTS — cold-front-ac ══
 *       PASS   font              1.9s   Webfont actually loaded ...
 *       FAIL   richness          0.6s   Visual richness ...
 *       ...
 *     ══ 11 gates: 9 PASS, 1 FAIL, 1 SKIP  ⇒  GATES=FAIL ══
 *
 * and exits non-zero if any gate failed. `GATES=PASS` on the last line is the single string
 * anything downstream should ever check.
 *
 * SIDE-EFFECT FREE, DELIBERATELY. No --fix, no writes into the client tree. That is what makes it
 * safe to run twice and diff — which is exactly what verify-fix.mjs does to prove a fix landed.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { GATES, gateById, runGate, isFailing, siteDirFor, ensureQaServer } from './lib/gates.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const JSON_OUT = args.includes('--json');
const QUIET = args.includes('--quiet');
const listOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
};
const only = listOf('--only');
const except = listOf('--except') || [];
const outIdx = args.indexOf('--out');
const outFile = outIdx === -1 ? null : args[outIdx + 1];

if (!slug) {
  console.error('usage: run-gates.mjs <slug> [--json] [--only a,b] [--except a,b] [--out FILE] [--quiet]');
  console.error(`gates: ${GATES.map((g) => g.id).join(', ')}`);
  process.exit(2);
}
if (!existsSync(siteDirFor(slug))) {
  console.error(`run-gates: no site at ${siteDirFor(slug)}`);
  process.exit(2);
}

let selected = only ? only.map(gateById).filter(Boolean) : GATES;
selected = selected.filter((g) => !except.includes(g.id));
if (only) {
  const unknown = only.filter((id) => !gateById(id));
  if (unknown.length) { console.error(`run-gates: unknown gate(s): ${unknown.join(', ')}`); process.exit(2); }
}

// Gates that drive a browser need the shared QA server. Start it ourselves rather than skipping
// them: "one command that runs every deterministic gate" has to actually run every one, and a
// harness-induced SKIP reads exactly like a clean result at a glance. Torn down at the end, with
// .qa-port restored, so this never disturbs an in-flight QA round.
const server = GATES.some((g) => g.needsServer && selected.includes(g)) ? await ensureQaServer(slug) : { up: false, stop: () => {} };
const serverUp = server.up;

const COLS = { PASS: '\x1b[32m', FAIL: '\x1b[31m', ERROR: '\x1b[31m', INTEGRITY: '\x1b[35m', MISSING: '\x1b[35m', WARN: '\x1b[33m', SKIP: '\x1b[90m' };
const paint = (v) => (process.stdout.isTTY ? `${COLS[v] || ''}${v}\x1b[0m` : v);

const results = await Promise.all(selected.map(async (g) => {
  if (g.needsServer && !serverUp) {
    return {
      id: g.id, verdict: 'ERROR', ms: 0, exitCode: null, gate: g,
      note: `the shared QA server could not be started for this client, so this gate DID NOT RUN. ` +
            'That is a failure of the harness, not a pass: try `node scripts/qa-serve.mjs ' +
            `clients/${slug}/site` + '` by hand and read its error.',
    };
  }
  const r = await runGate(g, slug);
  return { ...r, gate: g };
}));

const failed = results.filter((r) => isFailing(r.gate, r.verdict));
const verdict = failed.length ? 'FAIL' : 'PASS';

if (JSON_OUT || outFile) {
  const payload = {
    slug,
    at: new Date().toISOString(),
    verdict,
    serverUp,
    gates: results.map((r) => ({
      id: r.id, verdict: r.verdict, exitCode: r.exitCode, ms: r.ms,
      failing: isFailing(r.gate, r.verdict), note: r.note || null,
      // The failure lines only. Full stdout would make a snapshot file unreadable and unusable
      // for diffing, and the failure lines are what a fix has to change.
      detail: (r.output || '').split('\n').filter((l) => /^\s*(FAIL|warn|ERROR)\b/.test(l)).slice(0, 40),
    })),
  };
  const text = JSON.stringify(payload, null, 2);
  if (outFile) writeFileSync(outFile, text);
  if (JSON_OUT) console.log(text);
}

if (!QUIET && !JSON_OUT) {
  console.log(`\n══ GATE VERDICTS — ${slug} ══`);
  for (const r of results) {
    const flag = isFailing(r.gate, r.verdict) ? '‼' : ' ';
    console.log(`${flag} ${paint(r.verdict.padEnd(9))} ${r.id.padEnd(17)} ${(r.ms / 1000).toFixed(1)}s  ${r.gate.label}`);
    if (r.note) console.log(`      ${r.note}`);
    for (const line of (r.output || '').split('\n').filter((l) => /^\s*(FAIL|ERROR)\b/.test(l)).slice(0, 12)) {
      console.log(`      ${line.trim()}`);
    }
  }
  const tally = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
  const summary = Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`══ ${results.length} gates: ${summary}  ⇒  GATES=${verdict} ══\n`);
  if (failed.length) {
    console.log(`  ${failed.length} gate(s) must be fixed before this build ships: ${failed.map((f) => f.id).join(', ')}`);
    console.log('  Do NOT overrule a FAIL by eye. Each of these proves a named claim against a checkable fact.\n');
  }
}

server.stop();
process.exit(failed.length ? 1 : 0);
