#!/usr/bin/env node
/**
 * verify-wiring-generic.mjs — catch SILENT WIRING FAILURES as a CLASS, not one by one.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT verify-wiring.sh
 * ---------------------------------------------------
 * On 2026-08-19 five wiring failures were found BY HAND. Every one had the same shape:
 * an instruction existed, its target could not execute, and NOTHING ERRORED.
 *
 *   1. build/SKILL.md called Skill(skill="anti-ai-slop") 3x while allowed-tools omitted `Skill`.
 *   2. qa-reviewer.md used `allowed-tools:` (the SKILL key) instead of `tools:` (the AGENT key).
 *   3. derive-palette.mjs --ground saturated existed; no skill ever mentioned it.
 *   4. Four shadcn primitives vendored into every client, imported by nothing.
 *   5. scripts/qa-capture.sh written, left unreferenced.
 *
 * verify-wiring.sh then grew ~62 assertions that catch exactly THOSE FIVE. That is its weakness:
 * it enumerates known failures. A wire added tomorrow is unprotected, because protecting it
 * requires somebody to remember to write assertion #63.
 *
 * This file enumerates nothing. It derives every expectation from the files themselves:
 *
 *   A. Every tool a body INSTRUCTS must be DECLARED, under the key correct for that file type.
 *      (failures 1 and 2, generically — any tool, any skill, any agent, forever)
 *   B. Every scripts/X a body invokes must EXIST, and every --flag it passes must appear in that
 *      script's own argument parsing. (a renamed or never-existent flag, generically)
 *   C. Every capability that ships must have a CONSUMER: every script in scripts/, every CSV
 *      column under ui-ux-pro-max/data/, every module vendored into the template.
 *      (failures 3, 4 and 5, generically)
 *   D. Every `§ Name` cross-reference must resolve to a real heading. (dead refs, generically)
 *
 * Both checkers should run, they do different jobs. verify-wiring.sh asserts BEHAVIOUR — it
 * executes derive-palette and greps the output, runs richness-check against a real client and
 * asserts the gate fires. This one asserts REACHABILITY, structurally, for wires nobody has
 * thought about yet. verify-wiring.sh calls this file as its last section.
 *
 * CALIBRATION IS THE WHOLE GAME. A checker that cries wolf gets ignored, so every rule here was
 * tuned against this repo by hand-verifying its first-run output, and the reason is recorded at
 * the rule. The load-bearing ones:
 *
 *   - Existence of a script at the repo root is POSITIVE evidence; its absence is only
 *     conclusive while the working directory is still the repo root. deploy/SKILL.md legitimately
 *     `cd`s into gr-no-website-builds and runs THAT repo's scripts/, and build/SKILL.md runs
 *     `../../../scripts/node-modules-cache.sh` from inside a client site. Both would be
 *     guaranteed false positives under a naive existence check.
 *   - A `scripts/X` is only an INVOCATION when a runner precedes it (`python3`, `node`, `bash`,
 *     `npx`, `./`) or it heads a shell segment. `scripts/my-notify.py` named inside a prose
 *     example in resolve-conflicts/SKILL.md is a mention, not a call.
 *   - A § reference resolves against the file it names, but only FAILS when the section exists
 *     in NO governed file — so mis-guessing which file was meant can never produce a failure.
 *     Headings are matched on any word-prefix, with list numbering and trailing " — commentary"
 *     stripped, because real headings read `### 3. Copy quality system from anti-ai-slop (…)`
 *     while real references read `§ Copy quality system above`.
 *   - Bash command heads are only reported when the token is a real, resolvable executable or an
 *     on-disk script — never a shell keyword, a variable, or prose inside a heredoc.
 *   - A fence headed `# ❌ ALL OF THESE ARE WRONG` is a BAD EXAMPLE and is excluded entirely.
 *     deploy/SKILL.md lists the `vercel --prod` shortcut that once overwrote a live client site;
 *     demanding `Bash(vercel *)` for it would be advice in the exact wrong direction.
 *   - Repeats collapse: one missing script cited on 19 lines is ONE finding, and a file's
 *     uncovered Bash commands are one finding listing all of them. The first draft emitted 79
 *     findings for 25 defects, which is indistinguishable from noise.
 *
 * Self-test: `node scripts/verify-wiring-generic.test.mjs` rebuilds all five 2026-08-19 failure
 * SHAPES under names that appear nowhere in this file (a `sparkle` skill, a `polish-reviewer`
 * agent, a `carousel.tsx` primitive) and asserts each is caught, then asserts a correctly wired
 * fixture produces zero findings.
 *
 * Usage:  node scripts/verify-wiring-generic.mjs [--verbose]
 * Exit:   0 = clean, 1 = at least one FAIL.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

let PASS = 0;
const FAILS = [];
const NOTES = [];

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', x: '' };

const ok = (msg) => { PASS++; if (VERBOSE) console.log(`  ${C.g}PASS${C.x}  ${msg}`); };
const fail = (where, msg) => { FAILS.push({ where, msg }); console.log(`  ${C.r}FAIL${C.x}  ${C.d}${where}${C.x}\n        ${msg}`); };
const note = (msg) => { NOTES.push(msg); if (VERBOSE) console.log(`  ${C.y}note${C.x}  ${msg}`); };
const head = (t) => console.log(`\n── ${t} ──`);

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const lsSafe = (p) => { try { return readdirSync(p); } catch { return []; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const rel = (p) => (p.startsWith(ROOT + '/') ? p.slice(ROOT.length + 1) : p);

/* ============================================================================
 * Discovery — what files are we governing?
 * ========================================================================== */

const SKILL_FILES = lsSafe(join(ROOT, '.claude/skills'))
  .map((d) => join(ROOT, '.claude/skills', d, 'SKILL.md'))
  .filter(isFile);

const AGENT_FILES = lsSafe(join(ROOT, '.claude/agents'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => join(ROOT, '.claude/agents', f))
  .filter(isFile);

const GOVERNED = [
  ...SKILL_FILES.map((f) => ({ path: f, kind: 'skill' })),
  ...AGENT_FILES.map((f) => ({ path: f, kind: 'agent' })),
];

/* ============================================================================
 * Frontmatter + body, line numbers preserved.
 * ========================================================================== */

const FILE_CACHE = new Map();
function parseFile(path) {
  if (FILE_CACHE.has(path)) return FILE_CACHE.get(path);
  const text = read(path);
  const lines = text.split('\n');
  const fm = {};
  let bodyStart = 0;
  if (lines[0]?.trim() === '---') {
    let end = -1;
    for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
    if (end > 0) {
      for (let i = 1; i < end; i++) {
        // top-level keys only (no leading whitespace); nested YAML is not used in these files
        const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[i]);
        if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      bodyStart = end + 1;
    }
  }
  const out = { text, lines, fm, bodyStart };
  FILE_CACHE.set(path, out);
  return out;
}

/** Split `Bash(npx *), Read, Write, mcp__x__y` into entries, respecting parentheses. */
function splitDecl(value) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/**
 * Line numbers that sit inside a fenced block whose opening comment marks it as a BAD EXAMPLE.
 *
 * deploy/SKILL.md ships a fence headed `# ❌ ALL OF THESE ARE WRONG` listing the `vercel --prod`
 * shortcut that once overwrote a paying client's live site. NOT declaring `Bash(vercel *)` for
 * that file is the correct state, so counting those lines as instructions is a false positive —
 * and the loudest kind, because the fix it proposes is the exact opposite of what is wanted.
 * Only the first two non-empty lines of a fence are consulted, so a warning buried mid-block
 * cannot suppress the real commands around it.
 */
const NEGATIVE_MARK = /❌|✗|🚫|\bWRONG\b|\bNEVER\b|\bBANNED\b|\bDO NOT\b|\bDON'?T\b|\bBAD\b|anti-?pattern/i;
function negativeExampleLines(lines) {
  const bad = new Set();
  let open = -1, seen = 0, negative = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(`{3,}|~{3,})/.test(lines[i])) {
      if (open >= 0 && lines[i].trim()) {
        if (seen < 2 && /^\s*#/.test(lines[i]) && NEGATIVE_MARK.test(lines[i])) negative = true;
        seen++;
      }
      continue;
    }
    if (open < 0) { open = i; seen = 0; negative = false; continue; }
    if (negative) for (let j = open + 1; j < i; j++) bad.add(j + 1);
    open = -1;
  }
  return bad;
}

/**
 * Walk a markdown body once, yielding events with line numbers. Tracks fenced code blocks and
 * their language, and joins `\`-continued shell lines so a multi-line invocation is one command.
 */
function* walkBody(lines, startLine) {
  let inFence = false, lang = '', pending = '', pendingLine = 0, fenceStartLine = 0;
  for (let i = startLine; i < lines.length; i++) {
    const raw = lines[i];
    const fenceM = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)/.exec(raw);
    if (fenceM) {
      if (!inFence) { inFence = true; lang = (fenceM[2] || '').toLowerCase(); fenceStartLine = i + 1; }
      else {
        if (pending) { yield { kind: 'shell', text: pending, line: pendingLine, fenceStartLine }; pending = ''; }
        inFence = false; lang = '';
      }
      continue;
    }
    const isShell = inFence && /^(bash|sh|shell|zsh|console|shellsession)$/.test(lang);
    if (isShell) {
      if (pending) pending += ' ' + raw.trim();
      else { pending = raw; pendingLine = i + 1; }
      if (/\\\s*$/.test(pending)) { pending = pending.replace(/\\\s*$/, ''); continue; }
      yield { kind: 'shell', text: pending, line: pendingLine, fenceStartLine };
      pending = '';
      continue;
    }
    yield { kind: inFence ? 'code' : 'prose', text: raw, line: i + 1, lang, fenceStartLine };
  }
  if (pending) yield { kind: 'shell', text: pending, line: pendingLine, fenceStartLine };
}

/* ============================================================================
 * SECTION A — every tool the body INSTRUCTS must be DECLARED, under the right key.
 *
 * Failures 1 and 2 generalised. Nothing here knows about `Skill`, `anti-ai-slop` or
 * qa-reviewer: it reads what a body tells the model to do, then checks the frontmatter
 * can actually permit it.
 * ========================================================================== */

// Tools whose USE is unambiguous from a call shape `Tool(` or the phrase "the Tool tool".
// Deliberately NOT matched as bare words — "write", "read", "edit", "task" and "agent" are
// ordinary English, and matching them bare would bury real findings under hundreds of false ones.
const CALLABLE_TOOLS = [
  'Skill', 'Agent', 'Task', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite',
];

// Declaring either spelling satisfies a use of the other — Claude Code has renamed the
// subagent-spawning tool across versions and both appear in the wild.
const TOOL_ALIASES = { Agent: ['Agent', 'Task'], Task: ['Task', 'Agent'] };

/** Shell words that are never a permission-checked command head. */
const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'in', 'function', 'select', 'time', 'coproc', 'return', 'break', 'continue', 'shift',
  'local', 'declare', 'typeset', 'readonly', 'unset', 'set', 'shopt', 'trap', 'eval', 'exec',
  'source', '.', 'exit', 'wait', 'fg', 'bg', 'jobs', 'alias', 'unalias', 'let', 'read',
  'true', 'false', ':', '{', '}', '[', ']', '[[', ']]', '(', ')',
]);

/** One PATH scan, so "is this a real command" costs nothing per call. */
const PATH_COMMANDS = (() => {
  const set = new Set();
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const e of lsSafe(dir)) set.add(e);
  }
  return set;
})();

const cmdCache = new Map();
function isRealCommand(tok) {
  if (cmdCache.has(tok)) return cmdCache.get(tok);
  let real;
  if (tok.includes('/')) real = isFile(join(ROOT, tok.replace(/^\.\//, ''))) || isFile(tok);
  else real = PATH_COMMANDS.has(tok);
  cmdCache.set(tok, real);
  return real;
}

/** Break one shell line into independently permission-checked command segments. */
function shellSegments(line) {
  const t = line.trim();
  if (t === '' || t.startsWith('#')) return [];
  const s = line
    .replace(/\s+#(?=[^'"]*$).*$/, '')          // trailing comment
    .replace(/\$\(/g, ' ; ')                    // expose $( … )
    .replace(/`/g, ' ; ');                      // expose ` … `
  return s.split(/\|\||&&|[|;]|\bthen\b|\bdo\b|\belse\b/).map((x) => x.trim()).filter(Boolean);
}

/** Reduce a segment to its command head, or null when it isn't a command invocation. */
function commandHead(seg) {
  let s = seg.trim().replace(/^[!(){}\s]+/, '').trim();
  const assign = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;
  while (assign.test(s)) s = s.replace(assign, '');           // strip env prefixes
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) return null;        // pure assignment
  const tok = s.split(/\s+/)[0];
  if (!tok) return null;
  if (/^[$"'<>&-]/.test(tok)) return null;
  if (tok.includes('=')) return null;
  if (SHELL_KEYWORDS.has(tok)) return null;
  if (/^[0-9]/.test(tok)) return null;
  return { head: tok, full: s };
}

/** Does a declared `Bash(spec)` permit this command string? */
function bashSpecMatches(spec, full, cmdHead) {
  if (spec === 'Bash') return true;                       // bare `Bash` = unrestricted
  const inner = /^Bash\((.*)\)$/s.exec(spec)?.[1];
  if (inner == null) return false;
  const rx = new RegExp('^' + inner.trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') + '$');
  return rx.test(full) || rx.test(cmdHead) || rx.test(cmdHead + ' ');
}

function checkToolDeclarations() {
  head('A. Every tool the body instructs is declared, under the key correct for the file type');

  for (const { path, kind } of GOVERNED) {
    const { lines, fm, bodyStart } = parseFile(path);
    const name = rel(path);
    const rightKey = kind === 'skill' ? 'allowed-tools' : 'tools';
    const wrongKey = kind === 'skill' ? 'tools' : 'allowed-tools';

    // --- A1. the key itself. Failure 2, generically: a declaration written under the other
    // file type's key is not a restriction, it is silently ignored dead text.
    if (fm[wrongKey] !== undefined && fm[rightKey] === undefined) {
      fail(`${name}:frontmatter`,
        `declares \`${wrongKey}:\` but this is ${kind === 'skill' ? 'a SKILL' : 'an AGENT'} — the key here is ` +
        `\`${rightKey}:\`. The declaration is IGNORED, so every tool it names is silently ` +
        `unrestricted or silently unavailable. Rename the key.`);
      continue;
    }
    if (fm[wrongKey] !== undefined && fm[rightKey] !== undefined) {
      fail(`${name}:frontmatter`,
        `declares BOTH \`allowed-tools:\` and \`tools:\`. Only \`${rightKey}:\` is read for a ${kind}; ` +
        `the other is dead text that will drift out of sync. Delete it.`);
    }

    const declRaw = fm[rightKey];
    if (declRaw === undefined) { ok(`${name} — no ${rightKey}: key (unrestricted)`); continue; }
    const declared = splitDecl(declRaw);
    const declaredNames = new Set(declared.map((d) => d.replace(/\(.*$/s, '').trim()));
    const bashSpecs = declared.filter((d) => d === 'Bash' || d.startsWith('Bash('));

    // --- A2. named-tool call shapes in the body. Failure 1, generically.
    // Named tools are all-or-nothing (no glob semantics), and the recorded build logs contain a
    // real `permission_denials` entry for one — so this restriction is provably enforced.
    const used = new Map();
    for (const ev of walkBody(lines, bodyStart)) {
      if (ev.kind === 'shell') continue;               // shell is handled by A3
      for (const tool of CALLABLE_TOOLS) {
        if (used.has(tool)) continue;
        const callShape = new RegExp(`(?:^|[^A-Za-z0-9_.])${tool}\\s*\\(`);
        const toolPhrase = new RegExp(`(?:^|[^A-Za-z0-9_])\`?${tool}\`?\\s+tool\\b`);
        if (callShape.test(ev.text) || toolPhrase.test(ev.text)) used.set(tool, ev.line);
      }
    }
    for (const [tool, line] of used) {
      const accept = TOOL_ALIASES[tool] || [tool];
      if (accept.some((a) => declaredNames.has(a))) { ok(`${name} uses ${tool} — declared`); continue; }
      fail(`${name}:${line}`,
        `body instructs \`${tool}(...)\` but \`${rightKey}:\` does not list ${accept.join(' or ')}. ` +
        `The instruction cannot execute and NOTHING WILL ERROR — it will simply never happen. ` +
        `Add \`${accept[0]}\` to ${rightKey}, or delete the instruction.`);
    }

    // --- A3. shell command heads vs the declared Bash(...) specs.
    // Reported only when the file declares at least one Bash spec (so a restriction was
    // intended) AND the head is a real, resolvable command. Aggregated to ONE finding per file:
    // a per-command listing produced 40 lines on the first run, which is how a checker gets
    // ignored. One line naming every uncovered command is the same information, actionable.
    const negLines = negativeExampleLines(lines);
    if (bashSpecs.length === 0) {
      let first = null;
      for (const ev of walkBody(lines, bodyStart)) {
        if (ev.kind !== 'shell' || negLines.has(ev.line)) continue;
        const seg = shellSegments(ev.text).map(commandHead).find((c) => c && isRealCommand(c.head));
        if (seg) { first = { ...seg, line: ev.line }; break; }
      }
      if (first) {
        fail(`${name}:${first.line}`,
          `body contains runnable shell (\`${first.head} …\`) but \`${rightKey}:\` declares no Bash ` +
          `permission at all. Add the Bash specs this file needs, or move the commands out.`);
      }
      continue;
    }
    const seenBad = new Map();
    for (const ev of walkBody(lines, bodyStart)) {
      if (ev.kind !== 'shell' || negLines.has(ev.line)) continue;
      for (const seg of shellSegments(ev.text)) {
        const ch = commandHead(seg);
        if (!ch || !isRealCommand(ch.head)) continue;
        if (bashSpecs.some((s) => bashSpecMatches(s, ch.full, ch.head))) continue;
        if (!seenBad.has(ch.head)) seenBad.set(ch.head, ev.line);
      }
    }
    if (seenBad.size === 0) { ok(`${name} — ${bashSpecs.length} Bash specs cover every command it runs`); continue; }
    const list = [...seenBad.entries()].map(([c, l]) => `${c} (:${l})`).join(', ');
    const add = [...seenBad.keys()].map((c) => `Bash(${c} *)`).join(', ');
    fail(`${name}:${Math.min(...seenBad.values())}`,
      `runs ${seenBad.size} command${seenBad.size === 1 ? '' : 's'} that NO declared Bash spec matches: ${list}. ` +
      `The \`${rightKey}:\` list is meant to be the executable contract for this file; a command ` +
      `outside it is an instruction the permission layer was never told to allow. Add: ${add}.`);
  }
}

/* ============================================================================
 * SECTION B — every scripts/X invoked exists, and every --flag it is passed is parsed.
 * ========================================================================== */

const RUNNERS = /(?:python3?|uv run|node|npx|bash|sh|zsh|source|\.\/|exec)\s*(?:[-\w.=]+\s+)*$/;

function scriptInvocations(path) {
  const { lines, bodyStart } = parseFile(path);
  const negLines = negativeExampleLines(lines);
  const found = [];
  // Working directory persists between Bash calls in Claude Code, so cwd state is tracked across
  // the WHOLE file, not reset per fence — deploy/SKILL.md `cd`s in one block and runs the shared
  // repo's scripts/ in the next.
  let cwdIsRoot = true;

  for (const ev of walkBody(lines, bodyStart)) {
    const text = negLines.has(ev.line) ? '' : ev.text;
    const rx = /((?:[A-Za-z0-9_.][A-Za-z0-9_./-]*\/)?scripts\/[A-Za-z0-9_.-]+\.(?:mjs|js|cjs|py|sh|ts))/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const near = before.slice(-40);
      if (/[$][{]?[A-Za-z_][A-Za-z0-9_]*[}]?\/?$/.test(near)) continue;   // "$SHARED_REPO/scripts/…"
      // A path is an INVOCATION only when a runner precedes it, or it heads a shell segment.
      // A bare mention in prose (resolve-conflicts names `scripts/my-notify.py` inside a quoted
      // example) is a reference, not a call, and must not be existence-checked.
      const isRun = RUNNERS.test(near) || (ev.kind === 'shell' && /(?:^|[;&|]\s*)\s*$/.test(near));
      if (!isRun) continue;
      // flags belong to THIS command only: stop at a pipe/chain, a closing backtick (inline code
      // ends there) or the next scripts/ path on the line (follow-up/SKILL.md puts two commands
      // in one sentence and the second one owns `--strict`).
      let tail = text.slice(m.index + m[0].length).split(/\||&&|;|`/)[0];
      const nextScript = tail.search(/scripts\//);
      if (nextScript >= 0) tail = tail.slice(0, nextScript);
      const flags = [...tail.matchAll(/(?<![\w-])--([A-Za-z][A-Za-z0-9-]*)/g)].map((f) => f[1]);
      found.push({ script: m[1], flags, line: ev.line, cwdIsRoot });
    }
    if (ev.kind === 'shell') {
      for (const seg of shellSegments(ev.text)) {
        const cd = /^cd\s+(\S+)/.exec(seg.trim());
        if (!cd) continue;
        // A literal path back to the repo root restores certainty; anything else (a variable, ~,
        // `cd -`, a client subdirectory) means later relative paths resolve somewhere unseen.
        cwdIsRoot = /^(\.|\.\/|"\.")$/.test(cd[1]);
      }
    }
  }
  return found;
}

function checkScriptWiring() {
  head('B. Every scripts/X a skill invokes exists, and every --flag it passes is really parsed');

  const srcCache = new Map();
  let resolved = 0, flagsProven = 0, skippedCwd = 0;

  for (const { path } of GOVERNED) {
    const name = rel(path);
    // One missing script cited on 16 lines is ONE defect, not 16 findings — a per-line listing
    // of the same broken path is how a real finding gets scrolled past.
    const missing = new Map();
    for (const inv of scriptInvocations(path)) {
      const abs = join(ROOT, inv.script);
      if (!isFile(abs)) {
        // Existence at the repo root is positive evidence; its ABSENCE only proves a dead
        // reference while cwd is still the repo root.
        if (!inv.cwdIsRoot) {
          skippedCwd++;
          note(`${name}:${inv.line} ${inv.script} — cwd left the repo root earlier in this file, existence not asserted`);
          continue;
        }
        if (!missing.has(inv.script)) missing.set(inv.script, []);
        missing.get(inv.script).push(inv.line);
        continue;
      }
      resolved++;
      if (inv.flags.length === 0) continue;
      if (!srcCache.has(abs)) srcCache.set(abs, read(abs));
      const src = srcCache.get(abs);
      for (const flag of inv.flags) {
        const rxFlag = new RegExp(`--${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`);
        if (rxFlag.test(src)) { flagsProven++; continue; }
        fail(`${name}:${inv.line}`,
          `passes \`--${flag}\` to \`${inv.script}\`, but that script never parses \`--${flag}\` ` +
          `(the string appears nowhere in it). The flag is silently ignored — the behaviour the ` +
          `skill is asking for does not happen. A renamed flag, or one that never existed.`);
      }
    }
    for (const [script, hits] of missing) {
      fail(`${name}:${hits[0]}`,
        `invokes \`${script}\` on ${hits.length} line${hits.length === 1 ? '' : 's'} (${hits.join(', ')}) and it DOES NOT ` +
        `EXIST at ${rel(join(ROOT, script))}. Nothing in this file changed the working directory, so the path is ` +
        `resolved from the project root and the instruction is dead — a run reaching it fails, or ` +
        `silently skips the step. Fix the path or create the script.`);
    }
  }
  ok(`${resolved} script invocations resolved, ${flagsProven} flags proven parsed, ${skippedCwd} skipped (cwd left the root)`);
}

/* ============================================================================
 * SECTION C — shipped capabilities with no consumer. Failures 3, 4 and 5, generically.
 * ========================================================================== */

function buildConsumerCorpus() {
  const parts = [];
  const push = (p) => { const t = read(p); if (t) parts.push({ file: p, text: t }); };
  const walk = (dir, filter, depth = 0) => {
    if (depth > 6) return;
    for (const e of lsSafe(dir)) {
      const p = join(dir, e);
      if (isDir(p)) {
        if (/^(node_modules|__pycache__|\.next|\.git|out|clients|\.playwright-cli|logs)$/.test(e)) continue;
        walk(p, filter, depth + 1);
      } else if (filter(p)) push(p);
    }
  };
  walk(join(ROOT, '.claude'), (p) => /\.(md|json|sh|mjs|js|py|ts)$/.test(p));
  walk(join(ROOT, 'scripts'), (p) => /\.(mjs|js|cjs|py|sh|ts|json|sql|ps1)$/.test(p));
  walk(join(ROOT, 'prompts'), (p) => /\.(md|json)$/.test(p));
  walk(join(ROOT, 'templates'), (p) => /\.(tsx|ts|jsx|js|mjs|json|css|md)$/.test(p));
  walk(join(ROOT, 'tests'), () => true);
  walk(join(ROOT, 'services'), (p) => /\.(mjs|js|ts|json|md)$/.test(p));
  push(join(ROOT, 'CLAUDE.md'));
  push(join(ROOT, 'package.json'));
  push(join(ROOT, '.env.example'));
  push(resolve(ROOT, '..', 'CLAUDE.md'));
  return parts;
}

function hasConsumer(corpus, needles, excludePaths) {
  const ex = new Set(excludePaths.map((p) => resolve(p)));
  for (const { file, text } of corpus) {
    if (ex.has(resolve(file))) continue;
    for (const n of needles) if (text.includes(n)) return file;
  }
  return null;
}

function checkOrphanCapabilities() {
  head('C. Every shipped capability has a consumer (scripts, CSV columns, vendored modules)');
  const corpus = buildConsumerCorpus();

  // --- C1. scripts/ — failure 5 (qa-capture.sh), generically.
  const scriptsDir = join(ROOT, 'scripts');
  let orphanScripts = 0, scriptsChecked = 0;
  for (const e of lsSafe(scriptsDir)) {
    const p = join(scriptsDir, e);
    if (!isFile(p)) continue;
    if (!/\.(mjs|js|cjs|py|sh|ts|ps1)$/.test(e)) continue;   // data files are covered by their users
    if (e.startsWith('verify-wiring')) continue;             // the checkers themselves
    scriptsChecked++;
    const stem = basename(e, extname(e));
    const where = hasConsumer(corpus, [e, `scripts.${stem}`, `scripts/${stem}`], [p]);
    if (where) { ok(`scripts/${e} ← ${rel(where)}`); continue; }
    orphanScripts++;
    fail(`scripts/${e}`,
      `NOTHING references this script — not a skill, not an agent, not CLAUDE.md, not another ` +
      `script, not package.json. It cannot run. Wire it into the skill that should call it, or delete it.`);
  }
  if (orphanScripts === 0) ok(`all ${scriptsChecked} scripts in scripts/ have at least one caller`);

  // --- C2. CSV columns under ui-ux-pro-max/data/. Data with no consumer is data the model
  // never sees — exactly how "Typography Pool" sat unreachable until someone plumbed it through.
  const uxRoot = join(ROOT, '.claude/skills/ui-ux-pro-max');
  const uxScope = [
    join(uxRoot, 'scripts/core.py'),
    join(uxRoot, 'scripts/design_system.py'),
    join(uxRoot, 'scripts/search.py'),
    join(uxRoot, 'SKILL.md'),
    join(ROOT, '.claude/skills/build/SKILL.md'),
    join(ROOT, 'CLAUDE.md'),
  ].map((p) => ({ file: p, text: read(p) })).filter((x) => x.text);

  const csvs = [];
  const collectCsv = (dir) => {
    for (const e of lsSafe(dir)) {
      const p = join(dir, e);
      if (isDir(p)) collectCsv(p);
      else if (e.endsWith('.csv')) csvs.push(p);
    }
  };
  collectCsv(join(uxRoot, 'data'));

  let orphanCols = 0, colsChecked = 0;
  for (const csv of csvs) {
    const header = read(csv).split('\n')[0] || '';
    const cols = header.split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
    for (const col of cols) {
      if (col === 'No') continue;                            // structural row id, never surfaced
      colsChecked++;
      if (uxScope.some((x) => x.text.includes(col))) continue;
      orphanCols++;
      fail(`${rel(csv)} column "${col}"`,
        `the column is in the data but NOTHING consumes it — it appears in no output_cols/search_cols ` +
        `in core.py and is named in no skill. Every row's value here is dead weight the model never ` +
        `sees. Add it to that CSV's column list in core.py, or drop the column.`);
    }
  }
  if (orphanCols === 0) ok(`all ${colsChecked} CSV columns across ${csvs.length} files reach a consumer`);

  // --- C3. modules vendored into the template — failure 4, generically.
  const vendorDirs = [
    join(ROOT, 'templates/trade-site/src/app/_components/ui'),
    join(ROOT, 'templates/trade-site/src/app/_components'),
    join(ROOT, 'templates/trade-site/src/lib'),
  ].filter(isDir);
  let orphanVendor = 0, vendorChecked = 0;
  for (const dir of vendorDirs) {
    for (const e of lsSafe(dir)) {
      const p = join(dir, e);
      if (!isFile(p) || !/\.(tsx|ts|jsx|js)$/.test(e)) continue;
      vendorChecked++;
      const stem = basename(e, extname(e));
      const where = hasConsumer(corpus, [stem], [p]);
      if (where) { ok(`${rel(p)} ← ${rel(where)}`); continue; }
      orphanVendor++;
      fail(rel(p),
        `vendored into every client but referenced by NOTHING — no template source imports it, ` +
        `no skill names it, no gate checks for it. It ships as dead bytes in every build. ` +
        `Wire it into build/SKILL.md and a gate, or stop vendoring it.`);
    }
  }
  if (orphanVendor === 0) ok(`all ${vendorChecked} vendored template modules are referenced`);
}

/* ============================================================================
 * SECTION D — `§ Name` cross-references must resolve to a real heading.
 * ========================================================================== */

function normSection(s) {
  return s
    .replace(/§/g, ' ')
    .replace(/[`*_"]/g, '')
    .replace(/\([^)]*\)/g, ' ')                 // "(all hosts)" / "(2026-08-18 spec)" is decoration
    .replace(/[^A-Za-z0-9+/'\s-]/g, ' ')        // em-dashes, arrows, emoji
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    // "### 3. Copy quality system from …" is cited as "§ Copy quality system above". The `.` is
    // already gone by this point, so the enumeration strip must tolerate its absence.
    .replace(/^(?:\d+[a-z]?[.)]?\s+|step\s+\d+[a-z]?\s+)/, '')
    .trim();
}

/**
 * A heading yields several keys, because real headings carry commentary the reference never
 * repeats: `### Per-service pages — /services/<slug> (the commercial-intent lane)` is cited as
 * `§ Per-service pages`, and `### Logo: grade defensively…` as `§ Logo`.
 */
function headingKeys(raw) {
  const keys = new Set();
  const add = (s) => { const n = normSection(s); if (n.length >= 3) keys.add(n); };
  add(raw);
  // A heading's name ends at the first separator; everything after it is commentary the citing
  // line never repeats. `## Motion, chat and hero video (…)` is cited simply as `§ Motion`.
  for (const sep of [' — ', ' – ', ' -- ', ' - ', ':', ',']) {
    const i = raw.indexOf(sep);
    if (i > 0) add(raw.slice(0, i));
  }
  return keys;
}

const HEADING_CACHE = new Map();
function headingsOf(path) {
  if (HEADING_CACHE.has(path)) return HEADING_CACHE.get(path);
  const keys = new Set();
  let inFence = false;
  for (const line of read(path).split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    let h = null;
    const atx = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (atx) {
      // Inside a fence a leading `#` is a shell comment, not a heading — EXCEPT for this repo's
      // own `# § Route check (all hosts)` convention, which really does label a section.
      if (!inFence || atx[1].includes('§')) h = atx[1];
    } else if (!inFence) {
      const bold = /^\s*\*\*(.+?)\*\*[:.]?\s*$/.exec(line);   // bold-line pseudo-headings are used too
      if (bold) h = bold[1];
    }
    if (h) for (const k of headingKeys(h)) keys.add(k);
  }
  HEADING_CACHE.set(path, keys);
  return keys;
}

/** The file a § reference names on its own line, if any. */
function referencedFileOnLine(prefix, selfPath) {
  for (const cand of [...prefix.matchAll(/([A-Za-z0-9_./-]+\.md)/g)].map((x) => x[1]).reverse()) {
    for (const base of [join(ROOT, cand), join(dirname(selfPath), cand), join(ROOT, '.claude', cand)]) {
      if (isFile(base)) return base;
    }
  }
  const skillM = /\b([a-z][a-z0-9-]{2,})\s+skill(?:'s)?\b/i.exec(prefix);   // "the CMS skill's § Maintenance"
  if (skillM) {
    const p = join(ROOT, '.claude/skills', skillM[1].toLowerCase(), 'SKILL.md');
    if (isFile(p)) return p;
  }
  return null;
}

function checkSectionRefs() {
  head('D. Every `§ Name` cross-reference resolves to a real heading');

  // Skills point § references into their own reference/ files and into prompts/lessons/, and
  // those files carry § references of their own — so both directions need them in the universe.
  const extra = [];
  const collectMd = (dir, depth = 0) => {
    if (depth > 3) return;
    for (const e of lsSafe(dir)) {
      const p = join(dir, e);
      // prompts/dispatch/ holds one-shot, already-consumed run prompts (…-v3.md, …-resume3.md).
      // They are scratch, not maintained docs, and grading them would be permanent noise.
      if (e === 'dispatch') continue;
      if (isDir(p)) collectMd(p, depth + 1);
      else if (e.endsWith('.md')) extra.push(p);
    }
  };
  for (const s of lsSafe(join(ROOT, '.claude/skills'))) collectMd(join(ROOT, '.claude/skills', s, 'reference'));
  collectMd(join(ROOT, 'prompts'));

  const universe = [...new Set([...GOVERNED.map((g) => g.path), join(ROOT, 'CLAUDE.md'), ...extra])].filter(isFile);
  const allHeadings = new Map(universe.map((p) => [p, headingsOf(p)]));

  /**
   * A reference matches when the first N words of it are exactly a heading key, for any N — the
   * prose after a section name ("§ Legal pages ships both on every site") is not part of the name.
   * The reverse also passes, for a reference abbreviated relative to its heading.
   */
  const matches = (words, keys) => {
    for (let n = words.length; n >= 1; n--) {
      const p = normSection(words.slice(0, n).join(' '));
      if (p.length < 3) continue;
      if (keys.has(p)) return true;
      // A reference may also be the SHORT form of a longer heading — "§ Copy quality system
      // above" against `### 3. Copy quality system from anti-ai-slop (…)`. Allowed only from two
      // normalised words up: a single word ("§ Font") matching any heading that merely begins
      // with it would make every dead one-word reference pass, which is the failure class itself.
      if (p.split(' ').length >= 2) for (const k of keys) if (k.startsWith(p + ' ')) return true;
    }
    return false;
  };

  let checked = 0, orphans = 0;
  for (const path of universe) {
    const lines = read(path).split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
      if (!line.includes('§')) continue;
      if (/^\s*#{1,6}\s/.test(line)) continue;            // `# § Vercel` is a definition, not a reference
      for (const m of line.matchAll(/§\s*([A-Za-z][^,.;:|>)"'\n]{1,70})/g)) {
        const words = m[1].trim().split(/\s+/).slice(0, 8);
        if (!words.length) continue;
        checked++;
        const target = referencedFileOnLine(line.slice(0, m.index), path) || path;
        if (matches(words, allHeadings.get(target) || headingsOf(target))) continue;
        // Not in the named target. Before failing, check EVERY governed file — mis-guessing
        // which file was meant must never be able to produce a failure. Only a section that
        // exists NOWHERE is a genuine dead reference.
        let foundIn = null;
        for (const [p, hs] of allHeadings) if (matches(words, hs)) { foundIn = p; break; }
        if (foundIn) {
          note(`${rel(path)}:${i + 1} "§ ${words.join(' ')}" not in ${rel(target)} but exists in ${rel(foundIn)}`);
          continue;
        }
        orphans++;
        fail(`${rel(path)}:${i + 1}`,
          `cross-reference \`§ ${words.join(' ')}\` matches NO heading in any skill, agent or CLAUDE.md. ` +
          `The section it points at was renamed or deleted — anything following this reference, ` +
          `model or human, finds nothing. Fix the name or remove the reference.`);
      }
    }
  }
  if (orphans === 0) ok(`all ${checked} § cross-references resolve to a real heading`);
}

/* ============================================================================ */

console.log(`${C.d}verify-wiring-generic — structural reachability, derived not enumerated${C.x}`);
const t0 = Date.now();
checkToolDeclarations();
checkScriptWiring();
checkOrphanCapabilities();
checkSectionRefs();

console.log('');
if (NOTES.length && !VERBOSE) console.log(`  ${C.d}${NOTES.length} note(s) suppressed — rerun with --verbose${C.x}`);
const ms = Date.now() - t0;
console.log(FAILS.length === 0
  ? `  ${C.g}═══ ${PASS} checks passed, 0 FAILED ═══${C.x}  ${C.d}(${ms}ms)${C.x}\n`
  : `  ${C.r}═══ ${PASS} passed, ${FAILS.length} FAILED ═══${C.x}  ${C.d}(${ms}ms)${C.x}\n`);
process.exit(FAILS.length > 0 ? 1 : 0);
