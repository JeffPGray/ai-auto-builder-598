#!/usr/bin/env node
/**
 * whatsapp-daemon.mjs - Long-lived Baileys process for the WhatsApp lane.
 *
 * One daemon per linked WhatsApp account. Operators with multiple numbers
 * (Crux 3: round-robin) run several daemons in parallel; each owns its own
 * auth state, SQLite mirror, IPC socket, and PID file under
 * ~/.klaudius/whatsapp/<account>/. Each is identical code — `--account
 * <label>` is the only thing distinguishing the processes.
 *
 * Spawned automatically by scripts/whatsapp.mjs on first send/read/check for
 * that label. Holds ONE Baileys WS connection — solves the concurrency
 * problem that bites parallel pipeline children all opening their own Baileys
 * socket (WhatsApp kicks older connections + tear-writes auth on disk).
 *
 * State (per account):
 *   ~/.klaudius/whatsapp/<account>/auth/        Baileys auth (shared with `pair`)
 *   ~/.klaudius/whatsapp/<account>/messages.db  SQLite mirror of every message
 *   ~/.klaudius/whatsapp/<account>/daemon.sock  IPC endpoint (Unix domain socket; a \\.\pipe\ named pipe on Windows)
 *   ~/.klaudius/whatsapp/<account>/daemon.pid   PID file (liveness check)
 *   ~/.klaudius/whatsapp/<account>/daemon.log   Append-only log
 *   ~/.klaudius/whatsapp/<account>/auth-invalid Sentinel: WhatsApp 401'd these
 *                                               creds; blocks every respawn
 *                                               until `pair` succeeds
 *
 * Usage:
 *   node scripts/whatsapp-daemon.mjs                 # account = primary (default)
 *   node scripts/whatsapp-daemon.mjs --account uk-2  # explicit label
 *
 * IPC: line-delimited JSON. One op per connection.
 *   Request:  {"id":"...","op":"send","to":"+447xxx","body":"..."}
 *   Response: {"id":"...","ok":true,"message_id":"...","to":"...","jid":"..."}
 *
 * Ops: send, check_number, read, check, status, standing, shutdown.
 */

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} from 'baileys';
import Database from 'better-sqlite3';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

// ---- arg parsing ----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const ACCOUNT = String(args.account || 'primary').replace(/[^A-Za-z0-9_-]/g, '');
if (!ACCOUNT) {
  console.error('Invalid --account label (must be alphanumeric, underscore, or hyphen).');
  process.exit(1);
}

const HOME = os.homedir();
const STATE_BASE = process.env.KLAUDIUS_WHATSAPP_STATE_DIR
  || path.join(HOME, '.klaudius', 'whatsapp');
const ACCOUNT_DIR = path.join(STATE_BASE, ACCOUNT);
const AUTH_DIR = path.join(ACCOUNT_DIR, 'auth');
const DB_PATH = path.join(ACCOUNT_DIR, 'messages.db');
// IPC endpoint passed to net's server.listen(). On Unix this is a Unix-domain
// socket file inside the account dir. On Windows, Node implements local-domain
// sockets as named pipes, which MUST live in the \\.\pipe\ namespace (a plain
// file path fails to bind), so we map the account label to a stable pipe name.
// ACCOUNT is already sanitised to [A-Za-z0-9_-] above, so it's pipe-name-safe.
// Must mirror ipcEndpoint() in scripts/whatsapp.mjs exactly.
const IPC_ENDPOINT = process.platform === 'win32'
  ? `\\\\.\\pipe\\klaudius-whatsapp-${ACCOUNT}`
  : path.join(ACCOUNT_DIR, 'daemon.sock');
const PID_PATH = path.join(ACCOUNT_DIR, 'daemon.pid');
const LOG_PATH = path.join(ACCOUNT_DIR, 'daemon.log');
// Circuit-breaker sentinel (must mirror pathsFor().authInvalid in
// scripts/whatsapp.mjs). Written when WhatsApp returns 401 loggedOut — the
// server has invalidated these creds, so every future dial with them is a
// guaranteed 401. Cleared only by a successful `pair`.
const AUTH_INVALID_SENTINEL = path.join(ACCOUNT_DIR, 'auth-invalid');

// Minimum gap between sends, plus a random jitter on top so the cadence is
// never machine-exact (a fixed N-second period between messages is a bot
// signature; humans don't send on a metronome). Effective gap: 30-45s.
// Keep base + jitter comfortably under the shim's OP_SEND_TIMEOUT_MS (120s).
const SEND_INTERVAL_SECS = 30;
const SEND_JITTER_SECS = 15;
const CONNECT_TIMEOUT_MS = 60_000;

// libsignal hard-codes a console.log of session state (incl. privKey) on close.
// Filter it; our own daemon output goes through the log file, not console.
const _origConsoleLog = console.log;
console.log = (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('Closing session:')) return;
  _origConsoleLog.apply(console, a);
};

// ---- bootstrap ----
fs.mkdirSync(ACCOUNT_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

// Refuse to start if another daemon for this account is already alive — auth
// state must have exactly one live owner. This guard trusts pid LIVENESS, so
// a recycled pid could fake "already running" — tolerable because the shim
// clears provably-stale pid files before every spawn (clearStalePidFile in
// whatsapp.mjs), so a false positive here requires a hand-started daemon
// racing a recycled pid. Note the message below lands in daemon.log (our
// stderr is redirected there by the shim), not on the operator's console.
if (fs.existsSync(PID_PATH)) {
  try {
    const existingPid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
    if (existingPid && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0); // probe liveness
        console.error(`Another daemon for account '${ACCOUNT}' is already running (pid ${existingPid}). Exiting.`);
        process.exit(1);
      } catch {
        // Stale pid file — owner is gone, safe to take over.
      }
    }
  } catch {}
}
// Circuit breaker, checked BEFORE we claim the pid file or open the log
// stream. A previous run saw 401 loggedOut on this account, so WhatsApp has
// invalidated these credentials and every handshake with them is a
// guaranteed 401. The shim refuses to spawn us while the sentinel exists,
// but a stale shim or a hand-started daemon could still get here — refuse to
// dial regardless. Without this, every op respawned a daemon that instantly
// 401'd; one operator logged 390 such handshakes against an account already
// under restriction, which is the automation signal to avoid.
//
// Deliberately ahead of the pid write and the log stream: exiting after
// claiming the pid file would need an unlink (racing any daemon starting in
// that window), and process.exit() does NOT flush a createWriteStream, so a
// buffered "daemon starting" line would be silently dropped from the log.
// appendFileSync writes now, whatever happens next.
if (fs.existsSync(AUTH_INVALID_SENTINEL)) {
  const msg = `auth-invalid sentinel present — WhatsApp logged this account out (401). Not connecting. Re-pair with \`npx klaudius pair-whatsapp --label ${ACCOUNT}\`, or clear the pause with \`node scripts/whatsapp.mjs unblock --account ${ACCOUNT}\`.`;
  try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
  process.exit(1);
}

fs.writeFileSync(PID_PATH, String(process.pid));

const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
function log(...a) {
  const ts = new Date().toISOString();
  const parts = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  logStream.write(`[${ts}] ${parts.join(' ')}\n`);
}
log('daemon starting, account=', ACCOUNT);

// ---- SQLite mirror ----
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT NOT NULL,
    jid TEXT NOT NULL,
    from_me INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    body TEXT,
    message_type TEXT,
    raw_json TEXT,
    captured_at INTEGER NOT NULL,
    PRIMARY KEY (jid, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages(jid, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);
`);
// Delivery status, added after the table shipped — existing installs upgrade
// in place. SQLite has no ADD COLUMN IF NOT EXISTS, so check first.
{
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('status')) db.exec('ALTER TABLE messages ADD COLUMN status TEXT');
}

const insertMessage = db.prepare(`
  INSERT OR IGNORE INTO messages
    (message_id, jid, from_me, timestamp, body, message_type, raw_json, captured_at, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// PENDING -> SERVER_ACK (server got it) -> DELIVERY_ACK (device got it) ->
// READ -> PLAYED. Baileys may hand us the numeric enum or its name.
const STATUS_NAMES = ['ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'];
function statusName(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return STATUS_NAMES[raw] ?? String(raw);
  return String(raw);
}
function statusRank(name) {
  const i = STATUS_NAMES.indexOf(String(name));
  return i < 0 ? -1 : i;
}
const STATUS_RANK_SERVER_ACK = STATUS_NAMES.indexOf('SERVER_ACK');
// Register BEFORE preparing any statement that calls it: better-sqlite3
// resolves function names at prepare() time, so preparing first throws
// "no such function: status_rank" and takes the whole daemon down at startup.
db.function('status_rank', (name) => statusRank(name));

// Receipts arrive later than the message itself, as messages.update events.
//
// Matched on message_id ALONE, deliberately — NOT on (jid, message_id) even
// though that's the primary key. Verified live 2026-07-30: a message sent to
// `447xxx@s.whatsapp.net` is stored under that PN jid, but its receipt comes
// back with remoteJid `<lidUser>@lid`. Including jid in the predicate means
// the update never matches and every message stays PENDING forever — the
// same PN-vs-LID split that made a single outgoing message read back as two
// touches. Message ids are unique per sender, and when a message HAS been
// stored under both jid forms, updating both rows is what we want anyway.
//
// Only ever move a message FORWARD through the delivery ladder — receipts can
// arrive out of order, and without the rank check a late SERVER_ACK would
// downgrade a message already marked READ.
const updateMessageStatus = db.prepare(`
  UPDATE messages SET status = ?
  WHERE message_id = ?
    AND COALESCE(status_rank(status), -1) < ?
`);

// ERROR sits at rank 0, BELOW PENDING, so the monotonic rule above can never
// record it once a message is stored (outgoing messages are inserted as
// PENDING). But ERROR is a terminal failure, not a lower rung — and a send
// that failed outright is exactly what the delivery signal needs to see.
// Allow it to overwrite, but only states that aren't yet confirmed delivered,
// so a late spurious ERROR can't undo a real DELIVERY_ACK/READ.
const markMessageError = db.prepare(`
  UPDATE messages SET status = 'ERROR'
  WHERE message_id = ?
    AND COALESCE(status_rank(status), -1) <= ${STATUS_RANK_SERVER_ACK}
`);

// Has this contact ever messaged US? Used to let replies through a reachout
// timelock, which only restricts messaging people who haven't engaged.
// Deliberately NOT the four-way jid match handleRead uses: that needs
// signalRepository for the LID lookup and can throw. Here a miss just means
// we block, which is the safe direction.
const hasInboundFromJid = db.prepare(`
  SELECT 1 FROM messages
  WHERE from_me = 0 AND (jid = ? OR jid LIKE ?)
  LIMIT 1
`);

function extractBody(message) {
  if (!message) return null;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    null
  );
}

function captureMessage(m, source) {
  if (!m?.key?.id || !m?.key?.remoteJid) return;
  try {
    const body = extractBody(m.message);
    const messageType = m.message ? Object.keys(m.message)[0] : 'unknown';
    insertMessage.run(
      m.key.id,
      m.key.remoteJid,
      m.key.fromMe ? 1 : 0,
      Number(m.messageTimestamp || 0),
      body,
      messageType,
      JSON.stringify(m),
      Math.floor(Date.now() / 1000),
      statusName(m.status),
    );
  } catch (e) {
    log(`capture error (${source}):`, e.message);
  }
}

// ---- Baileys ----
const silentLogger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {},
  child: () => silentLogger,
};

let sock = null;
let lastSendAt = 0;
let reconnectInFlight = false;
// Latest unprompted `message-capping.update` WhatsApp pushed at us. WhatsApp
// warns before it caps a number for new-chat volume, and the warning arrives
// as a push rather than an answer to anything we asked — so we hold on to it
// for the `standing` op to report.
let lastCappingPush = null;
// Latest known reachout-timelock state. While one is active WhatsApp blocks
// outgoing messages to people this number hasn't spoken to — so sending into
// one produces guaranteed-failed sends AND piles more automation signal onto
// an account already under enforcement. Primed on connect and refreshed by
// server pushes; `null` means unknown, which never blocks (fail open).
let reachoutTimelock = null;

// How long to trust an active timelock that carries NO end time. WhatsApp can
// report `isActive` with `timeEnforcementEnds` absent, and without a bound
// that state blocks every send forever: nothing expires it, and if the
// refresh query later fails the stale object simply persists. A silent,
// permanent WhatsApp outage is worse than the restriction it guards against —
// so past this age we fall back to "unknown" and let sends through. WhatsApp
// rejects sends made during a real lock anyway, which costs a failed send,
// not an account.
const TIMELOCK_NO_EXPIRY_MAX_AGE_MS = 60 * 60 * 1000;

// The blocking timelock, or null. Fails OPEN in every uncertain case.
function activeTimelock() {
  if (!reachoutTimelock?.isActive) return null;
  const ends = reachoutTimelock.timeEnforcementEnds;
  const endsMs = ends instanceof Date ? ends.getTime() : (ends ? Date.parse(ends) : NaN);
  if (Number.isFinite(endsMs)) {
    // Known end time: trust it exactly, and let it expire on its own.
    return endsMs <= Date.now() ? null : reachoutTimelock;
  }
  // No end time — trust it only briefly, then ASK AGAIN rather than assume.
  // Blindly failing open here would resume sending into what may still be a
  // live enforcement, and a stream of guaranteed-rejected sends is precisely
  // the automation signature the 401/403/440 handlers exist to avoid. So the
  // age-out triggers a refresh; we still fail open for now (a stuck gate is
  // its own outage) but the answer arrives within a round-trip.
  const learnedAt = reachoutTimelock.learnedAt ?? 0;
  if (Date.now() - learnedAt > TIMELOCK_NO_EXPIRY_MAX_AGE_MS) {
    refreshTimelockInBackground();
    return null;
  }
  return reachoutTimelock;
}

// One in-flight refresh at a time — activeTimelock() runs on every send, and
// a queue of duplicate queries would be its own automation signal.
let timelockRefreshInFlight = false;
function refreshTimelockInBackground() {
  if (timelockRefreshInFlight) return;
  if (!sock || typeof sock.fetchAccountReachoutTimelock !== 'function') return;
  timelockRefreshInFlight = true;
  sock.fetchAccountReachoutTimelock()
    .then((tl) => {
      rememberTimelock(tl);
      log('reachout timelock re-checked after age-out:', {
        isActive: !!tl?.isActive,
        endsAt: tl?.timeEnforcementEnds ?? null,
      });
    })
    .catch((e) => log('reachout timelock re-check failed:', e.message))
    .finally(() => { timelockRefreshInFlight = false; });
}

// Stamp when we learned a timelock state so activeTimelock() can age it out.
function rememberTimelock(tl) {
  reachoutTimelock = tl ? { ...tl, learnedAt: Date.now() } : null;
}

// Fatal exit for account-level kills detected mid-run (401/440/403 in the
// permanent close handler). Delayed rather than immediate: a send that
// already went through can be sitting in its 1.5s post-send settle when the
// close event fires — an immediate exit would kill the IPC connection before
// the ok:true reply flushes, so the skill would treat a DELIVERED message as
// a failure and cascade to another channel (double-contacting the business).
// 2.5s covers settle + reply write. Ops arriving during the grace window
// just die at exit, same as an immediate shutdown.
const FATAL_EXIT_DELAY_MS = 2500;
let fatalScheduled = false;
function fatalShutdown() {
  if (fatalScheduled) return;
  fatalScheduled = true;
  setTimeout(() => shutdown(1), FATAL_EXIT_DELAY_MS);
}

// 401 loggedOut means the server has invalidated these creds — every future
// dial is a guaranteed 401. Drop the sentinel that blocks all respawns (shim
// checks it before spawning; the startup guard above catches stragglers)
// until a successful `pair` clears it. NOT written for 403 (restricted):
// restrictions lift on their own and the creds stay valid, so gating those
// behind a mandatory re-pair would be wrong.
function writeAuthInvalidSentinel(detail) {
  try {
    fs.writeFileSync(
      AUTH_INVALID_SENTINEL,
      JSON.stringify({ reason: 'loggedOut', detail, at: new Date().toISOString() }) + '\n',
    );
  } catch (e) {
    log('failed to write auth-invalid sentinel:', e.message);
  }
}

// Signal Baileys readiness to op handlers. The IPC server starts accepting
// ops the moment the socket binds (a few hundred ms), but Baileys' handshake
// takes another 5-15s — we don't want sends arriving in that window to fail
// with "not connected". Handlers await `sock` via this emitter instead.
const sockEvents = new EventEmitter();
sockEvents.setMaxListeners(50);

function waitForSock(timeoutMs = 60_000) {
  if (sock) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onOpen = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      sockEvents.off('open', onOpen);
      reject(new Error(`Baileys did not connect within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    sockEvents.once('open', onOpen);
  });
}

async function connectBaileys() {
  if (reconnectInFlight) return;
  reconnectInFlight = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log('Baileys connect attempt', attempt);
      const s = makeWASocket({
        version,
        auth: state,
        // Standard desktop-browser tuple matching the HOST OS (Windows box
        // declares Windows, Mac declares Mac OS, Linux falls back to Ubuntu)
        // — an internally consistent fingerprint beats declaring macOS from a
        // Windows machine. The tuple's os string is wire-visible only in the
        // REGISTRATION payload at pair time. On LOGIN (already-paired
        // sessions) it feeds only getWebInfo, which resolves to WEB_BROWSER
        // whenever browser[1] !== 'Desktop' — so login payloads are
        // byte-identical across the old Klaudius tuple, macOS('Chrome'), and
        // every appropriate('Chrome') variant, and changing this line never
        // re-identifies an existing session. Careful if ever switching to a
        // 'Desktop' browser[1]: that + a mapped os DOES flip webSubPlatform
        // on login. Keep in lockstep with the pair call in scripts/whatsapp.mjs.
        browser: Browsers.appropriate('Chrome'),
        // History sync gives us recent days of activity for any thread the
        // linked device participates in. Captured to SQLite via the listeners
        // wired below.
        syncFullHistory: true,
        logger: silentLogger,
        markOnlineOnConnect: false,
      });
      s.ev.on('creds.update', saveCreds);
      s.ev.on('messages.upsert', ({ messages }) => {
        for (const m of messages || []) captureMessage(m, 'upsert');
      });
      s.ev.on('messaging-history.set', ({ messages }) => {
        for (const m of messages || []) captureMessage(m, 'history');
        log('history batch captured:', (messages || []).length);
      });
      // Delivery receipts. Without these, a soft-ban is invisible: sends keep
      // returning ok while WhatsApp quietly delivers nothing, so the operator
      // burns their whole lead list into a void. Recording the ladder lets
      // `standing` report a delivery rate.
      s.ev.on('messages.update', (updates) => {
        for (const u of updates || []) {
          const name = statusName(u?.update?.status);
          if (!name || !u?.key?.id) continue;
          try {
            if (name === 'ERROR') markMessageError.run(u.key.id);
            else updateMessageStatus.run(name, u.key.id, statusRank(name));
          } catch (e) {
            log('status update error:', e.message);
          }
        }
      });
      s.ev.on('message-capping.update', (info) => {
        lastCappingPush = info ?? null;
        // Loud in the log: FIRST_WARNING / SECOND_WARNING is WhatsApp telling
        // us this number is close to being capped for messaging new people.
        log('message-capping update from WhatsApp:', info ?? null);
      });

      const outcome = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ kind: 'timeout' }), CONNECT_TIMEOUT_MS);
        s.ev.on('connection.update', (update) => {
          const { connection, lastDisconnect } = update;
          if (connection === 'open') {
            clearTimeout(timer);
            resolve({ kind: 'open', sock: s });
          } else if (connection === 'close') {
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
        sock = outcome.sock;
        log('Baileys open, me=', sock.user?.id);
        sockEvents.emit('open');

        // Prime the timelock state so the very first send of a run is gated.
        // Fire-and-forget and fully fail-open: WhatsApp answers this for some
        // accounts and not others, and baileys throws on an unexpected shape.
        // An unsupported account must never end up unable to send.
        // Drop whatever we believed before reconnecting. Carrying stale state
        // across a reconnect is how a lifted lock keeps blocking sends: if the
        // refresh below then fails, the old object would survive unchallenged.
        // Unknown means unblocked.
        rememberTimelock(null);
        if (typeof sock.fetchAccountReachoutTimelock === 'function') {
          sock.fetchAccountReachoutTimelock()
            .then((tl) => {
              rememberTimelock(tl);
              if (activeTimelock()) {
                log('REACHOUT TIMELOCK ACTIVE on connect:', {
                  enforcementType: tl?.enforcementType ?? null,
                  endsAt: tl?.timeEnforcementEnds ?? null,
                });
              }
            })
            .catch((e) => log('reachout timelock query unavailable:', e.message));
        }

        // Permanent reconnect handler — fires whenever WhatsApp drops us later.
        sock.ev.on('connection.update', (update) => {
          // WhatsApp pushes timelock changes (imposed AND lifted) through the
          // same channel the query answers on, so this keeps the gate current
          // mid-run without polling.
          if (update.reachoutTimeLock !== undefined) {
            rememberTimelock(update.reachoutTimeLock);
            log('reachout timelock update:', {
              isActive: !!reachoutTimelock?.isActive,
              enforcementType: reachoutTimelock?.enforcementType ?? null,
              endsAt: reachoutTimelock?.timeEnforcementEnds ?? null,
            });
          }
          if (update.connection === 'close') {
            const code = update.lastDisconnect?.error?.output?.statusCode;
            log('connection lost, code=', code);
            sock = null;
            if (code === DisconnectReason.loggedOut) {
              // Account-level kill (banned, manually unlinked, etc). Per Crux 4
              // failure semantics: daemon exits, round-robin in the skill sees
              // this daemon dead and skips it, Telegram alert fires from the
              // skill side. Operator re-pairs via `klaudius pair-whatsapp
              // --label <account>` when ready.
              log('FATAL: logged out — re-pair required. Exiting.');
              writeAuthInvalidSentinel('401 on mid-run connection close');
              fatalShutdown();
              return;
            }
            if (code === DisconnectReason.connectionReplaced) {
              // Another client took over this auth session — WhatsApp Web
              // open in a browser, or a second daemon on another machine.
              // (NOT phone-side unlinking: tested 2026-07-30 against baileys
              // rc13, logging the device out from the phone's Linked Devices
              // list returns 401 loggedOut, not 440. An earlier version of
              // this comment claimed otherwise.) Reconnecting here would bump
              // THAT session, which bumps us back — an infinite
              // mutual-replacement loop of fresh handshakes that reads as
              // automation to WhatsApp and destabilises both sides. Exit
              // instead; the shim respawns the daemon on the next op,
              // bounding retakes to one per actual send.
              log('FATAL: connection replaced by another client (code 440) — WhatsApp Web open elsewhere, a second daemon on this auth, or the device was unlinked from the phone (Linked Devices). Not reconnecting; exiting. The shim respawns on the next op; if sends keep failing, re-pair.');
              fatalShutdown();
              return;
            }
            if (code === DisconnectReason.forbidden) {
              // 403: WhatsApp has restricted/banned the account. Hammering
              // reconnects at a restricted account only adds automation signal
              // while it's under review. Exit; sends will surface the failure
              // to the skill layer, which alerts + cascades channels.
              log('FATAL: forbidden (code 403) — account restricted or banned by WhatsApp. Reconnecting will not help; wait out the restriction (check the WhatsApp app on the phone) or re-pair later. Exiting.');
              fatalShutdown();
              return;
            }
            // Brief settle, then reconnect with saved auth. If reconnect
            // exhausts its internal retries (6 attempts), exit the daemon
            // entirely — the shim will respawn it on the next op. Better
            // than living with sock=null and every send timing out at 90s.
            setTimeout(() => {
              connectBaileys().catch((e) => {
                log('reconnect failed permanently after retries:', e.message, '— exiting daemon (shim will respawn on next op)');
                shutdown(1);
              });
            }, 1500);
          }
        });
        return;
      }

      try { s.end(undefined); } catch {}

      if (outcome.kind === 'timeout') throw new Error('connect timeout');
      if (outcome.code === DisconnectReason.loggedOut) {
        log('FATAL: logged out on initial connect. Re-pair required.');
        writeAuthInvalidSentinel('401 on initial connect');
        shutdown(1);
        return;
      }
      // Same terminal semantics as the permanent handler below: retrying a
      // replaced session steals it back (mutual-replacement loop), retrying a
      // restricted account adds automation signal. Exit instead of looping
      // through the remaining attempts.
      if (outcome.code === DisconnectReason.connectionReplaced) {
        log('FATAL: connection replaced on initial connect (code 440) — another client holds this session. Exiting.');
        shutdown(1);
        return;
      }
      if (outcome.code === DisconnectReason.forbidden) {
        log('FATAL: forbidden on initial connect (code 403) — account restricted or banned by WhatsApp. Exiting.');
        shutdown(1);
        return;
      }
      if (outcome.code === DisconnectReason.restartRequired) {
        try { await saveCreds(); } catch {}
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      log('close code:', outcome.code, outcome.message);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`failed to connect after ${maxAttempts} attempts (last code ${outcome.code})`);
    }
  } finally {
    reconnectInFlight = false;
  }
}

// ---- Op handlers ----

// Region-agnostic: callers should pass E.164 ("+12025550123", "+447xxx"); we
// only strip the leading '+' and any non-digits. No UK-specific 07xxx → 447xxx
// rewriting like website-factory has — klaudius's clients table normalises to
// E.164 upstream.
function normalizePhoneToJid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) throw new Error(`phone too short / not E.164: ${phone}`);
  // E.164 numbers never start with 0 — that's a national format. The most
  // common foot-gun is UK '07xxx' (should be '+447xxx'). Surface this as an
  // explicit error rather than silently cascading past WhatsApp (the
  // onWhatsApp lookup would return exists:false and the skill would treat
  // it as 'recipient not on WhatsApp', which is misleading).
  if (digits.startsWith('0')) {
    throw new Error(
      `phone "${phone}" looks like a national format (starts with 0). ` +
      `WhatsApp requires E.164 international format with country code, ` +
      `e.g. '+447xxx' for UK, '+1...' for US. Normalize at the clients-table layer.`,
    );
  }
  return `${digits}@s.whatsapp.net`;
}

// Serial mutex around Baileys sends — libsignal state and the 30s rate limit
// both demand single-flight semantics within this daemon. (Cross-daemon
// parallelism for multi-number happens at the shim layer via round-robin.)
let sendQueue = Promise.resolve();
function queueSend(fn) {
  const next = sendQueue.then(fn, fn);
  sendQueue = next.catch(() => {});
  return next;
}

async function handleSend({ to, body }) {
  if (!to) throw new Error('missing "to"');
  if (!body) throw new Error('missing "body"');
  await waitForSock(90_000);

  const jid = normalizePhoneToJid(to);

  // Refuse to send while WhatsApp has this number under a reachout timelock —
  // but only to contacts who have never messaged us. The timelock restricts
  // reaching OUT to people who haven't engaged; replying into a thread where
  // they spoke first is exactly what it still permits. Blanket-blocking would
  // silently strangle replies to the warmest leads we have (follow-up alerts
  // and skips the client without switching channel, so the lead just sits
  // unanswered), and that costs more than the alternative: at worst one
  // rejected send of a message type WhatsApp itself allows.
  //
  // This is a lookup, not a heuristic — the inbound row in our own SQLite IS
  // the fact. Account-level error, so the skill alerts and cascades rather
  // than silently dropping the client.
  const tl = activeTimelock();
  if (tl) {
    const digits = jid.split('@')[0];
    let engaged = false;
    try {
      engaged = !!hasInboundFromJid.get(jid, `${digits}:%@s.whatsapp.net`);
    } catch (e) {
      log('inbound-history check failed, treating as cold:', e.message);
    }
    if (!engaged) {
      const endsAt = tl.timeEnforcementEnds instanceof Date
        ? tl.timeEnforcementEnds.toISOString()
        : (tl.timeEnforcementEnds ?? null);
      log('BLOCKED by reachout timelock:', { to, endsAt, enforcementType: tl.enforcementType ?? null });
      return {
        ok: false,
        error: 'reachout_timelock_active',
        detail: `WhatsApp has restricted this number from messaging new contacts`
          + `${tl.enforcementType ? ` (${tl.enforcementType})` : ''}`
          + `${endsAt ? ` until ${endsAt}` : ''}. Not sending.`,
        timelock_ends: endsAt,
        to,
        account: ACCOUNT,
      };
    }
    log('reachout timelock active, but this contact has messaged us before — allowing the reply:', { to });
  }

  const elapsed = Date.now() / 1000 - lastSendAt;
  // Base gap + fresh random jitter per send (see SEND_JITTER_SECS above).
  const gapSecs = SEND_INTERVAL_SECS + Math.random() * SEND_JITTER_SECS;
  if (lastSendAt > 0 && elapsed < gapSecs) {
    const wait = Math.ceil(gapSecs - elapsed);
    log(`rate limit: waiting ${wait}s before send to ${to}`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }

  const lookup = await sock.onWhatsApp(jid);
  const exists = Array.isArray(lookup) && lookup[0]?.exists;
  if (!exists) {
    log('not_on_whatsapp:', to);
    return { ok: false, error: 'not_on_whatsapp', to, jid, account: ACCOUNT };
  }

  const sent = await sock.sendMessage(jid, { text: body });
  lastSendAt = Date.now() / 1000;
  log('sent', { id: sent?.key?.id, to, jid });

  // Let the server-side ack settle so messages.upsert can land in SQLite as
  // our own outgoing message before the next op runs.
  await new Promise((r) => setTimeout(r, 1500));

  return { ok: true, to, jid, account: ACCOUNT, message_id: sent?.key?.id ?? null };
}

// Registry-only reachability probe: is this number on WhatsApp at all?
// handleSend runs the same lookup as a pre-flight, but reaching it there
// means attempting a send — so on WhatsApp-primary installs "is this lead
// reachable" couldn't be asked until a site was already built. This op
// lets /find screen a candidate BEFORE a build is spent.
//
// NOT routed through queueSend and never touches lastSendAt: nothing is
// sent, so it must not eat the send-pacing budget. It still paces itself
// (own queue, jittered gap) — bulk existence lookups are contact
// enumeration, a known automation signal. Callers probe single candidates
// at claim time, never whole pools.
let checkQueue = Promise.resolve();
let lastNumberCheckAt = 0;
function queueNumberCheck(fn) {
  const next = checkQueue.then(fn, fn);
  checkQueue = next.catch(() => {});
  return next;
}

async function handleCheckNumber({ phone }) {
  if (!phone) throw new Error('missing "phone"');
  await waitForSock(90_000);
  const jid = normalizePhoneToJid(phone);

  const elapsedMs = Date.now() - lastNumberCheckAt;
  const gapMs = 2000 + Math.random() * 3000;
  if (lastNumberCheckAt > 0 && elapsedMs < gapMs) {
    await new Promise((r) => setTimeout(r, gapMs - elapsedMs));
  }

  const lookup = await sock.onWhatsApp(jid);
  lastNumberCheckAt = Date.now();
  const exists = Array.isArray(lookup) && lookup[0]?.exists;
  return { ok: true, phone, jid, on_whatsapp: !!exists, account: ACCOUNT };
}

async function handleRead({ phone, limit = 30 }) {
  if (!phone) throw new Error('missing "phone"');
  const jid = normalizePhoneToJid(phone);
  const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 30));

  // Wait for Baileys so signalRepository is available for the LID lookup
  // below. Without it, reads degrade silently to phone-only matching, which
  // misses messages stored under @lid and produces incomplete threads (which
  // in turn cause spurious follow-ups).
  await waitForSock(90_000);

  // Drop empty-body entries — reactions, key-distribution messages,
  // history-sync metadata. Operator wants the conversation, not the protocol
  // bookkeeping.
  //
  // Match jid four ways:
  //   1. phone@s.whatsapp.net      canonical PN form
  //   2. phone:N@s.whatsapp.net    PN with multi-device "device suffix" quirk
  //   3. <lidUser>@lid             LID form (WhatsApp's privacy-focused
  //                                addressing — a single thread can split
  //                                across PN+LID forms; see Baileys #1832)
  //   4. <lidUser>:N@lid           LID + device suffix
  //
  // The LID lookup hits Baileys' signalRepository (in-memory → on-disk →
  // USync), returning null for never-interacted contacts; we degrade to
  // phone-only matching in that case.
  const phoneDigits = jid.split('@')[0];
  const wherePieces = ['jid = ?', 'jid LIKE ?'];
  const params = [jid, `${phoneDigits}:%@s.whatsapp.net`];

  if (sock?.signalRepository?.lidMapping) {
    try {
      const lidJid = await sock.signalRepository.lidMapping.getLIDForPN(jid);
      if (lidJid) {
        const lidUser = lidJid.split('@')[0].split(':')[0];
        wherePieces.push('jid = ?', 'jid LIKE ?');
        params.push(`${lidUser}@lid`, `${lidUser}:%@lid`);
      }
    } catch (e) {
      log(`getLIDForPN failed for ${phone}: ${e.message}`);
    }
  }

  // GROUP BY message_id: the same message can be stored under BOTH its PN jid
  // and its LID jid (live capture via messages.upsert vs history resync via
  // messaging-history.set) — the PK is (jid, message_id), so INSERT OR IGNORE
  // doesn't collapse the pair. Without this dedup a single outreach send can
  // read back as two outgoing touches, which advances the follow-up cadence a
  // step and skips the soft nudge. Within one thread's jid forms an equal
  // message_id IS the same message (from_me/body/timestamp identical), so any
  // row per group is valid (SQLite serves the bare columns from an arbitrary
  // row of the group; MIN() pins jid/timestamp only). Dedup must happen
  // before LIMIT or duplicates also eat into the row budget.
  const rows = db
    .prepare(
      `SELECT message_id, MIN(jid) AS jid, from_me, MIN(timestamp) AS timestamp, body, message_type
       FROM messages
       WHERE (${wherePieces.join(' OR ')})
         AND body IS NOT NULL AND body != ''
       GROUP BY message_id
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(...params, lim);
  const messages = rows
    .reverse()
    .map((r) => ({
      date: r.timestamp ? new Date(r.timestamp * 1000).toISOString() : null,
      from_me: !!r.from_me,
      text: r.body || '',
      type: r.message_type,
      jid_actual: r.jid,
    }));
  return { ok: true, phone, jid, account: ACCOUNT, messages };
}

// Ask WhatsApp how this account is standing: its new-chat message quota
// (WhatsApp meters how many people you may message for the FIRST time in a
// cycle, and warns twice before capping) and whether a reachout timelock is
// in force (during one it blocks outgoing messages to non-contacts).
//
// This deliberately runs INSIDE the daemon rather than in a standalone
// script. A separate process would have to connect with the same credentials
// — i.e. as the same linked device — and WhatsApp keeps ONE delivery queue
// per device: Baileys acks every inbound message node it receives, so a
// second short-lived client silently drains messages the daemon would
// otherwise capture, losing client replies. (Copying the auth directory does
// NOT avoid this; the device identity, not the directory, is what the server
// queues against.) It would also mutate auth state on disk, since
// useMultiFileAuthState's keys.set writes immediately and Baileys writes keys
// on the login path. Running here costs no extra connection and captures
// messages normally.
//
// Both queries fail OPEN: WhatsApp answers them for some accounts and not
// others, and baileys' executeWMexQuery THROWS on an unexpected shape, so an
// unsupported account must degrade to "unknown", never take the daemon down.
async function handleStanding() {
  await waitForSock(90_000);
  // waitForSock resolves instantly when `sock` is already set, and the close
  // handler nulls it — so the connection can drop between the await and the
  // queries. Without this, `typeof sock.fetch...` throws a TypeError that
  // reaches the operator as a cryptic "Cannot read properties of null".
  if (!sock) throw new Error('WhatsApp connection dropped before the account-standing queries could run; retry in a moment.');

  const out = {
    ok: true,
    account: ACCOUNT,
    checked_at: new Date().toISOString(),
    pairing: pairingAge(),
    new_chat_message_cap: null,
    reachout_timelock: null,
    pushed_capping_update: lastCappingPush,
    delivery: deliveryStats(),
  };

  // Keep only the message and a status code. The raw Boom `data` is the
  // binary IQ node, whose attrs carry this account's own phone number — and
  // this output is meant to be shareable for support.
  const describeErr = (e) => ({
    message: e?.message ?? String(e),
    status_code: e?.output?.statusCode ?? e?.data?.extensions?.error_code ?? null,
  });

  // Bound each query well under the shim's op timeout. Baileys' own query
  // timeout is 60s each, so two slow queries plus a cold waitForSock could
  // outlast the shim, which would then report "standing timed out" and throw
  // away results the daemon did get. A per-query cap means one unresponsive
  // query degrades to an error entry beside the other's real answer.
  const QUERY_TIMEOUT_MS = 20_000;
  const bounded = (p, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${QUERY_TIMEOUT_MS / 1000}s`)), QUERY_TIMEOUT_MS)),
  ]);

  if (typeof sock.fetchNewChatMessageCap !== 'function') {
    out.new_chat_message_cap = { supported: false };
  } else {
    try {
      out.new_chat_message_cap = {
        supported: true,
        result: (await bounded(sock.fetchNewChatMessageCap(), 'fetchNewChatMessageCap')) ?? null,
      };
    } catch (e) {
      out.new_chat_message_cap = { supported: true, error: describeErr(e) };
    }
  }
  // capping_status NONE sitting next to total_quota 0 reads like headroom,
  // but when BOTH eligibility fields say NOT_ELIGIBLE the whole result is
  // placeholders (the account isn't enrolled in metering — verified on two
  // real accounts, 2026-07/08, including a high-volume post-restriction one).
  // Annotate rather than suppress: this output is a raw API passthrough that
  // people debug against, so hiding fields would be worse than explaining them.
  const capResult = out.new_chat_message_cap?.result;
  if (capResult?.mv_status === 'NOT_ELIGIBLE' && capResult?.ote_status === 'NOT_ELIGIBLE') {
    out.new_chat_message_cap.note =
      'This number is not enrolled in WhatsApp\'s new-chat metering programme: ' +
      'capping_status and total_quota are placeholders, not headroom. ' +
      'total_quota 0 does NOT mean "send zero".';
  }

  if (typeof sock.fetchAccountReachoutTimelock !== 'function') {
    out.reachout_timelock = { supported: false };
  } else {
    try {
      const tl = await bounded(sock.fetchAccountReachoutTimelock(), 'fetchAccountReachoutTimelock');
      out.reachout_timelock = {
        supported: true,
        result: tl
          ? {
              isActive: !!tl.isActive,
              timeEnforcementEnds: tl.timeEnforcementEnds instanceof Date
                ? tl.timeEnforcementEnds.toISOString()
                : (tl.timeEnforcementEnds ?? null),
              enforcementType: tl.enforcementType ?? null,
            }
          : null,
      };
    } catch (e) {
      out.reachout_timelock = { supported: true, error: describeErr(e) };
    }
  }

  return out;
}

// Delivery health over the last 7 days of outgoing messages. A number being
// soft-banned keeps accepting sends while WhatsApp quietly stops delivering
// them, so a delivery rate that falls off a cliff is the earliest warning
// available — earlier than any restriction notice. Messages sent in the last
// few minutes are excluded: receipts lag, and counting them as undelivered
// would make a healthy account look broken.
function deliveryStats() {
  try {
    // GROUP BY message_id first: the same outgoing message can be stored under
    // BOTH its PN jid and its LID jid (the split that made one send read back
    // as two touches — see handleRead). Counting rows would inflate every
    // figure up to 2x and make the `sent >= 10` sample floor fire at 5 real
    // sends, reintroducing the tiny-denominator problem that floor exists to
    // prevent. MAX(status) picks the furthest-advanced value, which is right
    // because the receipt update writes the same status to every row sharing
    // the id.
    //
    // NULL status means "no receipt data for this row", NOT "undelivered":
    // every message sent before the status column existed is NULL. Counting
    // those as failures makes an EXISTING install report a ~7% delivery rate
    // on a perfectly healthy number for a week after upgrading, firing the
    // soft-ban warning falsely and teaching the operator to ignore it.
    //
    // SERVER_ACK counts as UNCONFIRMED, not delivered — "the server took it
    // but no device ever acknowledged it" is the defining shape of a soft
    // ban, so it must land in the bucket the warning is built on.
    // Aggregate on the ladder RANK, not the status string: MAX() over text
    // sorts alphabetically, which would rank SERVER_ACK above DELIVERY_ACK
    // and quietly turn undelivered messages into delivered ones.
    // Ranks: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
    // Count only real outbound messages. The pairing handshake writes
    // protocolMessage / unknown-type rows to our OWN jid with SERVER_ACK;
    // those never resolve past rank 2, so a fresh re-pair starts 7 phantom
    // "unconfirmed sends" into the sent>=10 gate below — three perfect real
    // sends then compute as 3/10 = 30% and trip the soft-ban warning at
    // exactly the moment the operator is ramping a re-paired number (field
    // report, 2026-08-03). The non-empty-body filter mirrors handleRead's drop of
    // bodyless protocol traffic (reactions, key distribution, history-sync
    // metadata) and covers such noise sent to RECIPIENT jids too; the
    // self-jid exclusion is belt-and-braces. Known trade-off: a captionless
    // media send is excluded from the stats — undercounting beats a false
    // soft-ban alarm. Empty ownDigits (sock gone) makes the jid params match
    // nothing, so the filter fails open to the body check alone.
    const ownDigits = (sock?.user?.id || '').split(/[:@]/)[0];
    const row = db.prepare(`
      SELECT
        COUNT(*) AS sent,
        SUM(CASE WHEN r >= 3 THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN r >= 4 THEN 1 ELSE 0 END) AS read_count,
        SUM(CASE WHEN r BETWEEN 0 AND 2 THEN 1 ELSE 0 END) AS unconfirmed
      FROM (
        SELECT message_id, MAX(status_rank(status)) AS r
        FROM messages
        WHERE from_me = 1
          AND timestamp > strftime('%s','now','-7 days')
          AND timestamp < strftime('%s','now','-5 minutes')
          AND status IS NOT NULL
          AND body IS NOT NULL AND body != ''
          AND jid != ? AND jid NOT LIKE ?
        GROUP BY message_id
      )
      WHERE r >= 0
    `).get(`${ownDigits}@s.whatsapp.net`, `${ownDigits}:%@s.whatsapp.net`);
    const sent = row?.sent ?? 0;
    return {
      window_days: 7,
      sent,
      delivered: row?.delivered ?? 0,
      read: row?.read_count ?? 0,
      unconfirmed: row?.unconfirmed ?? 0,
      // Null rather than 0 on a tiny sample — one undelivered message out of
      // three is noise, and a scary-looking 33% would train operators to
      // ignore this number.
      delivery_rate: sent >= 10 ? Number(((row.delivered ?? 0) / sent).toFixed(3)) : null,
    };
  } catch (e) {
    log('delivery stats error:', e.message);
    return null;
  }
}

// How long ago THIS device was linked. Session age looks more relevant to
// send limits than account age (how long the number has had WhatsApp): a
// freshly linked session should be ramped like a new number even on a
// years-old number. creds.json is rewritten constantly by saveCreds, so its
// mtime is meaningless — birthtime is the pairing moment. Some Linux
// filesystems can't report a real birthtime and fall back to ctime, which
// saveCreds does touch, so the result is flagged rather than trusted.
function pairingAge() {
  try {
    const st = fs.statSync(path.join(AUTH_DIR, 'creds.json'));
    const born = st.birthtimeMs > 0 ? st.birthtimeMs : null;
    if (!born) return null;
    return {
      paired_at: new Date(born).toISOString(),
      age_days: Math.floor((Date.now() - born) / 86_400_000),
      // ctime fallback inflates nothing but can UNDER-report age, so a small
      // number here may mean "recently written", not "recently paired".
      trustworthy: st.birthtimeMs !== st.ctimeMs,
    };
  } catch {
    return null;
  }
}

function handleStatus() {
  const total = db.prepare('SELECT COUNT(*) as n FROM messages').get().n;
  const recent = db
    .prepare("SELECT COUNT(*) as n FROM messages WHERE captured_at > strftime('%s','now','-1 day')")
    .get().n;
  return {
    ok: true,
    account: ACCOUNT,
    pid: process.pid,
    uptime_seconds: Math.floor(process.uptime()),
    me: sock?.user?.id ?? null,
    baileys_connected: !!sock,
    messages_total: total,
    messages_last_24h: recent,
  };
}

// ---- IPC server ----
function dispatch(req) {
  switch (req?.op) {
    case 'send': return queueSend(() => handleSend(req));
    case 'check_number': return queueNumberCheck(() => handleCheckNumber(req));
    case 'read': return Promise.resolve(handleRead(req));
    case 'check':
    case 'status': return Promise.resolve(handleStatus());
    case 'standing': return handleStanding();
    case 'shutdown': {
      setTimeout(() => shutdown(0), 100);
      return Promise.resolve({ ok: true, shutting_down: true });
    }
    default: return Promise.resolve({ ok: false, error: `unknown op: ${req?.op}` });
  }
}

const server = net.createServer((conn) => {
  let buf = '';
  conn.on('data', async (chunk) => {
    buf += chunk.toString('utf8');
    const idx = buf.indexOf('\n');
    if (idx < 0) return;
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);

    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      conn.write(JSON.stringify({ ok: false, error: 'invalid json: ' + e.message }) + '\n');
      conn.end();
      return;
    }
    try {
      const result = await dispatch(req);
      conn.write(JSON.stringify({ id: req.id, ...result }) + '\n');
    } catch (e) {
      log('op error:', e.message);
      conn.write(JSON.stringify({ id: req.id, ok: false, error: e.message }) + '\n');
    }
    conn.end();
  });
  conn.on('error', (e) => log('conn error:', e.message));
});

// Best-effort cleanup of a stale Unix socket file from a previous crashed
// daemon. No-op on Windows: named pipes have no filesystem entry and the OS
// reclaims them when the owning process exits, so there's nothing to unlink.
//
// This unconditional unlink is structurally required (bind() fails EADDRINUSE
// on an orphaned socket FILE just as on a live one), and it is why, on Unix,
// the PID FILE is the only mutual exclusion between daemons: a second daemon
// reaching this line would silently steal a LIVE daemon's endpoint and then
// dial WhatsApp — two connections on one auth, the 440 mutual-replacement
// storm. On Windows the bind itself backstops us: libuv sets
// FILE_FLAG_FIRST_PIPE_INSTANCE, so a second daemon takes EADDRINUSE (handled
// just below) and exits ~200ms in — it does initiate a Baileys dial, but is
// aborted well before the login that a connectionReplaced kick requires.
//
// If anyone revisits this properly: the right mechanism is an OS-mediated
// advisory lock held for the daemon's lifetime, released by the kernel on ANY
// death — no staleness semantics at all. Not a pure-JS lock package (the
// mkdir/lockfile schemes reintroduce exactly the staleness this would exist
// to escape) and not socket-bind-as-mutex (defeated on Unix by this very
// unlink). better-sqlite3, which we already ship, IS a real lock provider: a
// dedicated lock db held open with BEGIN EXCLUSIVE locks via POSIX locks /
// LockFileEx (leave it on the default rollback journal — WAL wouldn't break
// writer exclusion, but a lock db has no reason for it). SQLite's unix VFS
// already works around the POSIX close-drops-locks footgun for its own
// handles; just never open the lock file with plain `fs` from inside the
// daemon process.
if (process.platform !== 'win32') {
  try { fs.unlinkSync(IPC_ENDPOINT); } catch {}
}
// A listen-time failure (EADDRINUSE from a stale endpoint, or a pipe-name
// collision during a fast Windows respawn) would otherwise throw uncaught and
// kill the daemon without cleanup, orphaning the pid file. Handle it: log and
// exit cleanly so the startup guard / shim respawn recovers on the next op.
// (`shutdown` is a hoisted function declaration below.)
server.on('error', (e) => {
  log('IPC server error:', e.message);
  shutdown(1);
});
server.listen(IPC_ENDPOINT, () => {
  log('listening on', IPC_ENDPOINT);
});

// ---- shutdown ----
function shutdown(code) {
  log('shutting down with code', code);
  try { sock?.end(undefined); } catch {}
  try { server.close(); } catch {}
  // Unix socket file needs explicit removal; on Windows server.close() releases
  // the named pipe and there's no file to unlink.
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(IPC_ENDPOINT); } catch {}
  }
  try { fs.unlinkSync(PID_PATH); } catch {}
  try { logStream.end(); } catch {}
  setTimeout(() => process.exit(code), 200);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ---- start ----
connectBaileys().catch((e) => {
  log('initial Baileys connect failed:', e.message);
  shutdown(1);
});
