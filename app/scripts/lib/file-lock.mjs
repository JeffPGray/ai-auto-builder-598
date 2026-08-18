/**
 * file-lock.mjs — mkdir-based mutual exclusion for shared JSON ledgers.
 *
 * WHY THIS EXISTS: five scripts (design-ledger.mjs, font-uniqueness-check.mjs,
 * copy-fingerprint-check.mjs, hyperui-usage-check.mjs, hyperui-transplant-check.mjs) each do an
 * unlocked read-modify-write on data/design-fingerprints.json. Single-lane tonight this never
 * mattered; the moment two dispatch-build.sh runs go concurrent (WATCH_DIR already supports this),
 * two QA batteries can race the same file and silently drop each other's record — and since the
 * uniqueness/fingerprint gates READ that ledger to catch fleet-sameness, a lost write weakens
 * detection invisibly rather than loudly. Flagged by Fable's caching/compartmentalization review,
 * 2026-08-18.
 *
 * `mkdir` is atomic on every filesystem this runs on (POSIX guarantee) — the standard, dependency-
 * free way to implement a lock without a real lock manager. A stale lock (a crashed holder) is
 * reclaimed after STALE_MS so a dead process can never wedge the ledger shut.
 *
 * Usage:
 *   import { withFileLock } from './lib/file-lock.mjs';
 *   await withFileLock('/abs/path/to/data/design-fingerprints.json', () => {
 *     const ledger = JSON.parse(readFileSync(...));
 *     ledger.push(...);
 *     writeFileSync(..., JSON.stringify(ledger, null, 2));
 *   });
 */
import { mkdirSync, rmdirSync, statSync } from 'node:fs';

const STALE_MS = 30_000; // a lock older than this is assumed abandoned by a crashed process
const POLL_MS = 100;
const MAX_WAIT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockDirFor(targetPath) {
  return `${targetPath}.lock`;
}

async function acquire(targetPath) {
  const lockDir = lockDirFor(targetPath);
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      return lockDir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const age = Date.now() - statSync(lockDir).mtimeMs;
        if (age > STALE_MS) {
          // Stale — a prior holder crashed without cleaning up. Reclaim it.
          rmdirSync(lockDir);
          continue;
        }
      } catch {
        // Lock dir vanished between the failed mkdir and this stat — someone else released it.
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`file-lock: timed out waiting for ${lockDir} after ${MAX_WAIT_MS}ms — a concurrent run is holding it far longer than expected`);
      }
      await sleep(POLL_MS);
    }
  }
}

/**
 * Run fn() while holding an exclusive lock on targetPath. fn() may be sync or async; its return
 * value is passed through. The lock is always released, even if fn() throws.
 */
export async function withFileLock(targetPath, fn) {
  const lockDir = await acquire(targetPath);
  try {
    return await fn();
  } finally {
    try { rmdirSync(lockDir); } catch { /* already gone — fine */ }
  }
}
