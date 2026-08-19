#!/usr/bin/env node
/**
 * build-metrics.mjs [--since-file /tmp/pre-sessions.txt]
 *
 * Reports the metrics that actually predict build quality and duration, measured from the real
 * Claude Code transcript rather than self-report.
 *
 * WHY COMPACTION COUNT IS THE HEADLINE. Measured 2026-08-19 on cold-front-ac: the build compacted
 * 9 times (first at minute 12, then every ~14 min). Everything written after minute 12 was authored
 * from a SUMMARY of the design brief rather than the brief, and the site read generic despite
 * passing every gate. Separately, all Bash execution was 2.8% of the 130-minute wall clock — so
 * optimising scripts is noise; compaction is signal.
 *
 * SELF-RE-READS are the driver: 56 of that build's 76 Read calls re-read files it had authored
 * itself (page.tsx 21x). Context fills -> compaction -> the model no longer holds its own code ->
 * whole-file re-read -> context re-inflates -> compacts again.
 *
 * Targets: compactions < 3, self-re-reads < 10.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.claude/projects/-Users-jeffgray-Github-klaudius-app');
const args = process.argv.slice(2);
const sinceIdx = args.indexOf('--since-file');
const seen = sinceIdx !== -1 && existsSync(args[sinceIdx + 1])
  ? new Set(readFileSync(args[sinceIdx + 1], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))
  : new Set();

const files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => join(DIR, f))
  .filter((f) => !seen.has(f));
if (!files.length) { console.log('no new transcripts since the marker file'); process.exit(0); }

for (const f of files.sort()) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let start = null, end = null, compactions = 0, turns = 0;
  const reads = new Map(); const writes = new Map(); const tools = new Map();
  for (const line of lines) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.timestamp) { const t = new Date(d.timestamp); if (!start) start = t; end = t; }
    if (d.isCompactSummary || d.message?.isCompactSummary) compactions++;
    if (d.type === 'assistant') turns++;
    const c = d.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== 'tool_use') continue;
      tools.set(b.name, (tools.get(b.name) || 0) + 1);
      const fp = b.input?.file_path; if (!fp) continue;
      const base = fp.split('/').slice(-2).join('/');
      if (b.name === 'Read') reads.set(base, (reads.get(base) || 0) + 1);
      if (b.name === 'Write' || b.name === 'Edit') writes.set(base, (writes.get(base) || 0) + 1);
    }
  }
  if (turns < 20) continue;                       // skip trivial/aborted sessions
  const mins = start && end ? (end - start) / 60000 : 0;
  const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
  const reReads = [...reads.values()].reduce((a, n) => a + Math.max(0, n - 1), 0);
  const authored = new Set(writes.keys());
  const selfReReads = [...reads].filter(([k]) => authored.has(k))
    .reduce((a, [, n]) => a + Math.max(0, n - 1), 0);

  console.log(`\n═══ ${f.split('/').pop()} ═══`);
  console.log(`  wall clock      ${mins.toFixed(1)} min`);
  console.log(`  assistant turns ${turns}`);
  console.log(`  COMPACTIONS     ${compactions}   ${compactions < 3 ? '✅ target <3' : '❌ target <3'}`);
  console.log(`  SELF RE-READS   ${selfReReads}   ${selfReReads < 10 ? '✅ target <10' : '❌ target <10'}   (of ${totalReads} reads, ${reReads} re-reads total)`);
  const worst = [...reads].filter(([k]) => authored.has(k) && reads.get(k) > 1)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (worst.length) {
    console.log('  worst self-re-read files:');
    for (const [k, n] of worst) console.log(`      ${n}x read / ${writes.get(k)}x written   ${k}`);
  }
  console.log(`  tool calls      ${[...tools].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}:${v}`).join('  ')}`);
}
