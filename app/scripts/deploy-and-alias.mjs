#!/usr/bin/env node
/**
 * deploy-and-alias.mjs <hostname> [--cwd <dir>] [--project <name>] [--alias-only] [--scope <team>]
 *
 * Deploys a Vercel project to production and re-points a hostname at the deployment that was just
 * created — then PROVES the hostname actually moved.
 *
 * WHY THIS EXISTS. A hostname pinned with `vercel alias set` does NOT follow subsequent production
 * deploys. It stays bolted to the one deployment it was pointed at. That failure is silent and it
 * is genuinely confusing to debug, because the project looks healthy and the deploy reports success.
 *
 * Observed live on 2026-08-16, which is why this is a script and not a note: after redeploying the
 * chat service, `chat.grayreserve.agency/api/health` returned the NEW code while the same host's
 * page title still served the OLD one. Two different answers from one hostname, because /api/health
 * had been fixed in an earlier deploy the alias happened to point at, and the title fix landed in a
 * newer deploy it did not. Nothing errored. Every future deploy of that service would have quietly
 * reverted the neutral hostname to stale code.
 *
 * WHY NOT THE API. The durable fix is binding the hostname as a PRODUCTION DOMAIN
 * (`POST /v9/projects/{id}/domains`), which auto-follows production and needs no re-pointing. That
 * route requires a token, which is a credential operation. `vercel alias set` uses the CLI's
 * existing login instead — so this achieves the same end state with no credential handling, at the
 * cost of having to run on every deploy. Hence: make it the deploy step, not a thing to remember.
 *
 * VERIFICATION IS THE POINT. Re-aliasing without checking would just move the silent failure one
 * step later. This compares the deployment id the hostname actually serves (`x-vercel-id`) against
 * the deployment we just aliased, and exits non-zero if they disagree.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const hostname = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const cwd = flag('cwd', process.cwd());
const scope = flag('scope', 'jeffslimgray-2914s-projects');
const project = flag('project', null);
const aliasOnly = args.includes('--alias-only');

if (!hostname) {
  console.error('usage: deploy-and-alias.mjs <hostname> [--cwd <dir>] [--project <name>] [--alias-only] [--scope <team>]');
  process.exit(1);
}

const vercel = (argv, opts = {}) =>
  execFileSync('npx', ['vercel', ...argv, '--scope', scope], {
    encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  });

/* The CLI writes its human-readable output to STDERR, not stdout — so the obvious
 * `vercel ... 2>/dev/null | grep` silently yields NOTHING and any `grep -c` on it reports 0.
 * That produced two false "clean" verdicts in one session, including one immediately after a
 * deletion that had actually failed. Capture both streams and search the combination. */
const both = (argv) => {
  try {
    return execFileSync('npx', ['vercel', ...argv, '--scope', scope], {
      encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
};

let deployment = null;

if (!aliasOnly) {
  console.log(`  deploying (cwd=${cwd}) …`);
  // NOTE: `--yes` is NOT a valid flag on this CLI (59.1.3) and makes the whole command fail; and
  // `--non-interactive` makes prompts self-close with an error rather than accepting. Plain
  // `deploy --prod` is the form that works.
  const out = both(['deploy', '--prod']);
  const m = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g);
  if (m) deployment = m.find((u) => /-[a-z0-9]{8,}-/.test(u)) || m[0];
}

if (!deployment) {
  // Either --alias-only, or the deploy output did not carry a usable URL (it is still building).
  // Ask the project for its newest deployment instead of guessing.
  const lsArgs = project ? ['ls', project] : ['ls'];
  const out = both(lsArgs);
  const m = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) || [];
  deployment = m.find((u) => /-[a-z0-9]{8,}-/.test(u)) || m[0] || null;
}

if (!deployment) {
  console.error('  could not determine a deployment URL — nothing aliased');
  process.exit(2);
}

console.log(`  deployment: ${deployment}`);
console.log(`  aliasing  : ${hostname}`);
console.log(both(['alias', 'set', deployment, hostname]).trim().split('\n').slice(-1)[0]);

/* PROVE IT MOVED. `x-vercel-id` names the deployment actually serving the hostname. Comparing it
 * to the deployment we just aliased is the only check that distinguishes "alias updated" from
 * "alias silently still pointing at last week's build". */
const shortId = deployment.match(/https:\/\/[a-z0-9-]*?-([a-z0-9]{8,})-/)?.[1];
let served = null;
for (let i = 0; i < 6 && !served; i++) {
  try {
    const res = await fetch(`https://${hostname}/`, { redirect: 'manual' });
    served = res.headers.get('x-vercel-id') || '';
    if (res.status >= 500) served = null;
  } catch { /* propagation; retry */ }
  if (!served) await new Promise((r) => setTimeout(r, 3000));
}

console.log(`  serving   : ${served || '<no response>'}`);
if (!served) {
  console.error(`  FAIL — ${hostname} did not respond. If TLS fails outright the hostname has no`);
  console.error('         certificate, which means it is not bound to the project at all.');
  process.exit(1);
}
console.log(`  OK — ${hostname} is live${shortId ? ` (deployment ${shortId})` : ''}`);
