#!/usr/bin/env node
/**
 * detect-resume-stage.mjs <client-slug>
 *
 * P1 of the 2026-08-19 Fable architecture review: tonight's real biggest wall-clock loss was not
 * the productive run, it was ~3h15m lost across THREE kill-and-restart-from-zero cycles on the
 * same client. This script closes that by reading the checkpoint artifacts that ALREADY EXIST —
 * gathered-content.md, design-system.md, status.md's VERIFY_GATES_OK_AT marker, qa-report.md's
 * Verdict line — to report which pipeline stage a client is genuinely resumable from, instead of
 * re-deriving that by hand from file mtimes every time (which is what every "resume" prompt
 * tonight did manually).
 *
 * Deliberately STAGE-GRANULAR, not page-granular: checkpoints only exist at gather / design /
 * build-verified / qa-passed boundaries. Resuming mid-page-authoring is explicitly NOT supported
 * here — a fresh author picking up half-written shared state (globals.css, site-data.ts mid-edit)
 * is exactly the collision risk that killed the intra-client swarm idea. A kill mid-build-stage
 * still means re-running the whole build stage; this script only saves the stages BEFORE that one.
 *
 * Output: prints one STAGE=<name> line plus a ready-to-use resume prompt to
 * clients/<slug>/data/.resume-prompt.md. Never mutates client state otherwise.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const slug = process.argv[2];
if (!slug) { console.error('usage: detect-resume-stage.mjs <client-slug>'); process.exit(1); }

// Supabase is the authoritative pipeline-state source (app/CLAUDE.md's own rule — status.md is a
// per-client checkpoint file that drifts from the DB), so the deploy check queries it directly
// rather than guessing at status.md's URL line format, which the deploy skill never standardises.
// Falls back to a status.md grep only if the DB is unreachable, so a Supabase outage degrades
// gracefully instead of hard-failing resume detection.
function dbDeployedUrl(slug) {
  try {
    const out = execFileSync('python3', ['scripts/db.py', 'client', slug], { encoding: 'utf8', timeout: 10000 });
    const row = JSON.parse(out);
    return (row.deployed_url || '').trim() || null;
  } catch { return undefined; } // undefined = "couldn't ask the DB", distinct from null = "asked, no URL"
}

const dataDir = join('clients', slug, 'data');
const siteDir = join('clients', slug, 'site');
const gathered = join(dataDir, 'gathered-content.md');
const designSystem = join(dataDir, 'design-system.md');
const statusMd = join(dataDir, 'status.md');
const qaReport = join(dataDir, 'qa-report.md');

const has = (p) => existsSync(p);
const text = (p) => (has(p) ? readFileSync(p, 'utf8') : '');

// Newest mtime under site/src, so a VERIFY_GATES_OK_AT marker from a PRIOR successful build can be
// told apart from one still valid for the CURRENT source tree (code-review finding, 2026-08-19):
// the marker is appended to status.md and never cleared, so a build that once passed Verify, then
// got killed mid-page-authoring on a LATER rebuild, still shows a present marker even though site/
// now holds a half-written tree. Compare timestamps rather than trusting presence alone.
function newestSrcMtime(dir) {
  if (!existsSync(dir)) return null;
  let newest = null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { const n = newestSrcMtime(p); if (n && (!newest || n > newest)) newest = n; }
    else { const m = statSync(p).mtimeMs; if (!newest || m > newest) newest = m; }
  }
  return newest;
}

const statusText = text(statusMd);
const verifyMarkerMatch = [...statusText.matchAll(/VERIFY_GATES_OK_AT=(\S+)/g)];
const lastVerifyMarker = verifyMarkerMatch.length ? verifyMarkerMatch[verifyMarkerMatch.length - 1][1] : null;
const srcMtime = has(join(siteDir, 'src')) ? newestSrcMtime(join(siteDir, 'src')) : null;
const markerTime = lastVerifyMarker ? Date.parse(lastVerifyMarker) : NaN;
// verifyOk is true only if a marker exists AND it is not provably stale against the real source
// tree (an unparseable marker or unreadable src/ degrades to "trust the marker", not silently PASS
// nor silently FAIL — either failure direction is wrong without real information).
const verifyOk = !!lastVerifyMarker && (Number.isNaN(markerTime) || srcMtime === null || markerTime >= srcMtime);
const verifyStale = !!lastVerifyMarker && !verifyOk;
const qaText = text(qaReport);
const qaPass = /## Verdict:\s*PASS/i.test(qaText);
const qaFail = /## Verdict:\s*FAIL/i.test(qaText);
const dbUrl = dbDeployedUrl(slug);
// dbUrl === undefined means the DB call itself failed — fall back to the status.md hint (best
// effort, not authoritative) rather than silently reporting "not deployed" on a DB outage.
const deployedUrl = dbUrl !== undefined ? dbUrl : (statusText.match(/DEPLOYED_URL=(\S+)/) || [])[1] || null;
const deployedMatch = deployedUrl ? [null, deployedUrl] : null;

let stage, note, resumeInstruction;

if (!has(gathered)) {
  stage = 'PRE_GATHER';
  note = 'No gathered-content.md — nothing usable is checkpointed yet.';
  resumeInstruction = `Start from scratch: /gather ${slug} -> /ui-ux-pro-max -> /build -> QA loop -> /deploy. No salvage available.`;
} else if (!has(designSystem)) {
  stage = 'POST_GATHER';
  note = 'gathered-content.md exists, design-system.md does not.';
  resumeInstruction = `/gather is done and its output is on disk at ${gathered} — DO NOT re-run /gather. Verify gathered-content.md looks complete (has identity, services, testimonials, contact, at least one real photo path) before trusting it; if it looks partial/truncated, re-run /gather instead of trusting a partial file. Then continue: /ui-ux-pro-max -> /build -> QA loop -> /deploy.`;
} else if (!has(siteDir) || !verifyOk) {
  stage = 'POST_DESIGN_PRE_VERIFY';
  note = verifyStale
    ? `design-system.md exists; a VERIFY_GATES_OK_AT marker is present but is STALE — site/src has files newer than the marker's timestamp, meaning a later rebuild started (and was likely interrupted) after that marker was written.`
    : 'design-system.md exists; build has not completed Verify (no VERIFY_GATES_OK_AT in status.md).';
  resumeInstruction = `/gather and /ui-ux-pro-max are done — DO NOT re-run either; their outputs are at ${gathered} and ${designSystem}. The build itself was interrupted mid-way (${verifyStale ? 'the VERIFY_GATES_OK_AT marker present is stale against site/src\'s real mtimes' : 'no VERIFY_GATES_OK_AT marker in status.md'}), so re-run /build ${slug} from the top — it is idempotent per-page and will overwrite whatever partial pages exist. Then continue the QA loop -> /deploy. Read status.md first for anything already recorded (HyperUI citations planned, design manifest) so you don't re-derive decisions that were already made.`;
} else if (!qaPass) {
  stage = qaFail ? 'POST_VERIFY_QA_FAILED' : 'POST_VERIFY_PRE_QA';
  note = qaFail
    ? `Verify passed (VERIFY_GATES_OK_AT present); a qa-report.md exists with Verdict: FAIL.`
    : `Verify passed (VERIFY_GATES_OK_AT present); no qa-report.md yet, or it has no clear Verdict line.`;
  resumeInstruction = qaFail
    ? `Gather, design, and build+Verify are ALL done — do not re-run any of them. Read the existing qa-report.md at ${qaReport} for the specific issues, apply qa-fix for those issues (the same fix-then-re-verify discipline as normal), then re-run the QA loop from the appropriate round (check status.md/qa-report.md history for which round this was) -> /deploy.`
    : `Gather, design, and build+Verify are ALL done — do not re-run any of them. Spawn the qa-reviewer agent for a full ROUND 1 review per the normal QA Loop procedure (a missing/unclear qa-report.md means QA never validly completed, so round 1 rules apply even though build itself is done) -> /deploy.`;
} else if (!deployedMatch) {
  stage = 'POST_QA_PRE_DEPLOY';
  note = 'qa-report.md Verdict: PASS; no DEPLOYED_URL recorded in status.md.';
  resumeInstruction = `Everything through QA PASS is done — do not re-run gather, build, or QA. Go straight to /deploy ${slug}. Before deploying, sanity-check qa-report.md's PASS is genuinely fresh (its file mtime should be at or after the last build/Verify change) — a stale PASS from before a since-modified file is not trustworthy.`;
} else {
  stage = 'DEPLOYED';
  note = `Already deployed to ${deployedMatch[1]}.`;
  resumeInstruction = `This client is already deployed. Verify the deploy is live (curl the URL) before doing anything else — do not re-run any pipeline stage without a specific reason (a real regression, an explicit re-build request).`;
}

// Print the salvage info FIRST, before the write — a write failure (e.g. data/ doesn't exist yet
// on a PRE_GATHER kill, the exact case this script exists for) must never suppress the STAGE line
// an operator or the wrapper's die() actually needs (code-review finding, 2026-08-19: previously
// an uncaught ENOENT here produced a stack trace and nothing else).
console.log(`STAGE=${stage}`);
console.log(note);

const promptPath = join(dataDir, '.resume-prompt.md');
const promptBody = `# Auto-generated resume prompt for ${slug}
Generated by scripts/detect-resume-stage.mjs after a kill/interruption. Detected stage: ${stage}.
${note}

${resumeInstruction}

Do not treat this file as authoritative over status.md/qa-report.md themselves — it is a convenience
summary computed from them at generation time. If those files have changed since, re-run
detect-resume-stage.mjs before trusting this.
`;
try {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(promptPath, promptBody);
  console.log(`Resume prompt written to ${promptPath}`);
} catch (e) {
  console.log(`(could not write resume prompt to ${promptPath}: ${e.message} — the STAGE/note lines above are still valid)`);
}
