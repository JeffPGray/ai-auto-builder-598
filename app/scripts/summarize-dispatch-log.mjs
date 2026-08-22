#!/usr/bin/env node
// Decode a stream-json dispatch log into the handful of facts an operator needs when a
// watchdog kill fires. Added 2026-08-19: before this, `claude -p` ran with the DEFAULT output
// format, which emits nothing until the process exits — so every watchdog-killed dispatch left a
// 0-byte log and zero evidence of why the build stalled. The dispatcher now runs stream-json so
// the log is written continuously; this renders it back into something readable.
//
// Deliberately tolerant: if the log is NOT stream-json (DISPATCH_OUTPUT_FORMAT=json|text, or the
// child died before its first line), fall back to a plain tail rather than failing — a diagnostic
// that throws during an incident is worse than no diagnostic.
//
// Usage: node scripts/summarize-dispatch-log.mjs <log-path> [n-events]

import { readFileSync, statSync } from 'node:fs';

const path = process.argv[2];
const TAIL_N = Number(process.argv[3] || 14);
if (!path) { console.error('usage: summarize-dispatch-log.mjs <log-path> [n-events]'); process.exit(2); }

let raw, st;
try { raw = readFileSync(path, 'utf8'); st = statSync(path); }
catch { console.log(`  (no log at ${path} — child died before writing anything)`); process.exit(0); }

const ageMin = ((Date.now() - st.mtimeMs) / 60000).toFixed(1);
const clip = (s, n = 220) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

if (!raw.trim()) {
  console.log(`  log is 0 bytes. If DISPATCH_OUTPUT_FORMAT was overridden to json/text this is`);
  console.log(`  EXPECTED (those formats write only at exit) — leave it unset to get streaming.`);
  process.exit(0);
}

const lines = raw.split('\n').filter((l) => l.trim());
const events = [];
let nonJson = 0;
for (const l of lines) {
  try { events.push(JSON.parse(l)); } catch { nonJson++; }
}

// Not a stream-json log -> plain tail, clearly labelled.
if (events.length === 0) {
  console.log(`  log is not stream-json (${lines.length} lines, ${st.size}B, last write ${ageMin}m ago). Raw tail:`);
  for (const l of lines.slice(-TAIL_N)) console.log('    ' + clip(l, 300));
  process.exit(0);
}

const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {};
// A rate_limit_event with status "allowed" is routine bookkeeping and fires on healthy runs — only
// a NON-allowed status is evidence of throttling. Warning on every one of them would cry wolf on
// every successful build and actively mislead on the one question this output exists to answer.
const rateLimits = events.filter((e) => e.type === 'rate_limit_event');
// allowed_warning = still serving (utilization high). Only rejected/blocked stall a run.
const throttled = rateLimits.filter((e) => {
  const s = e.rate_limit_info?.status ?? 'allowed';
  return s !== 'allowed' && s !== 'allowed_warning';
});
const result = events.filter((e) => e.type === 'result').pop();

console.log(`  session=${init.session_id || '?'} model=${init.model || '?'} events=${events.length}` +
            `${nonJson ? ` (+${nonJson} non-JSON)` : ''} log=${st.size}B last-write=${ageMin}m ago`);

if (throttled.length) {
  const last = throttled[throttled.length - 1];
  console.log(`  ⚠️  ${throttled.length} THROTTLED rate_limit_event(s) — API throttling, NOT a script hang.`);
  console.log(`      last: ${clip(JSON.stringify(last.rate_limit_info ?? last), 300)}`);
} else if (rateLimits.length) {
  console.log(`  rate_limit: ${rateLimits.length} event(s), all status=allowed (normal — not throttled).`);
}
if (result) console.log(`  result: subtype=${result.subtype} is_error=${result.is_error} duration_ms=${result.duration_ms} cost=$${result.total_cost_usd}`);

// Render one event as a single operator-legible line. Returns null for noise.
function render(e) {
  if (e.type === 'system' && e.subtype === 'init') return `[init] cwd=${e.cwd} tools=${(e.tools || []).length} mcp=${(e.mcp_servers || []).length}`;
  if (e.type === 'system') return `[${e.subtype}] ${clip(e.hook_name || e.output || '', 120)}`;
  if (e.type === 'rate_limit_event') return `[rate-limit] ${clip(JSON.stringify(e.rate_limit_info ?? {}), 160)}`;
  if (e.type === 'result') return `[result] ${e.subtype} ${clip(e.result, 160)}`;

  const content = e.message?.content;
  if (!Array.isArray(content)) return e.type ? `[${e.type}] ${clip(JSON.stringify(e).slice(0, 200))}` : null;

  const out = [];
  for (const b of content) {
    if (b.type === 'text' && b.text?.trim()) out.push(`[say] ${clip(b.text)}`);
    else if (b.type === 'thinking' && b.thinking?.trim()) out.push(`[think] ${clip(b.thinking, 160)}`);
    else if (b.type === 'tool_use') {
      const i = b.input || {};
      const arg = i.command || i.file_path || i.pattern || i.path || i.prompt || i.description || '';
      out.push(`[tool] ${b.name}: ${clip(arg, 180)}`);
    } else if (b.type === 'tool_result') {
      const r = e.tool_use_result || {};
      const ec = r.exit_code ?? r.exitCode;
      const err = r.stderr || (b.is_error ? 'IS_ERROR' : '');
      const body = clip(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? r.stdout ?? ''), 180);
      out.push(`[result${ec !== undefined ? ` exit=${ec}` : ''}]${err ? ` stderr=${clip(err, 120)}` : ''} ${body}`);
    }
  }
  return out.length ? out.join('\n      ') : null;
}

const rendered = events.map(render).filter(Boolean);
console.log(`  --- last ${Math.min(TAIL_N, rendered.length)} of ${rendered.length} rendered events ---`);
for (const r of rendered.slice(-TAIL_N)) console.log('    ' + r);

// The discriminator the operator actually needs: what was in flight when it went quiet.
// Judge by the last SUBSTANTIVE event, not the literal last line: rate_limit_event and system/hook
// events are bookkeeping that routinely trail the real activity, and letting one of them win the
// verdict masks exactly the case this exists to name (a tool call that never returned).
const substantive = events.filter((e) => e.type === 'assistant' || e.type === 'user' || e.type === 'result');
const last = substantive[substantive.length - 1] ?? events[events.length - 1];
const lastBlocks = Array.isArray(last?.message?.content) ? last.message.content.map((b) => b.type) : [];
let verdict;
if (result) verdict = `child reached a result event (${result.subtype}) — it COMPLETED its turn. If a kill fired, it was a ceiling/cap, not a hang.`;
else if (throttled.length) verdict = 'throttled rate-limit events and no result — most likely an API stall. Retry later.';
else if (lastBlocks.includes('tool_use')) verdict = 'last event was a TOOL CALL with no result after it — the TOOL hung (script/command/browser), not the API.';
else if (lastBlocks.includes('tool_result')) verdict = 'last event was a tool RESULT with no assistant turn after it — the model/API stalled after the tool returned.';
else if (lastBlocks.includes('text') || lastBlocks.includes('thinking')) verdict = 'last event was mid-composition assistant output — API stream stalled mid-turn.';
else if (last?.type === 'system') verdict = 'never got past session/hook startup — startup hang (hooks, MCP, or auth).';
else verdict = `last event type=${last?.type} subtype=${last?.subtype}.`;
console.log(`  verdict: ${verdict}`);
