#!/usr/bin/env node
/**
 * whatsapp.mjs - IPC shim for the WhatsApp daemon(s).
 *
 * Klaudius runs one daemon per linked WhatsApp account (Crux 3: round-robin
 * across multiple numbers). Each daemon owns its own auth state, SQLite
 * mirror, and IPC endpoint under ~/.klaudius/whatsapp/<account>/. This shim
 * dispatches ops to the right daemon, auto-spawning whichever one isn't
 * running yet.
 *
 * Subcommands:
 *   pair  [--account <label>]                              Display QR, save auth state. Default account: 'primary'.
 *   send  --to "+447xxx" --body "..." [--account <label>]  If --account omitted, round-robins via WHATSAPP_ACCOUNTS env. [--dry-run] prints what would be sent.
 *   read  --phone "+447xxx" [--limit 30] [--account <label>] Fetch thread history from the daemon's SQLite. Default: 'primary'.
 *   check [--account <label>] [--all]                       Daemon status. --all loops every account in WHATSAPP_ACCOUNTS.
 *   standing [--account <label>] [--json]                   Ask WhatsApp how the account is standing: new-chat message quota
 *                                                           (it warns before capping) and any active reachout timelock.
 *   stop  [--account <label>] [--all]                       Graceful shutdown.
 *
 * On any non-pair op: if the target daemon isn't running, auto-spawn it as a
 * detached background process and wait for its IPC endpoint to accept. Parallel
 * spawn attempts are coordinated via an exclusive lock file so we get exactly
 * one daemon per account no matter how many parallel pipeline children are
 * racing.
 *
 * Output: JSON to stdout for success, human errors to stderr.
 */

import qrcode from 'qrcode-terminal';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- Path layout (must mirror whatsapp-daemon.mjs) ----
const HOME = os.homedir();
const STATE_BASE = process.env.KLAUDIUS_WHATSAPP_STATE_DIR
  || path.join(HOME, '.klaudius', 'whatsapp');
const RR_COUNTER = path.join(STATE_BASE, '_rr_counter');

// IPC endpoint a shim connects to / a daemon listens on. On Unix this is a
// Unix-domain socket file. On Windows, Node implements local-domain sockets as
// named pipes, which MUST live in the \\.\pipe\ namespace (a bare file path
// fails to bind there), so we map the account label to a stable pipe name.
// Accounts are sanitised to [A-Za-z0-9_-] at every call site, so the label is
// pipe-name-safe. Must mirror IPC_ENDPOINT in scripts/whatsapp-daemon.mjs.
function ipcEndpoint(account) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\klaudius-whatsapp-${account}`;
  }
  return path.join(STATE_BASE, account, 'daemon.sock');
}

function pathsFor(account) {
  const dir = path.join(STATE_BASE, account);
  return {
    dir,
    auth: path.join(dir, 'auth'),
    // `ipc` is the endpoint passed to net.createConnection() (a named pipe on
    // Windows). `sockFile` is the on-disk Unix socket file for fs-level
    // liveness/cleanup — it only ever exists on Unix (on Windows nothing is
    // written there). On Unix the two are the same path.
    ipc: ipcEndpoint(account),
    sockFile: path.join(dir, 'daemon.sock'),
    pid: path.join(dir, 'daemon.pid'),
    log: path.join(dir, 'daemon.log'),
    spawnLock: path.join(dir, 'daemon.spawning'),
    // Circuit-breaker sentinel, written by the daemon when WhatsApp returns
    // 401 loggedOut (creds invalidated server-side). While it exists, ops
    // fail fast instead of respawning a daemon whose every handshake is a
    // guaranteed 401. Cleared by a successful `pair`. Must mirror
    // AUTH_INVALID_SENTINEL in scripts/whatsapp-daemon.mjs.
    authInvalid: path.join(dir, 'auth-invalid'),
  };
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_PATH = path.join(SCRIPT_DIR, 'whatsapp-daemon.mjs');

const DAEMON_SPAWN_TIMEOUT_MS = 30_000;
const OP_DEFAULT_TIMEOUT_MS = 30_000;
// Send budget: the daemon may wait up to 90s for Baileys to connect
// (waitForSock), then up to 45s for the jittered rate-limit gap, then
// lookup + send + 1.5s ack settle. Concurrent sends to one account also
// serialise behind each other in the daemon, so this needs headroom for a
// couple of queued ops — a timeout here after the daemon actually sent
// reads as a failure to the skill, which then cascades to another channel
// and double-contacts the business.
const OP_SEND_TIMEOUT_MS = 180_000;

// Pairing: how long a single QR attempt waits for the phone to scan before it
// gives up. A first-time operator navigating WhatsApp's Linked Devices flow on
// their phone routinely takes longer than a minute, so we give them three.
const PAIR_TIMEOUT_MS = 180_000;

// Best-effort: write the pairing QR to a full-resolution PNG so it stays
// scannable even when the terminal can't render the block-QR. The common case
// is running `pair` through Claude Code's `!` prefix, which only shows a
// collapsed preview of the ~33-line QR (never scannable during its validity
// window). Degrades silently to terminal-only if the optional `qrcode` package
// isn't installed yet (e.g. an existing install that pulled the template update
// but hasn't re-run `npm install`).
async function writeQrPng(qrString, destPath) {
  try {
    const { default: QRCode } = await import('qrcode');
    await QRCode.toFile(destPath, qrString, {
      type: 'png',
      width: 512,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return destPath;
  } catch {
    return null;
  }
}

// libsignal hard-codes a console.log of session state (incl. privKey) on close.
// Our own JSON output starts with '{' so this filter is safe.
const _origConsoleLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Closing session:')) return;
  _origConsoleLog.apply(console, args);
};

// ---- minimal .env loader (mirrors what gmail.py / twilio_sms.py do) ----
// Walks up from cwd looking for .env; populates process.env for keys that
// aren't already set. Skill invocations run from the project root so .env is
// usually at cwd/.env. We don't add `dotenv` as a dep — this is ~15 lines.
(function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
})();

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    }
  }
  return flags;
}

function getConfiguredAccounts() {
  const raw = process.env.WHATSAPP_ACCOUNTS || 'primary';
  const accounts = raw
    .split(',')
    .map((s) => s.trim().replace(/[^A-Za-z0-9_-]/g, ''))
    .filter((s) => s.length > 0);
  return accounts.length > 0 ? accounts : ['primary'];
}

// Round-robin selection via a counter file. Best-effort atomicity — two
// shims racing to increment could pick the same account, which is fine
// (the daemon-level send queue serialises and the rate limit absorbs the
// collision). For v2: simple, no dep. Promote to a proper lock later if
// real-world skew becomes an issue.
function pickAccountRR(accounts) {
  if (accounts.length === 1) return accounts[0];
  fs.mkdirSync(STATE_BASE, { recursive: true });
  let counter = 0;
  try {
    counter = parseInt(fs.readFileSync(RR_COUNTER, 'utf8').trim(), 10) || 0;
  } catch {}
  const idx = counter % accounts.length;
  try { fs.writeFileSync(RR_COUNTER, String(counter + 1)); } catch {}
  return accounts[idx];
}

// ---- daemon liveness + spawn coordination ----

function readDaemonPid(account) {
  const p = pathsFor(account);
  try {
    const pid = parseInt(fs.readFileSync(p.pid, 'utf8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isDaemonAlive(account) {
  const p = pathsFor(account);
  const pid = readDaemonPid(account);
  if (!pid) return false;
  // Unix: the socket file existing is a cheap NEGATIVE signal (no file → not
  // accepting yet, whether down or still booting). It is NOT proof anything
  // is listening — the file survives a hard-killed daemon — which is why
  // daemonReady() layers a real connect on top before any op is dispatched. Windows named pipes have no filesystem
  // entry, so PID liveness is the only cheap signal there.
  if (process.platform !== 'win32' && !fs.existsSync(p.sockFile)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Confirm a daemon is actually accepting IPC connections — not merely that its
// PID is alive. On Windows the named pipe has no filesystem presence, so a real
// connect is the only reliable readiness signal (isDaemonAlive can only prove
// the process exists). Graceful end() rather than destroy() avoids leaving an
// ECONNRESET line in the daemon's log on every probe.
function probeListening(account, timeoutMs = 1500) {
  const endpoint = ipcEndpoint(account);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const conn = net.createConnection(endpoint);
    timer = setTimeout(() => { try { conn.destroy(); } catch {} finish(false); }, timeoutMs);
    conn.on('connect', () => { try { conn.end(); } catch {} finish(true); });
    conn.on('error', () => { try { conn.destroy(); } catch {} finish(false); });
  });
}

// Readiness gate layered on isDaemonAlive(): a real connect, on BOTH
// platforms. This used to skip the probe on Unix on the theory that the bound
// socket file was proof enough — but the socket file survives a hard-killed
// daemon, and once the OS recycles the pid, isDaemonAlive() reads "alive"
// while nothing is listening. Ops then die on ECONNREFUSED (Unix) or a 30s
// spawn timeout (Windows) with nothing ever clearing the stale state — the
// 2026-07-26 operator incident that blanked 22 clients. Only an actual
// connect proves an endpoint is accepting.
async function daemonReady(account) {
  if (!isDaemonAlive(account)) return false;
  return probeListening(account);
}

// Is a daemon PROCESS alive for this account, regardless of whether its IPC
// socket is bound? isDaemonAlive() requires both, so a daemon whose socket
// went missing under it reads as "not running" while still holding the
// WhatsApp connection — an orphan. Two live connections on one identity is
// the hazard the single-daemon architecture exists to prevent, so anything
// that is about to take over the auth state (pair) or shut things down
// (stop) must use THIS, not isDaemonAlive().
//
// Returns the pid, or null. A stale pid file outlives a hard-killed daemon
// and the OS recycles pids, so a live pid is NOT proof it's ours — signalling
// it blindly could SIGTERM an unrelated process. Confirm identity via the
// process's command line where the platform allows. On Windows there's no
// cheap equivalent, but the orphan case can't arise there either: named pipes
// have no filesystem entry, so isDaemonAlive is pid-only to begin with.
// Best-effort command line for a pid, or null when it can't be read. Tries
// /proc first (present on Linux incl. minimal containers where `ps` may not
// be), then `ps`. null means "unknown", never "not ours".
function processCommandLine(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (raw) return raw.replace(/\0/g, ' ');
  } catch {}
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {}
  return null;
}

function daemonProcessAlive(account) {
  const pid = readDaemonPid(account);
  if (!pid) return null;
  try { process.kill(pid, 0); } catch { return null; }
  if (process.platform !== 'win32') {
    const cmdline = processCommandLine(pid);
    // Only DISPROVE ownership when we actually read a command line. If the
    // probe itself failed (no `ps` on Alpine/BusyBox, an incompatible `-o`,
    // no /proc), fall through and treat a live pid as ours — the same
    // assumption this code made before identity checking existed. Failing the
    // other way would leave an orphaned daemon alive and holding the WhatsApp
    // connection, and an orphan causes the mutual-replacement storms the 440
    // handling exists to prevent. A stale-pid mis-kill needs pid REUSE *and*
    // an unreadable process table, and is the lesser harm.
    if (cmdline !== null && !cmdline.includes('whatsapp-daemon')) return null;
  }
  return pid;
}

// Name + command line for a pid on Windows, via CIM. PowerShell rather than
// `wmic` — wmic is deprecated and REMOVED from current Windows 11 builds, so
// leaning on it would silently disable identity checks on the newest boxes.
// This only runs on the suspected-stale path (a probe has already failed
// repeatedly), so PowerShell's ~1-2s start-up cost is fine. Either field can
// be null: CommandLine is null for elevated/SYSTEM processes queried from a
// non-admin shell, but Name is populated whenever the query succeeds at all —
// which is what makes the name-vs-cmdline split below work.
function windowsProcessIdentity(pid) {
  try {
    // The OutputEncoding line forces UTF-8 on the pipe — PowerShell 5.1
    // otherwise emits the OEM/ANSI codepage, which mojibakes non-ASCII in a
    // CommandLine (e.g. an accented username). Verdicts would survive that
    // (every matched substring is ASCII), but the logged evidence wouldn't.
    const raw = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object Name,CommandLine | ConvertTo-Json`,
    ], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { name: null, cmdline: null };
    return { name: parsed.Name ?? null, cmdline: parsed.CommandLine ?? null };
  } catch {
    return { name: null, cmdline: null };
  }
}

function unixProcessIdentity(pid) {
  const cmdline = processCommandLine(pid);
  if (cmdline === null) return { name: null, cmdline: null };
  const first = cmdline.trim().split(/\s+/)[0] || '';
  return { name: path.basename(first) || null, cmdline };
}

// Is the process behind this pid OUR daemon for THIS account, some other
// process (pid recycled), or unknowable? Cmdline is checked first because it
// is decisive when readable; the process NAME is the fallback that makes
// "positively not ours" reachable even for protected processes (Name survives
// where CommandLine comes back null) — a recycled pid landing on
// SearchHost.exe or svchost.exe is identifiable by name alone. Compare against
// basename(process.execPath), not a literal "node.exe": the daemon is spawned
// via process.execPath, so the shim knows the exact image name it launched,
// and the basename differs across platforms (node vs node.exe) and under
// renamed/bundled runtimes.
function classifyPid(account, pid) {
  const id = process.platform === 'win32' ? windowsProcessIdentity(pid) : unixProcessIdentity(pid);
  if (id.cmdline !== null) {
    const oursRe = new RegExp(`whatsapp-daemon.*--account ${account}(\\s|$)`);
    return { verdict: oursRe.test(id.cmdline) ? 'ours' : 'not-ours', ...id };
  }
  if (id.name !== null) {
    const execName = path.basename(process.execPath).toLowerCase();
    return { verdict: id.name.toLowerCase() === execName ? 'unknown' : 'not-ours', ...id };
  }
  return { verdict: 'unknown', ...id };
}

// Forensics for every stale-pid decision. Goes to the account's daemon.log —
// that's where the operator (and support) already looks — plus stderr. The
// daemon holds a write stream on that file, but concurrent appends are safe
// (the daemon itself appendFileSync's the same file pre-stream for the 401
// sentinel message); the try/catch covers Windows sharing violations, and
// dropping the file line silently is fine precisely because stderr carries it.
function logStaleCheck(account, msg) {
  const line = `[${new Date().toISOString()}] stale-pid check: ${msg}`;
  try { fs.appendFileSync(pathsFor(account).log, line + '\n'); } catch {}
  console.error(line);
}

const STALE_PID_GRACE_MS = 60_000;

function pidFileAgeMs(account) {
  try { return Date.now() - fs.statSync(pathsFor(account).pid).mtimeMs; }
  catch { return Infinity; }
}

// Clear a pid file that provably points at a process which is NOT our daemon.
// The OS recycles pids, so a pid file that outlives a hard-killed daemon (or
// a reboot) can name a live-but-unrelated process; isDaemonAlive() then reads
// "alive", the spawn is skipped, and every op fails until a human deletes the
// file — the 2026-07-26 incident. The probe-the-endpoint approach: a recycled
// pid can't be listening on our socket/pipe.
//
// DEFAULT DIRECTION: when identity can't be determined, DON'T clear. This is
// the deliberate INVERSE of daemonProcessAlive() above, which fails toward
// "assume it's ours" — correct there, because stop/pair are trying to remove
// a daemon and the worse harm is leaving an orphan holding the connection.
// Here the asymmetry flips: wrongly clearing spawns a second daemon on the
// same auth. On Unix that second daemon silently steals the live daemon's
// socket (the daemon unlinks-before-bind, so the pid file is the ONLY mutual
// exclusion there) and dials WhatsApp — a 440 mutual-replacement storm on a
// real operator's number. On Windows libuv's FILE_FLAG_FIRST_PIPE_INSTANCE
// makes the second daemon die on EADDRINUSE, which bounds the damage to
// churn — but churn on the platform where probes are weakest is still worth
// avoiding. Wrongly NOT clearing just reproduces the old wedge, which the
// spawn-timeout error now explains how to fix by hand. The design is safe
// because the catastrophic platform and the probe-fallible platform are
// different platforms: on Unix probeListening is reliable (the OS backlog
// completes handshakes even for a daemon with a blocked event loop), while
// on Windows a blocked daemon can transiently exhaust libuv's pending pipe
// instances — hence the probe retries, and identity as the final arbiter.
async function clearStalePidFile(account) {
  const pid = readDaemonPid(account);
  if (!pid || !isDaemonAlive(account)) return false; // nothing claims to be alive
  if (await probeListening(account)) return false;   // genuinely up and accepting
  // Everything past this point is the once-per-incident path (a probe has
  // failed), so logging every decision with its inputs stays quiet in normal
  // operation while giving the next incident report real evidence.
  const ageMs = pidFileAgeMs(account);
  if (ageMs < STALE_PID_GRACE_MS) {
    logStaleCheck(account, `pid ${pid} not accepting connections but the pid file is only ${Math.round(ageMs / 1000)}s old — assuming a daemon still booting; not clearing.`);
    return false;
  }
  // Rule out a transient probe failure before consulting identity.
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await probeListening(account)) return false;
  }
  const id = classifyPid(account, pid);
  const detail = `pid ${pid} (pid file ${Math.round(ageMs / 1000)}s old, 3 failed probes, name=${id.name ?? '?'}, cmdline ${id.cmdline ? 'read' : 'unreadable'})`;
  if (id.verdict === 'ours') {
    logStaleCheck(account, `${detail}: this IS our daemon — alive but not accepting (blocked event loop?). Not clearing. If ops keep timing out, run \`node scripts/whatsapp.mjs stop --account ${account}\`.`);
    return false;
  }
  if (id.verdict === 'unknown') {
    logStaleCheck(account, `${detail}: identity unknown — not clearing (see comment: unknown must not clear). If this repeats, check pid ${pid} yourself and delete ${pathsFor(account).pid} if it is not a klaudius whatsapp-daemon.`);
    return false;
  }
  // Re-validate before acting: the decision above took seconds, and the
  // verdict belongs to the pid we sampled at entry. If the file now names a
  // different pid (a daemon someone hand-started is booting, or — belt and
  // braces under the spawn lock — any other actor got here first), clearing
  // would delete a LIVE daemon's pid file on the strength of a stale
  // classification. The daemon writes its pid file well before it binds its
  // socket, so any freshly-spawned daemon is visible here before it exists
  // anywhere else.
  if (readDaemonPid(account) !== pid) {
    logStaleCheck(account, `pid file changed while deciding (was ${pid}) — another daemon or shim got here first; not clearing.`);
    return false;
  }
  const p = pathsFor(account);
  try { fs.unlinkSync(p.pid); } catch {}
  if (process.platform !== 'win32') { try { fs.unlinkSync(p.sockFile); } catch {} }
  logStaleCheck(account, `${detail}: pid belongs to '${(id.cmdline ?? id.name ?? '').trim().slice(0, 120)}' — NOT our daemon (recycled pid). Cleared the stale pid file; a fresh daemon will spawn.`);
  return true;
}

async function killDaemonNow(account) {
  const p = pathsFor(account);
  const pid = readDaemonPid(account);
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  // Wait for the daemon to actually exit, bounded at 10s. On Unix, SIGTERM runs
  // the daemon's graceful shutdown (which unlinks its own socket + pid files);
  // on Windows, Node maps SIGTERM to a hard terminate, so the process never
  // gets to remove its pid file. Polling process liveness works on both: on
  // Unix the process exits ~200ms after shutdown completes, on Windows it dies
  // near-immediately. (Previously this watched the socket file, which never
  // disappears on Windows and would always burn the full 10s.)
  const deadline = Date.now() + 10_000;
  while (pid && Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { break; } // ESRCH → process gone
    await new Promise((r) => setTimeout(r, 200));
  }
  // Extra settle so any in-flight saveCreds writes complete before the
  // caller (typically `pair`) opens the auth dir with useMultiFileAuthState.
  // Without this, pair can read a half-written creds.json and fail
  // mysteriously.
  await new Promise((r) => setTimeout(r, 500));
  // Stale Unix socket file only — on Windows the pipe is gone with the process.
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(p.sockFile); } catch {}
  }
  try { fs.unlinkSync(p.pid); } catch {}
  try { fs.unlinkSync(p.spawnLock); } catch {}
}

// The 401 circuit breaker's error, shared by every path that would otherwise
// dial WhatsApp with credentials the server has already invalidated.
function authInvalidError(account) {
  // Name the sentinel and the manual escape. Re-pairing is the normal fix,
  // but it is NOT always available: an account that is both restricted (403)
  // and logged out (401) cannot complete a pair until the restriction lifts,
  // which would otherwise leave the operator stuck behind a file they have
  // never heard of, following advice that cannot work.
  return new Error(
    `WhatsApp logged out account '${account}' (401) — automated reconnects are paused to protect the account. ` +
    `Re-link it with \`npx klaudius pair-whatsapp --label ${account}\` (or \`node scripts/whatsapp.mjs pair --account ${account}\`). ` +
    `If you need to clear the pause by hand (e.g. the account is also restricted, so pairing can't complete yet), run ` +
    `\`node scripts/whatsapp.mjs unblock --account ${account}\` — but expect sends to keep failing until the account really is re-linked.`,
  );
}

async function spawnDaemonIfNeeded(account) {
  // This fast-path MUST stay a real probe (daemonReady), never a bare
  // isDaemonAlive(): with a stale pid file + recycled pid, isDaemonAlive()
  // reads "alive", and an early return here would skip the stale-pid clearing
  // below forever — the pre-fix wedge. A failed probe falls through to the
  // lock on both platforms.
  if (await daemonReady(account)) return;
  const p = pathsFor(account);
  fs.mkdirSync(p.dir, { recursive: true });

  let lockAcquired = false;
  try {
    fs.openSync(p.spawnLock, 'wx'); // exclusive create
    lockAcquired = true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  if (lockAcquired) {
    try {
      // Stale-pid clearing runs INSIDE the spawn lock, deliberately. The
      // decision takes seconds (probe retries, maybe a PowerShell spawn); run
      // outside the lock, two concurrent shims could both classify the same
      // stale pid, the slower one unlinking the pid file of the daemon the
      // faster one just spawned — leaving that daemon invisible and, on Unix,
      // unreachable (socket file unlinked from under it), which the next op
      // then "fixes" by spawning a double. Under the lock, exactly one shim
      // decides per incident; the others sit in the poll loop below.
      await clearStalePidFile(account);
      if (!isDaemonAlive(account)) {
        const logFd = fs.openSync(p.log, 'a');
        const child = spawn(process.execPath, [DAEMON_PATH, '--account', account], {
          detached: true,
          stdio: ['ignore', logFd, logFd],
          env: process.env,
          windowsHide: true, // suppress the console-window flash a detached child causes on Windows
        });
        child.unref();
      }
    } finally {
      try { fs.unlinkSync(p.spawnLock); } catch {}
    }
  }

  const deadline = Date.now() + DAEMON_SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await daemonReady(account)) return;
    // The daemon writes this sentinel on its way out when WhatsApp answers
    // the handshake with 401. Polling on past it would burn the full spawn
    // timeout and then report "spawn timed out", which tells the operator
    // nothing — the real, actionable reason ("you've been logged out,
    // re-pair") is sitting in the daemon log unread. Surface it immediately.
    // Only the FIRST op after a logout reaches here; every later one is
    // stopped earlier by ensureDaemon's check.
    if (fs.existsSync(p.authInvalid)) throw authInvalidError(account);
    await new Promise((r) => setTimeout(r, 200));
  }
  // Name the pid file and the stale possibility: the one prior field incident
  // was resolved by a human deleting it, after this error sent them looking at
  // spawning instead. The stale-pid lines in the log carry the evidence.
  throw new Error(
    `daemon spawn timed out for account '${account}' — check ${p.log}. ` +
    `If this keeps happening, the pid file at ${p.pid} may be stale but unclearable ` +
    `(see any "stale-pid check" lines in the log); if the pid it names is not a ` +
    `klaudius whatsapp-daemon process, delete that file and retry.`,
  );
}

async function ensureDaemon(account) {
  // Circuit breaker: the daemon saw 401 loggedOut on this account, meaning
  // WhatsApp invalidated the creds server-side. Respawning would burn a full
  // handshake into a guaranteed 401 on every op — a reconnect storm against
  // an account that's already under scrutiny. Fail fast instead; the error
  // is account-level, so skills alert + cascade channels immediately.
  if (fs.existsSync(pathsFor(account).authInvalid)) throw authInvalidError(account);
  if (await daemonReady(account)) return;
  console.error(`Starting WhatsApp daemon for account '${account}'...`);
  await spawnDaemonIfNeeded(account);
}

// ---- IPC client ----

function sendOp(account, op, { timeoutMs } = {}) {
  const p = pathsFor(account);
  const t = timeoutMs ?? OP_DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(p.ipc);
    let buf = '';
    const timer = setTimeout(() => {
      try { conn.destroy(); } catch {}
      reject(new Error(`daemon op '${op.op}' for '${account}' timed out after ${t / 1000}s`));
    }, t);

    conn.on('connect', () => conn.write(JSON.stringify(op) + '\n'));
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx >= 0) {
        clearTimeout(timer);
        try {
          const resp = JSON.parse(buf.slice(0, idx));
          conn.end();
          resolve(resp);
        } catch (e) {
          reject(new Error('invalid response from daemon: ' + e.message));
        }
      }
    });
    conn.on('error', (e) => { clearTimeout(timer); reject(e); });
    conn.on('close', () => {
      clearTimeout(timer);
      if (!buf) reject(new Error('daemon closed connection without response'));
    });
  });
}

// ---- URL pre-send check (mirrors gmail.py / twilio_sms.py) ----
async function verifyDeployedUrls(body) {
  const urls = body.match(/https?:\/\/[a-zA-Z0-9._-]+\.(?:vercel\.app|pages\.dev|netlify\.app)\S*/g) || [];
  const errors = [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    try {
      // Node's global fetch (Node 18+) so this is identical on Windows / macOS
      // / Linux. The old curl `-o /dev/null` sink is Unix-only — on Windows
      // curl errored, which the catch turned into a fake "broken URL" and
      // blocked every send carrying a deployed link. Follow redirects: a URL
      // that 30x-redirects to a live page still loads fine for the client.
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      try { await res.body?.cancel(); } catch {} // release the socket; we only need the status
      if (res.status !== 200) errors.push(`${url} returned HTTP ${res.status}`);
    } catch (e) {
      // fetch puts the root cause on e.cause (e.g. DNS getaddrinfo ENOTFOUND)
      // while e.message is often just "fetch failed"; a timeout is a
      // TimeoutError. Surface both so a blocked send tells the operator WHY.
      let detail = e?.message || String(e);
      if (e?.cause?.message) detail += ` (${e.cause.message})`;
      errors.push(`${url} check failed: ${detail}`);
    }
  }
  return errors;
}

// ---- Subcommands ----

async function cmdPair(flags) {
  const account = (flags.account || 'primary').replace(/[^A-Za-z0-9_-]/g, '');
  if (!account) throw new Error('invalid --account label');

  const p = pathsFor(account);

  // Pairing needs terminal access for the QR display AND exclusive ownership
  // of the auth state on disk — stop any running daemon for this account.
  // daemonProcessAlive (not isDaemonAlive) so an ORPHANED daemon is caught
  // too: one whose socket vanished still reads as "not running" while it
  // holds the connection and writes creds.json via saveCreds. Leaving it up
  // means two writers on the auth state and two live connections on one
  // identity — and later, when the operator unlinks the old device from
  // their phone, the orphan takes the 401 and writes the circuit-breaker
  // sentinel, blocking the healthy session this pair just created.
  if (isDaemonAlive(account) || daemonProcessAlive(account)) {
    console.error(`Stopping daemon for '${account}' before re-pair...`);
    await killDaemonNow(account);
  }

  // Dynamic import — keeps the shim's send/read path startup fast.
  const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers,
  } = await import('baileys');

  fs.mkdirSync(p.auth, { recursive: true });

  if (fs.existsSync(path.join(p.auth, 'creds.json'))) {
    console.error(
      `WARNING: auth state already exists for account '${account}'. Pairing again will\n` +
      `overwrite it. Press Ctrl-C to abort, or wait 5 seconds to proceed.`,
    );
    await new Promise((r) => setTimeout(r, 5_000));
  }

  const silentLogger = {
    level: 'silent',
    trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
    child: () => silentLogger,
  };

  let { state, saveCreds } = await useMultiFileAuthState(p.auth);
  const { version } = await fetchLatestBaileysVersion();

  // Where the stale-login self-heal parks the previous auth state instead of
  // deleting it (see the loggedOut branch below). Deleted only once a new
  // link actually succeeds — if pairing can't complete (e.g. the account is
  // under a temporary restriction, so the QR can never be scanned), the old
  // session is the only thing the operator has to fall back on.
  const authBackup = p.auth + '.bak';
  let backedUpOldAuth = false;

  // Wraps every pair-failure error so the operator learns their previous
  // login survived and how to restore it. Human note to stderr; the returned
  // Error keeps the machine-readable message clean.
  // Note the backup whenever one EXISTS, not only when this run made it. A
  // second pair attempt starts from an empty auth dir, so the heal doesn't
  // re-fire and `backedUpOldAuth` stays false — yet the previous run's backup
  // is still sitting there, and this run's operator is exactly the person who
  // needs to know about it.
  function pairError(message) {
    // List EVERY backup, oldest first. Repeated failed pairs park the previous
    // auth.bak to auth.bak.<timestamp>, so `auth.bak` is the most RECENT set
    // aside — which after a second failed attempt is the half-paired junk a
    // 515/saveCreds wrote, not the original login. Naming only auth.bak would
    // point the operator at the junk and leave the real credentials, sitting
    // in the oldest file, unmentioned.
    let backups = [];
    try {
      const dir = path.dirname(p.auth);
      const base = path.basename(p.auth) + '.bak';
      backups = fs.readdirSync(dir)
        .filter((n) => n === base || n.startsWith(base + '.'))
        .map((n) => {
          const full = path.join(dir, n);
          let mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch {}
          return { full, mtime };
        })
        .sort((a, b) => a.mtime - b.mtime);
    } catch {}

    if (backups.length === 1) {
      console.error(
        `\nNote: your previous WhatsApp login for '${account}' was set aside (not deleted) at:\n` +
        `  ${backups[0].full}\n` +
        `If this account recovers (e.g. a temporary restriction lifts), you can try restoring it:\n` +
        `delete the '${p.auth}' folder, rename the backup to '${p.auth}', then send again.\n` +
        `(If WhatsApp truly logged the session out, the restored login will fail again and you'll need to re-pair.)\n`,
      );
    } else if (backups.length > 1) {
      console.error(
        `\nNote: ${backups.length} previous WhatsApp logins for '${account}' were set aside (none deleted), oldest first:\n` +
        backups.map((b, i) => `  ${i + 1}. ${b.full}${i === 0 ? '   <- OLDEST: most likely your original working login' : ''}`).join('\n') +
        `\nLater entries are usually half-finished pairings from repeated attempts, not real logins.\n` +
        `To restore one: delete the '${p.auth}' folder, rename your chosen backup to '${p.auth}', then send again.\n` +
        `(If WhatsApp truly logged the session out, a restored login will fail again and you'll need to re-pair.)\n`,
      );
    }
    // Every pair failure routes through here — remove the QR image (a
    // device-linking credential) so an abandoned pairing doesn't leave it
    // sitting in the project root. The success path deletes it separately.
    try { fs.rmSync(qrPngPath, { force: true }); } catch {}
    return new Error(message);
  }

  const qrPngPath = path.join(process.cwd(), 'whatsapp-qr.png');
  // When stderr is a real terminal we draw the block-QR operators expect. When
  // it isn't (e.g. pair run through Claude Code's `!` prefix, which captures
  // output to a pipe and collapses the ~33-line QR into an unscannable
  // preview), we skip the giant QR and steer to the PNG / a real terminal.
  const interactive = !!process.stderr.isTTY;
  let qrIntroPrinted = false;
  let qrPngAnnounced = false;
  let healedOnce = false;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sock = makeWASocket({
      version,
      auth: state,
      // Standard desktop-browser tuple matching the HOST OS (Windows box
      // declares Windows, Mac declares Mac OS, Linux falls back to Ubuntu) —
      // an internally consistent fingerprint beats declaring macOS from a
      // Windows machine. Pairing is where the tuple's os string is embedded
      // into the registration payload, so this call site is the one that
      // decides what WhatsApp's servers see the linked device as — keep it
      // in lockstep with whatsapp-daemon.mjs.
      browser: Browsers.appropriate('Chrome'),
      syncFullHistory: false,
      logger: silentLogger,
      markOnlineOnConnect: false,
    });
    sock.ev.on('creds.update', saveCreds);

    let done = false;
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve({ kind: 'timeout' }); }
      }, PAIR_TIMEOUT_MS);
      sock.ev.on('connection.update', async (update) => {
        if (done) return;
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
          if (!qrIntroPrinted) {
            console.error(
              `\nPairing WhatsApp account '${account}'.\n` +
              '\n' +
              "IMPORTANT: Do NOT scan this with your phone's normal camera app, that won't work.\n" +
              '\n' +
              'In the WhatsApp app on the phone whose number you want to link:\n' +
              '  1. Tap the "Settings" icon (bottom-right of the bottom tab bar)\n' +
              '  2. Tap "Linked Devices"\n' +
              '  3. Tap "Link a Device"\n' +
              "  4. Point WhatsApp's built-in scanner at the QR code.\n",
            );
            qrIntroPrinted = true;
          }
          // Save the QR as a full-resolution PNG. WhatsApp rotates the code
          // every ~20s, so we rewrite it on every refresh to keep it current.
          const written = await writeQrPng(qr, qrPngPath);
          if (done) return;
          // Real terminal: draw the block-QR (what operators expect). Non-TTY:
          // skip it (it only collapses into an unscannable preview) UNLESS we
          // couldn't write a PNG, in which case a squashed QR still beats
          // nothing.
          if (interactive || !written) {
            qrcode.generate(qr, { small: true });
          }
          if (!qrPngAnnounced) {
            qrPngAnnounced = true;
            if (written && interactive) {
              console.error(`\nTip: the QR is also saved as an image at ${written}, in case the one above is hard to scan.\n`);
            } else if (written) {
              console.error(
                `\nThis window can't show a scannable QR. Open this image and scan it with WhatsApp instead:\n  ${written}\n` +
                `(The code refreshes every ~20s. If it won't scan, close the image and open it again to get the latest one.)\n`,
              );
            } else if (!interactive) {
              console.error(
                `\nThis window can't display a scannable QR code. Open a normal terminal window, go to this folder, and run:\n  node scripts/whatsapp.mjs pair\n`,
              );
            }
          }
          return;
        }
        if (connection === 'open') { done = true; clearTimeout(timer); resolve({ kind: 'open' }); }
        else if (connection === 'close') {
          done = true;
          clearTimeout(timer);
          resolve({
            kind: 'close',
            code: lastDisconnect?.error?.output?.statusCode,
            message: lastDisconnect?.error?.message ?? 'no message',
          });
        }
      });
    });

    if (outcome.kind === 'open') {
      console.error(`\nPaired. Auth state saved to ${p.auth}`);
      // A successful link is the one thing that clears the 401 circuit
      // breaker — must happen BEFORE the ensureDaemon pre-spawn below, which
      // fails fast while the sentinel exists. The now-superseded auth backup
      // (if the stale-login self-heal made one) is deleted here too: the new
      // link is live, so there's nothing left to fall back on it for.
      try { fs.rmSync(p.authInvalid, { force: true }); } catch {}
      try { fs.rmSync(authBackup, { recursive: true, force: true }); } catch {}
      try { sock.end(undefined); } catch {}
      // Wait for sock teardown + saveCreds to flush before we spawn the
      // daemon below — otherwise the daemon's makeWASocket can race the
      // just-ended Baileys connection and confuse WhatsApp's one-device-
      // per-account rule.
      await new Promise((r) => setTimeout(r, 1500));
      // Remove the QR image now (after the settle wait) so a QR write that was
      // still in flight when the scan landed can't re-create it post-delete.
      try { fs.rmSync(qrPngPath, { force: true }); } catch {}
      // Pre-spawn the daemon so the operator's first /outreach send doesn't
      // pay the full 5-15s Baileys handshake cost on top of pair completion.
      // Failure here is non-fatal: the shim auto-respawns on next op.
      console.error(`Pre-spawning daemon for '${account}' so the first send is ready...`);
      try {
        await ensureDaemon(account);
        console.error(`Daemon for '${account}' is up.`);
      } catch (e) {
        console.error(`Daemon spawn timed out (${e.message}); it will respawn on next send.`);
      }
      process.exit(0);
    }

    try { sock.end(undefined); } catch {}

    if (outcome.kind === 'timeout') throw pairError('pair timeout, re-run when ready');
    if (outcome.code === DisconnectReason.loggedOut) {
      // A stale/expired creds.json makes Baileys try to RESUME a dead session
      // instead of showing a fresh QR: it logs straight out and no QR ever
      // appears. Self-heal once by wiping the auth state and re-pairing clean,
      // so the operator never has to delete files by hand.
      if (!healedOnce) {
        healedOnce = true;
        console.error("Found a stale WhatsApp login for this account. Setting it aside and showing a fresh QR...");
        // Rename, don't delete: if this pairing never completes, pairError()
        // tells the operator the old login survived and how to restore it.
        //
        // NEVER clobber an existing backup. `healedOnce` resets on every
        // invocation, so a second `pair` run can reach here — and by then
        // p.auth may hold half-paired junk rather than a real login (the
        // normal post-scan 515 restartRequired path calls saveCreds, writing
        // a creds.json into the fresh dir). Overwriting would destroy the
        // GOOD login the previous run set aside and then tell the operator
        // their previous login was preserved, pointing them at the junk.
        // Park anything already there under a timestamp instead.
        if (fs.existsSync(authBackup)) {
          const parked = `${authBackup}.${Date.now()}`;
          try {
            fs.renameSync(authBackup, parked);
            console.error(`(An earlier backup was already present; kept it at ${parked}.)`);
          } catch {
            // Can't park it — refuse to destroy it. Leaving the older backup
            // in place is strictly better than losing the only good creds.
            console.error(`(An earlier backup at ${authBackup} could not be moved; leaving it untouched.)`);
          }
        }
        try {
          fs.renameSync(p.auth, authBackup);
          backedUpOldAuth = true;
        } catch {
          // Rename across weird mounts / locked files: fall back to delete so
          // the heal still works — worst case is the old (pre-fix) behaviour.
          try { fs.rmSync(p.auth, { recursive: true, force: true }); } catch {}
        }
        fs.mkdirSync(p.auth, { recursive: true });
        ({ state, saveCreds } = await useMultiFileAuthState(p.auth));
        qrIntroPrinted = false;
        attempt = 0; // restart the attempt budget for the clean re-pair
        continue;
      }
      throw pairError('logged out during pair');
    }
    if (outcome.code === DisconnectReason.restartRequired) {
      try { await saveCreds(); } catch {}
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (outcome.code === DisconnectReason.forbidden) {
      // 403: the account is restricted/banned. Retrying produces fresh
      // handshakes at a restricted account — exactly the signal to avoid
      // while it's under review (same rationale as the daemon's 403
      // handling). Stop immediately with a clear explanation.
      throw pairError(
        'pair failed: WhatsApp reports this account as restricted or banned (code 403). ' +
        'Pairing will not succeed until the restriction lifts — check the WhatsApp app ' +
        'on the phone for details, wait it out, then re-run pair.',
      );
    }
    if (attempt < maxAttempts) {
      console.error(`Connection close (code ${outcome.code}: ${outcome.message}); retrying (${attempt + 1}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    throw pairError(`pair failed (code ${outcome.code}: ${outcome.message})`);
  }
}

async function cmdSend(flags) {
  if (!flags.to) throw new Error('--to is required');
  if (!flags.body) throw new Error('--body is required');

  // Account selection: explicit --account wins; else round-robin from
  // WHATSAPP_ACCOUNTS. Skill code (/outreach, /follow-up) should always pass
  // --account explicitly so the same account is used for follow-up touches.
  const account = flags.account
    ? String(flags.account).replace(/[^A-Za-z0-9_-]/g, '')
    : pickAccountRR(getConfiguredAccounts());

  const body = String(flags.body).replace(
    /\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(parseInt(hex, 16)),
  );

  const urlErrors = await verifyDeployedUrls(body);
  if (urlErrors.length > 0) {
    console.error('BLOCKED: Message contains broken URLs:');
    for (const e of urlErrors) console.error('  - ', e);
    console.error('Fix the deployment before sending.');
    process.exit(1);
  }

  if (flags['dry-run']) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      account,
      to: flags.to,
      body_preview: body.slice(0, 100),
    }));
    process.exit(0);
  }

  const p = pathsFor(account);
  if (!fs.existsSync(path.join(p.auth, 'creds.json'))) {
    console.error(`ERROR: no WhatsApp auth state for account '${account}'. Run \`node scripts/whatsapp.mjs pair --account ${account}\` (or \`npx klaudius pair-whatsapp --label ${account}\`).`);
    process.exit(1);
  }

  await ensureDaemon(account);
  const resp = await sendOp(account, { op: 'send', to: flags.to, body }, { timeoutMs: OP_SEND_TIMEOUT_MS });
  console.log(JSON.stringify(resp));
  process.exit(resp.ok ? 0 : 2);
}

async function cmdRead(flags) {
  if (!flags.phone) throw new Error('--phone is required');
  const account = (flags.account || 'primary').replace(/[^A-Za-z0-9_-]/g, '');
  const p = pathsFor(account);
  if (!fs.existsSync(path.join(p.auth, 'creds.json'))) {
    console.error(`ERROR: no WhatsApp auth state for account '${account}'. Run \`pair --account ${account}\` first.`);
    process.exit(1);
  }
  await ensureDaemon(account);
  const resp = await sendOp(account, {
    op: 'read',
    phone: flags.phone,
    limit: parseInt(flags.limit || '30', 10),
  });
  console.log(JSON.stringify(resp, null, 2));
  process.exit(resp.ok ? 0 : 1);
}

// Registry-only lookup: is this number on WhatsApp? Sends nothing and
// doesn't touch the send-pacing budget. Lets /find screen a shortlisted
// candidate BEFORE a build is spent — a verified mobile can simply not be
// registered. Probe single candidates, never pools (enumeration signal).
async function cmdCheckNumber(flags) {
  if (!flags.phone) throw new Error('--phone is required');
  // Pre-claim there is no stored outreach_account yet, so default to the
  // first configured account that's actually paired on this machine. (Not
  // pickAccountRR — that would advance the send rotation's counter for a
  // read-only probe.)
  const configured = getConfiguredAccounts();
  const account = flags.account
    ? String(flags.account).replace(/[^A-Za-z0-9_-]/g, '')
    : (configured.find((a) => fs.existsSync(path.join(pathsFor(a).auth, 'creds.json'))) ?? configured[0]);
  const p = pathsFor(account);
  if (!fs.existsSync(path.join(p.auth, 'creds.json'))) {
    console.error(`ERROR: no WhatsApp auth state for account '${account}'. Run \`npx klaudius pair-whatsapp --label ${account}\` first.`);
    process.exit(1);
  }
  await ensureDaemon(account);
  // Cold-start budget: waitForSock (90s) + the paced lookup itself.
  const resp = await sendOp(account, { op: 'check_number', phone: flags.phone }, { timeoutMs: 120_000 });
  if (!resp.ok && typeof resp.error === 'string' && resp.error.includes('unknown op')) {
    console.error(
      `The WhatsApp daemon for '${account}' is running an older version of Klaudius than the one installed.\n` +
      `Restart it to pick up the update (it respawns by itself on the next op):\n` +
      `  node scripts/whatsapp.mjs stop --account ${account}`,
    );
    process.exit(1);
  }
  console.log(JSON.stringify(resp));
  process.exit(resp.ok ? 0 : 1);
}

async function cmdCheck(flags) {
  const accounts = flags.all ? getConfiguredAccounts() : [
    (flags.account || 'primary').replace(/[^A-Za-z0-9_-]/g, ''),
  ];
  const out = [];
  for (const account of accounts) {
    const p = pathsFor(account);
    if (!fs.existsSync(path.join(p.auth, 'creds.json'))) {
      out.push({ account, ok: false, error: 'not_paired' });
      continue;
    }
    try {
      await ensureDaemon(account);
      const resp = await sendOp(account, { op: 'status' });
      out.push(resp);
    } catch (e) {
      out.push({ account, ok: false, error: e.message });
    }
  }
  console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
  process.exit(out.every((r) => r.ok) ? 0 : 1);
}

// Ask WhatsApp how an account is standing — its new-chat message quota and
// whether a reachout timelock is active. Goes through the daemon (which
// already holds the connection) rather than opening its own; see the note on
// handleStanding in whatsapp-daemon.mjs for why a standalone prober would
// silently eat inbound messages.
async function cmdStanding(flags) {
  const account = (flags.account || 'primary').replace(/[^A-Za-z0-9_-]/g, '');
  const p = pathsFor(account);
  if (!fs.existsSync(path.join(p.auth, 'creds.json'))) {
    console.error(`ERROR: no WhatsApp auth state for account '${account}'. Run \`npx klaudius pair-whatsapp --label ${account}\` first.`);
    process.exit(1);
  }
  await ensureDaemon(account);
  // Budget: the daemon may wait up to 90s for Baileys (waitForSock) on a cold
  // start, then up to 20s for each of the two account-standing queries. Give
  // it headroom above that 130s worst case, or a slow-but-working daemon gets
  // reported as a timeout and its results thrown away.
  const resp = await sendOp(account, { op: 'standing' }, { timeoutMs: 150_000 });

  // The daemon is long-lived and `klaudius update` only replaces the file on
  // disk — a daemon started before the update keeps running the OLD code and
  // doesn't know this op. Say so plainly rather than surfacing a bare
  // "unknown op", because that same stale process is also missing the
  // restriction gate and delivery-receipt capture.
  if (!resp.ok && typeof resp.error === 'string' && resp.error.includes('unknown op')) {
    console.error(
      `The WhatsApp daemon for '${account}' is running an older version of Klaudius than the one installed.\n` +
      `Restart it to pick up the update (it respawns by itself on the next send):\n` +
      `  node scripts/whatsapp.mjs stop --account ${account}\n` +
      `Until then, account-standing checks, the restriction gate and delivery tracking are all inactive.`,
    );
    process.exit(1);
  }

  console.log(JSON.stringify(resp, null, 2));

  if (!flags.json && resp.ok) {
    const cap = resp.new_chat_message_cap?.result;
    const tl = resp.reachout_timelock?.result;
    console.error('\n--- Summary ---');
    if (resp.pairing) {
      console.error(
        `Session age: this device was linked ${resp.pairing.age_days} day(s) ago` +
        `${resp.pairing.trustworthy ? '' : ' (approximate — filesystem has no true creation time)'}. ` +
        'A recently linked session behaves like a new number; ramp volume up gradually.',
      );
    }
    // The warning NEVER depends on eligibility. mv_status (volume programme)
    // and ote_status (one-time extension) are INDEPENDENT: an account can sit
    // at mv_status ACTIVE with ote_status NOT_ELIGIBLE, which is ordinary.
    // Gating the alarm on both being eligible meant a genuinely CAPPED number
    // got told "not metering" — the tool reassuring the operator at the exact
    // moment it should be shouting. capping_status is the authority; the
    // eligibility fields only decide whether a used/total line is meaningful.
    const status = cap?.capping_status;
    const hasQuota = cap && cap.total_quota !== null && cap.total_quota !== undefined && cap.total_quota > 0;
    if (hasQuota) {
      console.error(`New-chat quota: ${cap.used_quota ?? '?'} of ${cap.total_quota} used this cycle. Status: ${status ?? 'unknown'}.`);
      if (cap.cycle_end_timestamp && String(cap.cycle_end_timestamp).length > 4) {
        console.error(`Cycle ends: ${cap.cycle_end_timestamp}`);
      }
    } else if (cap) {
      // total_quota 0/absent means "not metered", NOT "you may send zero".
      console.error('New-chat quota: WhatsApp reports no quota for this account (not currently metered). That is normal, and is NOT a quota of zero.');
    } else {
      console.error('New-chat quota: WhatsApp returned nothing usable for this account.');
    }
    if (status === 'FIRST_WARNING' || status === 'SECOND_WARNING') {
      console.error(`\n  *** WhatsApp has WARNED this number about new-chat volume (${status}). ***\n  Stop initial outreach on it today. Follow-ups into existing threads are lower risk.`);
    } else if (status === 'CAPPED') {
      console.error('\n  *** This number is CAPPED for new chats. ***\n  Send no initial outreach from it until the cycle resets.');
    }
    const d = resp.delivery;
    if (d && d.sent > 0) {
      const pct = d.delivery_rate === null ? null : Math.round(d.delivery_rate * 100);
      console.error(
        `Delivery (last ${d.window_days}d): ${d.delivered}/${d.sent} confirmed delivered` +
        `${pct === null ? ' (too few sends to rate yet)' : `, ${pct}%`}` +
        `${d.unconfirmed ? `, ${d.unconfirmed} still unconfirmed` : ''}.`,
      );
      if (pct !== null && pct < 60) {
        console.error(
          '\n  *** Delivery rate is low. ***\n' +
          '  Messages are being accepted but not arriving, which is what a soft-ban\n' +
          '  looks like. Stop outreach on this number and check a recent thread on\n' +
          '  the phone before sending more.',
        );
      }
    }
    if (tl?.isActive) {
      console.error(
        `\n  *** A reachout timelock is ACTIVE (${tl.enforcementType ?? 'unknown type'}). ***\n` +
        `  WhatsApp is blocking messages to people this number hasn't spoken to` +
        `${tl.timeEnforcementEnds ? ` until ${tl.timeEnforcementEnds}` : ''}.\n  Pause outreach on it.`,
      );
    } else if (tl) {
      console.error(`Reachout timelock: none active (${tl.enforcementType ?? 'DEFAULT'}).`);
    } else {
      console.error('Reachout timelock: WhatsApp reported nothing usable for this account.');
    }
  }
  process.exit(resp.ok ? 0 : 1);
}

// Manually clear the 401 circuit breaker. Normally a successful `pair` does
// this; `unblock` exists for the case where pairing itself can't complete yet
// (account restricted as well as logged out), so the operator isn't trapped
// behind a sentinel with no documented way out.
async function cmdUnblock(flags) {
  const account = (flags.account || 'primary').replace(/[^A-Za-z0-9_-]/g, '');
  const p = pathsFor(account);
  if (!fs.existsSync(p.authInvalid)) {
    console.error(`Account '${account}': no logged-out pause is set (nothing to clear).`);
    process.exit(0);
  }
  let detail = '';
  try {
    const s = JSON.parse(fs.readFileSync(p.authInvalid, 'utf8'));
    if (s?.at) detail = ` (set at ${s.at})`;
  } catch {}
  try { fs.rmSync(p.authInvalid, { force: true }); } catch {}
  console.error(
    `Account '${account}': cleared the logged-out pause${detail}.\n` +
    'Note: this only re-enables reconnect attempts. If WhatsApp really did log the\n' +
    'session out, the next connection will 401 again and the pause will come straight\n' +
    `back — the actual fix is \`npx klaudius pair-whatsapp --label ${account}\`.`,
  );
  process.exit(0);
}

async function cmdStop(flags) {
  const accounts = flags.all ? getConfiguredAccounts() : [
    (flags.account || 'primary').replace(/[^A-Za-z0-9_-]/g, ''),
  ];
  for (const account of accounts) {
    if (!isDaemonAlive(account)) {
      // isDaemonAlive() demands BOTH a live pid AND a bound socket file, so a
      // daemon whose socket has gone missing under it reads as "not running"
      // while its process is very much alive — still holding the WhatsApp
      // connection. Reporting "not running" and moving on ORPHANS it, and an
      // orphan is the multi-connection hazard the 440 handling exists to
      // avoid. Probe the pid on its own and kill anything that answers.
      const pid = daemonProcessAlive(account);
      if (pid) {
        console.error(
          `Account '${account}': daemon process ${pid} is alive but its IPC socket is missing (orphaned). Killing it directly.`,
        );
        await killDaemonNow(account);
        continue;
      }
      console.error(`Account '${account}': daemon is not running.`);
      continue;
    }
    try {
      const resp = await sendOp(account, { op: 'shutdown' }, { timeoutMs: 5000 });
      console.error(`Account '${account}': ${resp.ok ? 'shutdown requested.' : 'error: ' + resp.error}`);
    } catch (e) {
      console.error(`Account '${account}': graceful shutdown failed (${e.message}); killing PID directly.`);
      await killDaemonNow(account);
    }
  }
  process.exit(0);
}

// ---- Entry ----

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  try {
    switch (cmd) {
      case 'pair': await cmdPair(flags); break;
      case 'send': await cmdSend(flags); break;
      case 'read': await cmdRead(flags); break;
      case 'check-number': await cmdCheckNumber(flags); break;
      case 'check':
      case 'status': await cmdCheck(flags); break;
      case 'standing': await cmdStanding(flags); break;
      case 'unblock': await cmdUnblock(flags); break;
      case 'stop': await cmdStop(flags); break;
      default:
        console.error('Usage:');
        console.error('  node scripts/whatsapp.mjs pair [--account <label>]');
        console.error('  node scripts/whatsapp.mjs send --to "+447xxx" --body "..." [--account <label>] [--dry-run]');
        console.error('  node scripts/whatsapp.mjs read --phone "+447xxx" [--limit 30] [--account <label>]');
        console.error('  node scripts/whatsapp.mjs check-number --phone "+447xxx" [--account <label>]   (is this number on WhatsApp? sends nothing)');
        console.error('  node scripts/whatsapp.mjs check [--account <label>] [--all]');
        console.error('  node scripts/whatsapp.mjs standing [--account <label>] [--json]');
        console.error('  node scripts/whatsapp.mjs unblock [--account <label>]');
        console.error('  node scripts/whatsapp.mjs stop  [--account <label>] [--all]');
        console.error('');
        console.error('Account defaults: pair/read/check/stop → "primary"; send auto-rotates via WHATSAPP_ACCOUNTS env.');
        process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
    process.exit(1);
  }
}

main();
