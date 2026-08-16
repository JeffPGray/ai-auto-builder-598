#!/usr/bin/env node
/**
 * takedown-unclaimed.mjs [--days 60] [--dry-run] [--slug <one>]
 *
 * Removes demo tenants that were never claimed, after a fixed window.
 *
 * WHY THIS EXISTS — and it is not primarily housekeeping.
 *
 * The 60-day outreach sequence's two strongest steps say, in writing, to a real local business
 * owner: "the site comes down on {{Date}}, we recycle the subdomain when a build sits unclaimed."
 * Until this file existed, nothing in either repo destroyed anything. That made the deadline
 * FABRICATED URGENCY sent from a real company to someone who talks to other local business owners.
 * A sales council flagged it as the single line most likely to cost reputation at street level.
 *
 * So the choice was: build the mechanism, or cut the sequence to 7 steps and lose its best close.
 * This is the mechanism. The deadline is now true.
 *
 * It also happens to solve tenant accumulation: every prospect who never replies otherwise occupies
 * lane storage and a previews rebuild, forever, at 50-100 builds/day.
 *
 * ⛔ SAFETY — this deletes a live, client-facing website. Every guard below is deliberate:
 *   - A tenant is only eligible if the client is NOT converted and NOT in a won stage.
 *   - A tenant is only eligible if outreach ACTUALLY WENT OUT. Never take down a build the owner
 *     was never told about — that is not an expired offer, it is an unfinished job.
 *   - A tenant that has ever had an inbound reply is NEVER eligible, whatever the date says.
 *   - The source is archived first, so a takedown is recoverable.
 *   - --dry-run is the default posture in the deploy skill; the destructive path must be asked for.
 */
import { existsSync, readdirSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const oneSlug = (() => { const i = args.indexOf('--slug'); return i === -1 ? null : args[i + 1]; })();
const DAYS = Number((() => { const i = args.indexOf('--days'); return i === -1 ? 60 : args[i + 1]; })());

const APP = process.cwd();
const LANE = process.env.SHARED_LANE_DIR || `${process.env.HOME}/Github/gr-no-website-builds-lane`;
const ARCHIVE = process.env.ARCHIVE_DIR || `${process.env.HOME}/Github/klaudius/archive`;

const PY = [`${process.env.HOME}/.local/bin/python3`, 'python3'].find((p) => {
  try { execFileSync(p, ['-c', 'import supabase'], { stdio: 'ignore' }); return true; } catch { return false; }
});

function row(slug) {
  if (!PY) return null;
  try {
    const out = execFileSync(PY, ['scripts/db.py', 'client', slug], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const i = out.indexOf('{');
    return i === -1 ? null : JSON.parse(out.slice(i));
  } catch { return null; }
}

/* NEVER take down a build whose owner was never contacted. The sequence's promise is about an
 * unclaimed OFFER expiring; a build nobody was told about is simply unfinished work, and deleting it
 * destroys value for no reason. */
const CONVERTED = new Set(['converted', 'responded']);
const eligible = (r) => {
  if (!r) return { ok: false, why: 'no Supabase row' };
  if (CONVERTED.has(String(r.status || '').toLowerCase())) return { ok: false, why: `status=${r.status}` };
  if (!r.outreach_first_sent) return { ok: false, why: 'outreach never sent — not an expired offer' };
  if (r.last_in_date) return { ok: false, why: 'has an inbound reply' };
  const sent = new Date(r.outreach_first_sent);
  const age = Math.floor((Date.now() - sent.getTime()) / 86_400_000);
  if (age < DAYS) return { ok: false, why: `only ${age}d since first outreach (needs ${DAYS})` };
  return { ok: true, age };
};

const laneSrc = join(LANE, 'apps/previews/src/klaudius');
const lanePub = join(LANE, 'apps/previews/public/klaudius');
const slugs = oneSlug ? [oneSlug]
  : (existsSync(laneSrc) ? readdirSync(laneSrc).filter((d) => statSync(join(laneSrc, d)).isDirectory()) : []);

let removed = 0, kept = 0;
for (const slug of slugs) {
  const r = row(slug);
  const e = eligible(r);
  if (!e.ok) { console.log(`  KEEP   ${slug.padEnd(28)} ${e.why}`); kept++; continue; }

  console.log(`  REMOVE ${slug.padEnd(28)} ${e.age}d since outreach, no reply, not converted`);
  if (DRY) { removed++; continue; }

  // Archive the source first — a takedown must be recoverable.
  const clientDir = join(APP, 'clients', slug);
  if (existsSync(clientDir)) {
    mkdirSync(ARCHIVE, { recursive: true });
    try { execFileSync('tar', ['-czf', join(ARCHIVE, `${slug}-takedown.tgz`), '-C', join(APP, 'clients'), slug]); }
    catch { console.log(`         (archive failed for ${slug}; skipping removal)`); continue; }
  }
  for (const d of [join(laneSrc, slug), join(lanePub, slug)]) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
  if (PY) {
    try { execFileSync(PY, ['-c',
      `import sys;sys.path.insert(0,'scripts');from db import update_status;update_status('${slug}','lapsed')`],
      { stdio: 'ignore' }); } catch { /* status is bookkeeping; the removal already happened */ }
  }
  removed++;
}

console.log(`\n  ${DRY ? 'WOULD REMOVE' : 'REMOVED'} ${removed}, kept ${kept}`);
if (!DRY && removed) {
  console.log('  ⚠️  The lane still serves the OLD deployment until it is rebuilt and redeployed:');
  console.log('      bash scripts/publish-and-serve.sh <any-remaining-slug> "<name>"   # rebuilds + redeploys the lane');
  console.log('  Until that runs, the takedown has not actually happened from a visitor\'s point of view.');
}
