#!/usr/bin/env node
/**
 * reconcile-claims.mjs <slug> [--json]
 *
 * Cross-check every X=OK / X=PASS claim recorded in clients/<slug>/data/status.md against the real
 * verdict of the gate that adjudicates it, on the built artifact. Any disagreement is a hard fail.
 *
 * THE HOLE THIS CLOSES. A build's status.md is a self-report. Nothing was comparing it to the
 * artifact, so the two could — and did — drift apart in both directions on 2026-08-19:
 *
 *   - verify-hero-video.mjs printed HERO_VIDEO_PLAYBACK_CHECK=FAIL while status.md recorded
 *     HERO_VIDEO=OK, and the build shipped. The gate ran. Its verdict just wasn't load-bearing
 *     against the claim, because nothing in the pipeline held the two in the same hand.
 *   - FONT_UNIQUENESS_CHECK=FAIL fired on a claim/artifact mismatch caused by a STALE ledger row —
 *     the record was wrong, not the site.
 *
 * DRIFT IS A FAILURE IN BOTH DIRECTIONS, and that is not pedantry. status.md is not a diary: other
 * gates READ it. verify-hero-video.mjs SKIPs its entire playback probe when status.md says
 * HERO_VIDEO=FAIL, on the reasonable assumption that the record is true. So a stale pessimistic
 * record silently disables a real gate for every later round, and a stale optimistic record ships a
 * defect. Both get reported here, both exit non-zero.
 *
 * A claim nobody can check is also a failure (UNVERIFIED). "We could not verify it" and "it is
 * fine" are different facts, and a build must not be able to launder one into the other.
 *
 * Self-sufficient: browser gates need the shared QA server, so this starts its own qa-serve.mjs
 * when one is not already up, and puts .qa-port back exactly as it found it afterwards. It will
 * never report UNVERIFIED for a reason that is about the harness rather than the site — a false red
 * teaches people to overrule reds, and then a true red gets overruled with them.
 */
import { readFileSync, existsSync } from 'node:fs';
import { GATES, gateForClaim, runGate, statusMdFor, ensureQaServer } from './lib/gates.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const JSON_OUT = args.includes('--json');
if (!slug) { console.error('usage: reconcile-claims.mjs <slug> [--json]'); process.exit(2); }

const statusPath = statusMdFor(slug);
if (!existsSync(statusPath)) {
  console.log(`CLAIM_RECONCILE=FAIL — no status.md at ${statusPath}. A build with no recorded claims cannot be reconciled, and "no claims" is not the same as "no defects".`);
  process.exit(1);
}
const status = readFileSync(statusPath, 'utf8');

/**
 * Parse claims. Deliberately narrow: an UPPERCASE_KEY immediately followed by one of the verdict
 * words. That admits the two real shapes in the wild —
 *   `PALETTE_DERIVE=PASS (all 58 ratios confirmed)`   (line start, trailing prose)
 *   `HERO_VIDEO=OK slug=cold-front-ac photos=4 ...`   (line start, trailing key=value pairs)
 * — while refusing to read `slug=cold-front-ac` or `photos=4` as claims. Anything looser starts
 * inventing claims out of ordinary prose, and a reconciler that cries wolf gets switched off.
 */
const CLAIM_RE = /(?:^|\s)([A-Z][A-Z0-9_]{2,})=(OK|PASS|FAIL|SKIP|WARN)(?=$|[\s,.;)])/gm;
const claims = [];
for (const m of status.matchAll(CLAIM_RE)) {
  // Last write wins: a build that re-records a key after a fix means the later line.
  const existing = claims.findIndex((c) => c.key === m[1]);
  if (existing !== -1) claims.splice(existing, 1);
  claims.push({ key: m[1], value: m[2] });
}

const POSITIVE = new Set(['OK', 'PASS']);
const backed = claims.filter((c) => gateForClaim(c.key));
const unbacked = claims.filter((c) => !gateForClaim(c.key));

// ---- ensure the shared QA server, if any backed gate needs it -------------------------------
const needsServer = backed.some((c) => gateForClaim(c.key).needsServer);
const server = needsServer ? await ensureQaServer(slug) : { up: false, stop: () => {} };
const teardown = () => server.stop();
process.on('exit', teardown);

// ---- run each backed claim's gate ONCE (a gate can adjudicate only one claim, but be safe) ---
const uniqueGates = [...new Set(backed.map((c) => gateForClaim(c.key).id))];
const verdicts = new Map();
await Promise.all(uniqueGates.map(async (id) => {
  const g = GATES.find((x) => x.id === id);
  verdicts.set(id, await runGate(g, slug));
}));

// ---- adjudicate -------------------------------------------------------------------------------
const rows = [];
for (const c of backed) {
  const g = gateForClaim(c.key);
  const r = verdicts.get(g.id);
  const claimPositive = POSITIVE.has(c.value);
  const gatePositive = r.verdict === 'PASS' || (r.verdict === 'WARN' && g.warnOnly);
  const gateUnknown = r.verdict === 'SKIP' || r.verdict === 'MISSING' || r.verdict === 'INTEGRITY' || r.verdict === 'ERROR';

  let state, why;
  if (gateUnknown) {
    state = 'UNVERIFIED';
    why = `status.md claims ${c.key}=${c.value} but ${g.id} returned ${r.verdict}` +
          (r.note ? ` (${r.note})` : '') +
          '. An unverifiable claim is not a cleared one.';
  } else if (claimPositive && !gatePositive) {
    state = 'CONTRADICTION';
    why = `status.md records ${c.key}=${c.value} — the ${g.id} gate says ${r.verdict} on the built artifact. ` +
          'The recorded claim is false. Fix the site, or correct the record; do not ship the disagreement.';
  } else if (!claimPositive && gatePositive) {
    state = 'STALE-CLAIM';
    why = `status.md records ${c.key}=${c.value} but the ${g.id} gate now says PASS. The record is stale. ` +
          'This is not harmless: other gates READ status.md (verify-hero-video.mjs skips its whole probe ' +
          'on HERO_VIDEO=FAIL), so a stale pessimistic record silently disables real checking.';
  } else {
    state = 'RECONCILED';
    why = `${c.key}=${c.value} confirmed by ${g.id}=${r.verdict} on the artifact.`;
  }
  rows.push({ claim: c.key, claimed: c.value, gate: g.id, gateVerdict: r.verdict, state, why });
}

// Gates that COULD adjudicate a claim but where no claim was recorded. Informational: not every
// build records every key. Named anyway, because "nothing was claimed" should be visible rather
// than indistinguishable from "claimed and checked".
const notClaimed = GATES
  .filter((g) => g.claim && !claims.some((c) => c.key === g.claim))
  .map((g) => ({ claim: g.claim, gate: g.id }));

const failures = rows.filter((r) => r.state !== 'RECONCILED');
const verdict = failures.length ? 'FAIL' : 'PASS';

if (JSON_OUT) {
  console.log(JSON.stringify({ slug, verdict, rows, unbacked, notClaimed }, null, 2));
} else {
  console.log(`\n══ CLAIM ↔ ARTIFACT RECONCILIATION — ${slug} ══`);
  for (const r of rows) {
    const mark = r.state === 'RECONCILED' ? ' ' : '‼';
    console.log(`${mark} ${r.state.padEnd(14)} ${r.claim}=${r.claimed}  vs  ${r.gate}=${r.gateVerdict}`);
    if (r.state !== 'RECONCILED') console.log(`      ${r.why}`);
  }
  if (unbacked.length) {
    console.log(`\n  ${unbacked.length} claim(s) no gate can check — recorded, never verified by anything:`);
    for (const c of unbacked) console.log(`      ${c.key}=${c.value}`);
    console.log('      These are self-report only. Adding a backing gate is what makes them mean anything;');
    console.log('      until then treat them as notes, not evidence. (Register one in scripts/lib/gates.mjs.)');
  }
  if (notClaimed.length) {
    console.log(`\n  ${notClaimed.length} checkable claim(s) this build never recorded: ${notClaimed.map((n) => n.claim).join(', ')}`);
  }
  console.log(`\n══ ${rows.length} claim(s) reconciled, ${failures.length} disagreement(s)  ⇒  CLAIM_RECONCILE=${verdict} ══\n`);
}

teardown();
process.exit(failures.length ? 1 : 0);
