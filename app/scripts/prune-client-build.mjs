#!/usr/bin/env node
/**
 * prune-client-build.mjs [slug|--all] [--dry-run] [--force]
 *
 * Reclaims the ~93% of a client folder that is regenerable, AFTER the site is safely deployed.
 *
 * WHY THIS EXISTS — measured 2026-08-16, not estimated:
 *
 *   per client   ~530 MB total
 *                ~460 MB site/node_modules   (npm install regenerates)
 *                ~50-130 MB site/.next       (npx next build regenerates)
 *                ~15 MB   site source + data/ + screenshots/   <- the only irreplaceable part
 *
 * At the 50-builds/day target that is 26.5 GB/day against 118 GB free: the disk fills in under
 * five days. Pruned, the same 50 builds cost ~750 MB/day. This is the difference between the
 * throughput target being sustainable and it wedging the machine mid-week.
 *
 * WHY IT IS SAFE: the artefact that matters is already on Vercel. node_modules and .next are
 * build inputs/outputs, never sources. `/cms` on conversion re-installs deps anyway, and /build's
 * retrofit guard keys on data/cms.md — which this never touches.
 *
 * THE GUARD THAT MATTERS: a client is only prunable once it is genuinely deployed. Pruning a
 * client mid-build would destroy a running pipeline's node_modules under it, which is exactly the
 * kind of silent, hard-to-attribute failure this project has spent a night chasing. So:
 *
 *   1. Supabase status must be deployed/outreach_sent/responded/converted, AND
 *   2. deployed_url must be non-empty, AND
 *   3. nothing may have written into the folder in the last 10 minutes (a live build touches it
 *      constantly; this catches a client whose DB row raced ahead of its filesystem).
 *
 * All three, not any. --force skips 1 and 2 but NEVER skips 3 — freshness is the one check that
 * protects a running build, and a flag that could disable it would eventually be used to.
 */
import { existsSync, statSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
// `--all` is a target, not a modifier — it looks like a flag, so it must be matched explicitly
// or the plain "not a flag" test silently drops it and every invocation prints usage.
const ARCHIVE = args.includes('--archive');
// Default lives OUTSIDE clients/ so an archive is never re-scanned as a client, and outside the
// repo so `git status` stays clean. Override with ARCHIVE_DIR to point at a cloud-sync folder.
const ARCHIVE_DIR = process.env.ARCHIVE_DIR || `${process.env.HOME}/Github/klaudius/archive`;
const target = args.includes('--all') ? '--all' : args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('usage: prune-client-build.mjs <slug|--all> [--dry-run] [--force] [--archive]');
  process.exit(1);
}

const CLIENTS = 'clients';
// `.vercel/output` is the built deploy artefact — regenerable, and already living on Vercel, which
// is the copy that actually serves. Keeping it locally archives a build twice.
const PRUNABLE = ['site/node_modules', 'site/.next', 'site/out', 'site/.vercel/output'];
const DEPLOYED = new Set(['deployed', 'outreach_sent', 'responded', 'converted', 'rejected', 'lapsed']);
const MIN_IDLE_MS = 10 * 60 * 1000;

/** Newest mtime anywhere under dir, excluding the prunable trees (npm/next touch those constantly
 *  even when the pipeline is idle, which would make every client look permanently "live"). */
function newestMtime(dir, depth = 0) {
  let newest = 0;
  if (depth > 6) return newest;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return newest; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === 'out') continue;
    const p = join(dir, e.name);
    try {
      // FILES ONLY. A directory's mtime changes whenever a child is added or removed — including
      // by this script's own rmSync — so counting directories makes a client look "live" for
      // MIN_IDLE_MS immediately after it is pruned, and a prune-then-archive in the same minute
      // silently no-ops. A running build writes FILES; that is the signal worth trusting.
      if (e.isDirectory()) { newest = Math.max(newest, newestMtime(p, depth + 1)); continue; }
      const st = statSync(p);
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch { /* vanished mid-walk; ignore */ }
  }
  return newest;
}

/* Bare `python3` resolves to macOS's system 3.9.6, which has no `supabase` module — so every
 * lookup fails and every client reads as "no Supabase row", i.e. the guard fails CLOSED into
 * never pruning anything. Silent, and it looks like a working safety check. uv's 3.12 lives in
 * ~/.local/bin and is what the rest of the pipeline uses (see app/.claude/settings.json's PATH
 * override). Prefer it, fall back to PATH. */
const PY = [`${process.env.HOME}/.local/bin/python3`, 'python3'].find((p) => {
  try { execFileSync(p, ['-c', 'import supabase'], { stdio: 'ignore' }); return true; } catch { return false; }
});

function dbRow(slug) {
  if (!PY) return null;
  try {
    const out = execFileSync(PY, ['scripts/db.py', 'client', slug], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const i = out.indexOf('{');
    return i === -1 ? null : JSON.parse(out.slice(i));
  } catch { return null; }
}

function sizeMB(p) {
  try {
    return Math.round(Number(execFileSync('du', ['-sk', p], { encoding: 'utf8' }).split('\t')[0]) / 1024);
  } catch { return 0; }
}

const slugs = target === '--all'
  ? readdirSync(CLIENTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [target];

let freed = 0, pruned = 0, skipped = 0;

for (const slug of slugs) {
  const dir = join(CLIENTS, slug);
  if (!existsSync(dir)) { console.log(`  ${slug}: no such client`); skipped++; continue; }

  // Freshness first — it is the check that protects a RUNNING build, so it runs before the
  // cheap-to-satisfy ones and is never skippable.
  const idleMs = Date.now() - newestMtime(dir);
  if (idleMs < MIN_IDLE_MS) {
    console.log(`  ${slug}: SKIP — touched ${Math.round(idleMs / 1000)}s ago (build may be live)`);
    skipped++; continue;
  }

  if (!FORCE) {
    const row = dbRow(slug);
    if (!row) { console.log(`  ${slug}: SKIP — no Supabase row (use --force if intentional)`); skipped++; continue; }
    if (!DEPLOYED.has(row.status)) { console.log(`  ${slug}: SKIP — status '${row.status}', not deployed`); skipped++; continue; }
    if (!row.deployed_url) { console.log(`  ${slug}: SKIP — status '${row.status}' but deployed_url empty`); skipped++; continue; }
  }

  let clientFreed = 0;
  for (const rel of PRUNABLE) {
    const p = join(dir, rel);
    if (!existsSync(p)) continue;
    const mb = sizeMB(p);
    clientFreed += mb;
    if (!DRY) rmSync(p, { recursive: true, force: true });
  }

  // --archive: tar the LEAN client and drop the working folder entirely. Measured 2026-08-16:
  // 530 MB raw -> ~20 MB pruned -> 9.6 MB archived, a 55x reduction. At 50 builds/day that is
  // 480 MB/day instead of 26.5 GB/day, which is the difference between ~8 months of headroom on
  // the current disk and filling it by Thursday.
  //
  // ARCHIVE_DIR may point anywhere, including a cloud-sync folder — tarballs are few and small,
  // so they sync fine. NEVER relocate the working `clients/` tree itself onto a sync folder:
  // node_modules is hundreds of thousands of tiny files and the sync daemon will thrash against
  // every install.
  if (ARCHIVE && clientFreed >= 0) {
    const tgz = join(ARCHIVE_DIR, `${slug}.tgz`);
    if (!DRY) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      execFileSync('tar', ['-czf', tgz, '-C', CLIENTS, slug]);
      rmSync(dir, { recursive: true, force: true });
    }
    const amb = DRY ? '?' : sizeMB(tgz);
    console.log(`  ${slug}: ${DRY ? 'would free' : 'freed'} ${clientFreed} MB, archived -> ${tgz} (${amb} MB)`);
    freed += clientFreed; pruned++;
    continue;
  }

  if (clientFreed === 0) { console.log(`  ${slug}: already lean`); continue; }
  console.log(`  ${slug}: ${DRY ? 'would free' : 'freed'} ${clientFreed} MB`);
  freed += clientFreed; pruned++;
}

console.log(`\n  ${DRY ? 'WOULD FREE' : 'FREED'} ${freed} MB across ${pruned} client(s); ${skipped} skipped`);
console.log('  Restore any pruned client with: cd clients/<slug>/site && npm install');
