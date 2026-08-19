/**
 * gates.mjs — the ONE registry of every deterministic gate, and the ONE way to run one.
 *
 * WHY THIS EXISTS. Before this file, "did all the gates pass?" was not a fact anyone could read.
 * It was assembled by hand from a dozen separate log files by a model that had also just written
 * 4,000 words of prose, and the assembly step is exactly where verdicts got lost. Three measured
 * losses, all on 2026-08-19, all different shapes of the same fault:
 *
 *   1. verify-hero-video.mjs printed HERO_VIDEO_PLAYBACK_CHECK=FAIL and the build carried on and
 *      recorded HERO_VIDEO=OK in status.md. Nothing compared the two.
 *   2. The same script, once its server was fixed, hit a 30s Playwright timeout and printed a raw
 *      stack trace with NO verdict token at all. A gate that emits nothing cannot fail anything —
 *      absence reads as "no news".
 *   3. FONT_UNIQUENESS_CHECK=FAIL fired on a claim-vs-artifact mismatch caused by a STALE ledger
 *      row, i.e. the recorded claim and the shipped artifact had drifted apart with nothing
 *      watching the gap.
 *
 * So this registry encodes three things per gate, and the runner enforces all three:
 *   - how to RUN it (argv + cwd), so nobody re-derives an invocation and gets it subtly wrong;
 *   - how to READ its verdict, because the scripts print in three different formats
 *     (`X_CHECK=PASS`, `richness-check: PASS`, `ship-scan: PASS`);
 *   - which status.md CLAIM it adjudicates, so a recorded claim can be mechanically checked
 *     against the artifact instead of trusted.
 *
 * INTEGRITY IS PART OF THE VERDICT. runGate cross-checks the printed verdict against the process
 * exit code and returns INTEGRITY (a hard failure) when they disagree or when no verdict was
 * printed at all. A gate whose own output is self-contradictory has not cleared anything, and that
 * has to be louder than a clean FAIL, not quieter.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const siteDirFor = (slug) => join(REPO_ROOT, 'clients', slug, 'site');
export const statusMdFor = (slug) => join(REPO_ROOT, 'clients', slug, 'data', 'status.md');

/**
 * Verdict vocabulary, in order of severity. PASS and SKIP and WARN are all "not a failure";
 * FAIL, ERROR and INTEGRITY are failures. WARN is only ever non-fatal where a gate declares
 * itself warn-only (copy-fingerprint says so in its own header, at length, and means it).
 */
export const FAILING = new Set(['FAIL', 'ERROR', 'INTEGRITY', 'MISSING']);

/**
 * Every gate. `argv` is relative to REPO_ROOT and always run from REPO_ROOT, so there is exactly
 * one working directory in play and no subshell-cd games.
 *
 * needsServer: true  -> the gate reads clients/<slug>/site/.qa-port and drives a browser against
 *                       the shared QA server. It CANNOT run standalone; the runner reports it as
 *                       SKIP-no-server rather than pretending it passed.
 * mutates: true      -> never run by run-gates.mjs (it must be side-effect free so the same
 *                       command can be run twice and diffed). Listed so the registry stays the
 *                       full picture rather than a convenient subset.
 */
export const GATES = [
  {
    id: 'font',
    label: 'Webfont actually loaded (rendered glyph widths, not the declared stack)',
    argv: (slug) => ['scripts/font-check.mjs', `clients/${slug}/site`],
    verdict: /FONT_CHECK=(PASS|FAIL|ERROR|SKIP)/,
    claim: 'FONT_CHECK',
  },
  {
    id: 'font-uniqueness',
    label: 'Shipped fonts match the ledger record and do not collide with recent builds',
    argv: (slug) => ['scripts/font-uniqueness-check.mjs', slug],
    verdict: /FONT_UNIQUENESS_CHECK=(PASS|FAIL|SKIP)/,
  },
  {
    id: 'contrast',
    label: 'Computed WCAG contrast on every rendered route (alpha-composited)',
    argv: (slug) => ['scripts/contrast-check.mjs', `clients/${slug}/site/out`],
    verdict: /CONTRAST_CHECK=(PASS|FAIL|SKIP)/,
    claim: 'CONTRAST_CHECK',
  },
  {
    id: 'token',
    label: 'Full derive-palette token set present in :root and every declared pair passes',
    argv: (slug) => ['scripts/contrast-check.mjs', '--tokens', `clients/${slug}/site/src/app/globals.css`],
    verdict: /TOKEN_CHECK=(PASS|FAIL|SKIP)/,
    // PALETTE_DERIVE=PASS is a claim about the palette that SHIPPED, and this is the only check
    // that reads the shipped globals.css and re-proves every declared ratio. derive-palette.mjs
    // itself is a generator: re-running it proves what it would emit today, not what is in the
    // file. Adjudicate the claim against the artifact.
    claim: 'PALETTE_DERIVE',
  },
  {
    id: 'reviews',
    label: 'Every shipped review quote appears verbatim in gathered-content.md',
    argv: (slug) => ['scripts/verify-reviews.mjs', slug],
    verdict: /REVIEW_CHECK=(PASS|FAIL|SKIP)/,
  },
  {
    id: 'nav-visibility',
    label: 'Nav is visible above the fold at rest, desktop and mobile',
    argv: (slug) => ['scripts/verify-nav-visibility.mjs', `clients/${slug}/site/out`],
    verdict: /NAV_VISIBILITY_CHECK=(PASS|FAIL|SKIP)/,
  },
  {
    id: 'hero-video',
    label: 'Hero video present, playing, pausable, and not fetched under reduced motion',
    argv: (slug) => ['scripts/verify-hero-video.mjs', '--slug', slug],
    verdict: /HERO_VIDEO_PLAYBACK_CHECK=(PASS|FAIL|SKIP)/,
    needsServer: true,
    claim: 'HERO_VIDEO',
  },
  {
    id: 'design-intent',
    label: 'The DESIGN_IDEA and signature moves recorded in status.md are visible in the artifact',
    argv: (slug) => ['scripts/verify-design-intent.mjs', slug],
    verdict: /DESIGN_INTENT_CHECK=(PASS|FAIL|SKIP)/,
  },
  {
    id: 'photo',
    label: 'Every photo the site uses was positively cleared by gather',
    argv: (slug) => ['scripts/verify-photos.mjs', slug],
    verdict: /PHOTO_CHECK=(PASS|FAIL|SKIP)/,
  },
  {
    id: 'copy-fingerprint',
    label: 'Shipped prose does not repeat recent builds (warn-only by design)',
    argv: (slug) => ['scripts/copy-fingerprint-check.mjs', slug],
    verdict: /COPY_FINGERPRINT_CHECK=(PASS|WARN|SKIP|FAIL)/,
    warnOnly: true,
  },
  {
    id: 'richness',
    label: 'Visual richness: gradients, grain, treatments, secondary use, image weight',
    argv: (slug) => ['scripts/richness-check.mjs', `clients/${slug}/site`],
    verdict: /richness-check:\s*(PASS|FAIL)/,
    claim: 'RICHNESS_CHECK',
  },
  {
    id: 'ship-scan',
    label: 'No secrets, operator paths, source maps, vendor name or machine tells in the artifact',
    // Deliberately NOT --fix. run-gates must be side-effect free so the identical command can be
    // run before and after a fix and the two verdicts compared. The --fix pass belongs to QA/qa-fix.
    argv: (slug) => ['scripts/ship-scan.mjs', `clients/${slug}/site`],
    verdict: /ship-scan:\s*(PASS|FAIL)/,
    claim: 'SHIP_SCAN',
  },
  {
    id: 'aeo',
    label: 'AEO/GEO baseline: structured data, extractability, crawler access',
    argv: (slug) => ['scripts/aeo-check.mjs', `clients/${slug}/site`],
    verdict: /AEO_CHECK=(PASS|FAIL|SKIP)/,
    claim: 'AEO_CHECK',
  },
];

export const gateById = (id) => GATES.find((g) => g.id === id);
export const gateForClaim = (key) => GATES.find((g) => g.claim === key);

/**
 * Bring up the shared QA server if it is not already running, and hand back a stop() that puts
 * .qa-port back exactly as it was found.
 *
 * WHY EVERY CONSUMER SHOULD CALL THIS rather than skipping browser gates when no server is up: a
 * gate reported as SKIP because the harness could not run it is indistinguishable, at a glance,
 * from a gate that legitimately had nothing to check. Both read as "not a problem". Starting the
 * server costs ~200ms and converts a whole class of "we didn't look" into "we looked".
 *
 * It also has to be qa-serve.mjs specifically. `python3 -m http.server` 404s every assetPrefixed
 * asset, so the page never hydrates and the browser gates measure a dead page — the fault that
 * produced a FALSE HERO_VIDEO_PLAYBACK_CHECK=FAIL on a perfectly good video on 2026-08-19.
 */
export async function ensureQaServer(slug) {
  const portFile = join(siteDirFor(slug), '.qa-port');
  const original = existsSync(portFile) ? readFileSync(portFile, 'utf8') : null;
  const alive = async () => {
    const p = qaServerPort(slug);
    if (p === null) return false;
    return fetch(`http://localhost:${p}/`, { method: 'HEAD' })
      .then((r) => r.ok || r.status === 404)
      .catch(() => false);
  };
  const restore = () => {
    try {
      if (original === null) { if (existsSync(portFile)) unlinkSync(portFile); }
      else writeFileSync(portFile, original);
    } catch { /* best effort — never let teardown mask the real verdict */ }
  };

  if (await alive()) return { up: true, started: false, stop: () => {} };

  const proc = spawn(process.execPath, ['scripts/qa-serve.mjs', `clients/${slug}/site`], {
    cwd: REPO_ROOT, stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    if (await alive()) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const up = await alive();
  const stop = () => { try { proc.kill(); } catch { /* already gone */ } restore(); };
  return { up, started: true, stop };
}

/** Is the shared QA server up for this client? (hero-video and friends need it.) */
export function qaServerPort(slug) {
  const f = join(siteDirFor(slug), '.qa-port');
  if (!existsSync(f)) return null;
  try {
    const p = Number(readFileSync(f, 'utf8').trim());
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Run one gate. Resolves to { id, verdict, exitCode, integrity, ms, output }.
 *
 * `verdict` is one of PASS/FAIL/SKIP/WARN/ERROR/INTEGRITY/MISSING and is the ONLY thing callers
 * should branch on. The integrity rules, in order:
 *
 *   - no verdict token in the output at all           -> MISSING  (failure)
 *   - token says PASS/SKIP but the process exited !=0 -> INTEGRITY (failure)
 *   - token says FAIL/ERROR but the process exited 0  -> INTEGRITY (failure)
 *
 * The second and third are the ones that matter. A gate that prints PASS and exits 1 is a gate
 * nobody can rely on in either direction, and the correct response is to stop, not to pick
 * whichever half of its output is more convenient.
 */
export function runGate(gate, slug, { timeoutMs = 300000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const argv = gate.argv(slug);

    /*
     * CAPTURE TO A FILE, NEVER A PIPE. This is not a style choice; it is the difference between
     * reading a gate's verdict and losing it.
     *
     * On a pipe, Node's process.stdout writes are ASYNCHRONOUS, and a script that ends with
     * `process.exit(0)` discards whatever is still queued. Gates print their evidence first and
     * their verdict LAST, so the verdict is precisely what sits at the back of that queue.
     * Measured 2026-08-19 on copy-fingerprint-check.mjs: piped 65,706 bytes with ZERO
     * COPY_FINGERPRINT_CHECK= lines; the same run captured to a file gave 66,590 bytes WITH the
     * verdict. The 884 lost bytes were the answer.
     *
     * That script has been fixed, but fixing one script does not make the harness safe — any gate
     * that grows its output or gains a process.exit() would silently reintroduce it, and the
     * symptom is a gate that looks like it "didn't say anything". A file redirect is synchronous
     * at the OS level, so nothing can be dropped no matter what the child does on the way out.
     */
    const capFile = join(tmpdir(), `klaudius-gate-${gate.id}-${slug}-${process.pid}-${Date.now()}.log`);
    let fd;
    try {
      fd = openSync(capFile, 'w+');
    } catch (e) {
      return resolve({
        id: gate.id, verdict: 'ERROR', exitCode: null, ms: 0,
        output: '', note: `could not open a capture file for this gate: ${e.message}`,
      });
    }
    const readCapture = () => {
      try { return readFileSync(capFile, 'utf8'); } catch { return ''; }
    };
    const cleanup = () => {
      try { closeSync(fd); } catch { /* already closed */ }
      try { unlinkSync(capFile); } catch { /* already gone */ }
    };

    const child = spawn(process.execPath, argv, { cwd: REPO_ROOT, env, stdio: ['ignore', fd, fd] });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      cleanup();
      resolve({
        id: gate.id, verdict: 'ERROR', exitCode: null, ms: Date.now() - started,
        output: `failed to spawn: ${e.message}`, note: 'gate could not be executed',
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      const out = readCapture();
      cleanup();
      if (timedOut) {
        return resolve({
          id: gate.id, verdict: 'ERROR', exitCode: null, ms, output: out,
          note: `timed out after ${timeoutMs}ms — a gate that cannot finish has not cleared anything`,
        });
      }
      const m = out.match(gate.verdict);
      if (!m) {
        return resolve({
          id: gate.id, verdict: 'MISSING', exitCode: code, ms, output: out,
          note: `printed no ${String(gate.verdict)} verdict line (exit ${code}). Silence is not a pass.`,
        });
      }
      const printed = m[1];
      const printedIsFailure = printed === 'FAIL' || printed === 'ERROR';
      const exitIsFailure = code !== 0;
      if (printedIsFailure !== exitIsFailure) {
        return resolve({
          id: gate.id, verdict: 'INTEGRITY', exitCode: code, ms, output: out, printed,
          note: `printed ${printed} but exited ${code}. The gate contradicts itself; neither half is trustworthy.`,
        });
      }
      resolve({ id: gate.id, verdict: printed, exitCode: code, ms, output: out });
    });
  });
}

/** True when this verdict should fail the run, honouring a gate's declared warn-only status. */
export function isFailing(gate, verdict) {
  if (verdict === 'WARN') return !gate.warnOnly;
  return FAILING.has(verdict);
}
