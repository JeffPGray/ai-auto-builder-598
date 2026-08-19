#!/usr/bin/env node
/**
 * verify-fix.mjs <slug> --snapshot FILE      # BEFORE /qa-fix: record every gate's verdict
 * verify-fix.mjs <slug> --against  FILE      # AFTER  /qa-fix: re-run, diff, prove the fix landed
 *                                            #   [--only-failed]  cheap mode: re-run only the
 *                                            #                    gates that were failing
 *                                            #   [--json]
 *
 * WHAT WAS MISSING. The loop was: QA agent writes a report -> /qa-fix edits files -> next QA round
 * re-derives everything from scratch. Nothing in that loop ever asked "did the edit fix the thing
 * it was for?". A fix was assumed to work because it was attempted. The next round might catch a
 * non-fix — as a brand new finding, with no memory that it had already been "fixed" once — and
 * might equally miss it, because round 2+ is scoped.
 *
 * THE MECHANISM, and why this one. The cheapest reliable evidence that a fix landed is a
 * BEFORE/AFTER diff of the deterministic gates' own verdicts: they are scripts, they are already
 * in the pipeline, they cost seconds, and unlike a screenshot re-review they cannot be lenient
 * because they already know what the fixer was trying to do. Three outcomes matter and each is
 * named separately, because they need different responses:
 *
 *   FIXED       FAIL -> PASS. Done.
 *   NOT-FIXED   FAIL -> FAIL. The fixer edited files and the gate's complaint did not move. When
 *               the failure lines are BYTE-IDENTICAL this is stated outright: that is the
 *               strongest evidence there is that the edit missed the defect, and it is precisely
 *               what "assume the fix worked" hides.
 *   REGRESSED   PASS -> FAIL. The fix broke something that was fine. This is the expensive one and
 *               it is the reason the default is to re-run EVERYTHING rather than only the gates
 *               that were already failing — a fixer that touches globals.css while "just fixing a
 *               typo" is a known, documented failure shape in this pipeline, and a run restricted
 *               to the previously-failing gates is structurally blind to it. --only-failed exists
 *               for when you have already paid for a full battery elsewhere in the same round.
 *
 * HONEST LIMIT, stated in the output too: this adjudicates GATE-BACKED findings only. A QA finding
 * that came from looking at a screenshot ("this photo doesn't match the business") has no gate, so
 * this cannot confirm it and does not pretend to — it lists those as UNADJUDICATED so the count of
 * findings a human still has to confirm is visible rather than silently rounded down to zero.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { GATES, gateById, runGate, isFailing, ensureQaServer } from './lib/gates.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const JSON_OUT = args.includes('--json');
const ONLY_FAILED = args.includes('--only-failed');
const grab = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const snapshotTo = grab('--snapshot');
const against = grab('--against');

if (!slug || (!snapshotTo && !against)) {
  console.error('usage: verify-fix.mjs <slug> --snapshot FILE   (before /qa-fix)');
  console.error('       verify-fix.mjs <slug> --against  FILE   (after /qa-fix) [--only-failed] [--json]');
  process.exit(2);
}

// ---- shared QA server, started here if absent so browser gates are never falsely un-run --------
let server = { up: false, stop: () => {} };
const teardown = () => server.stop();
process.on('exit', teardown);

const failureLines = (out) => (out || '').split('\n')
  .filter((l) => /^\s*(FAIL|ERROR)\b/.test(l))
  .map((l) => l.trim());

async function runAll(gates) {
  if (gates.some((g) => g.needsServer) && !server.up) server = await ensureQaServer(slug);
  return Promise.all(gates.map(async (g) => {
    const r = await runGate(g, slug);
    return {
      id: g.id, verdict: r.verdict, failing: isFailing(g, r.verdict),
      lines: failureLines(r.output), note: r.note || null,
    };
  }));
}

// ---- MODE 1: snapshot -------------------------------------------------------------------------
if (snapshotTo) {
  const gates = await runAll(GATES);
  const payload = { slug, at: new Date().toISOString(), phase: 'pre-fix', gates };
  writeFileSync(snapshotTo, JSON.stringify(payload, null, 2));
  const failing = gates.filter((g) => g.failing);
  console.log(`FIX_SNAPSHOT=OK  ${gates.length} gate(s) recorded to ${snapshotTo}`);
  console.log(`  failing before the fix: ${failing.length ? failing.map((f) => `${f.id}=${f.verdict}`).join(', ') : 'none'}`);
  if (!failing.length) {
    console.log('  NOTE: no gate is failing, so no gate can prove a fix landed. Any finding /qa-fix is');
    console.log('  about to address is visual-only, and --against will report it UNADJUDICATED rather');
    console.log('  than green. That is the honest answer, not a gap to route around.');
  }
  teardown();
  process.exit(0);
}

// ---- MODE 2: against --------------------------------------------------------------------------
if (!existsSync(against)) {
  console.log(`FIX_VERIFY=FAIL — no pre-fix snapshot at ${against}. Without a BEFORE there is nothing to`);
  console.log('  diff against, and "it looks fixed now" is the assumption this script exists to replace.');
  process.exit(1);
}
const before = JSON.parse(readFileSync(against, 'utf8'));
if (before.slug !== slug) {
  console.log(`FIX_VERIFY=FAIL — snapshot is for '${before.slug}', not '${slug}'.`);
  process.exit(1);
}

const beforeById = new Map(before.gates.map((g) => [g.id, g]));
const wasFailing = before.gates.filter((g) => g.failing).map((g) => g.id);
const toRun = ONLY_FAILED
  ? wasFailing.map(gateById).filter(Boolean)
  : GATES;
const after = await runAll(toRun);

const rows = [];
for (const a of after) {
  const b = beforeById.get(a.id);
  if (!b) { rows.push({ id: a.id, state: 'NEW-GATE', before: null, after: a.verdict }); continue; }
  let state;
  if (b.failing && !a.failing) state = 'FIXED';
  else if (b.failing && a.failing) state = 'NOT-FIXED';
  else if (!b.failing && a.failing) state = 'REGRESSED';
  else state = 'STILL-CLEAN';

  const identical = b.lines.length === a.lines.length && b.lines.every((l, i) => l === a.lines[i]);
  const resolved = b.lines.filter((l) => !a.lines.includes(l));
  const introduced = a.lines.filter((l) => !b.lines.includes(l));
  rows.push({
    id: a.id, state, before: b.verdict, after: a.verdict,
    identical: state === 'NOT-FIXED' ? identical : undefined,
    resolved, introduced, note: a.note,
  });
}

const notFixed = rows.filter((r) => r.state === 'NOT-FIXED');
const regressed = rows.filter((r) => r.state === 'REGRESSED');
const fixed = rows.filter((r) => r.state === 'FIXED');
const unrun = ONLY_FAILED ? GATES.filter((g) => !wasFailing.includes(g.id)).map((g) => g.id) : [];
const verdict = notFixed.length || regressed.length ? 'FAIL' : 'PASS';

if (JSON_OUT) {
  console.log(JSON.stringify({ slug, verdict, rows, unrun }, null, 2));
} else {
  console.log(`\n══ FIX VERIFICATION — ${slug} ══`);
  for (const r of rows.filter((x) => x.state !== 'STILL-CLEAN')) {
    console.log(`${r.state === 'FIXED' ? ' ' : '‼'} ${r.state.padEnd(12)} ${r.id.padEnd(17)} ${r.before} → ${r.after}`);
    if (r.state === 'NOT-FIXED' && r.identical) {
      console.log('      The gate\'s failure output is BYTE-IDENTICAL to before the fix. Files were edited');
      console.log('      and this defect did not move — treat the fix as not attempted, not as "partially done".');
    }
    if (r.resolved && r.resolved.length) {
      console.log(`      resolved (${r.resolved.length}):`);
      for (const l of r.resolved.slice(0, 6)) console.log(`        - ${l}`);
    }
    if (r.introduced && r.introduced.length) {
      console.log(`      NEW (${r.introduced.length}) — caused by the fix:`);
      for (const l of r.introduced.slice(0, 6)) console.log(`        + ${l}`);
    }
    if (r.note) console.log(`      ${r.note}`);
  }
  if (rows.every((r) => r.state === 'STILL-CLEAN')) {
    console.log('  every gate was clean before and is clean now.');
  }
  console.log('');
  console.log(`  fixed: ${fixed.length}   not fixed: ${notFixed.length}   regressed: ${regressed.length}`);
  if (unrun.length) {
    console.log(`  NOT RE-RUN (--only-failed): ${unrun.join(', ')}`);
    console.log('  A regression in any of those is invisible to this run. Only use --only-failed when the');
    console.log('  full battery is being run elsewhere in the same round.');
  }
  console.log('');
  console.log('  UNADJUDICATED: any QA finding with no backing gate — anything found by LOOKING at a');
  console.log('  screenshot — is not covered by this verdict and still needs the reviewer\'s eyes.');
  console.log(`\n══ FIX_VERIFY=${verdict} ══\n`);
}

teardown();
process.exit(verdict === 'FAIL' ? 1 : 0);
