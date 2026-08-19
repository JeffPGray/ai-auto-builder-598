#!/usr/bin/env node
/**
 * verify-wiring-generic.test.mjs — prove the generic checker earns the word "generic".
 *
 * The claim being tested is not "it still catches the five failures found on 2026-08-19" — a
 * hardcoded assertion does that, which is exactly the weakness this checker was built to remove.
 * The claim is: **reintroduce each failure SHAPE under names nobody has ever enumerated, and it
 * is still caught.** So this test builds a throwaway repo containing a `sparkle` skill, a
 * `polish-reviewer` agent, a `glitter-report.mjs` script and a `carousel.tsx` primitive — none
 * of which appear anywhere in the checker's source — and asserts every defect is reported.
 *
 * It also runs a CLEAN fixture with the same shapes wired correctly and asserts ZERO findings.
 * That half matters as much: a checker that fires on healthy input gets switched off.
 *
 * Usage: node scripts/verify-wiring-generic.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'verify-wiring-generic.mjs');

let failures = 0;
const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m' }
  : { g: '', r: '', d: '', x: '' };

function put(root, relPath, body) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

/**
 * Run the checker inside a fixture root and return its combined output.
 *
 * The checker resolves its repo root as `dirname(itself)/..`, so it has to be copied INTO the
 * fixture — but never into `scripts/`, which the orphan check both scans and treats as a
 * consumer corpus. Its own header comment names the fixtures (`carousel.tsx`, `sparkle`), and
 * from inside `scripts/` that comment would satisfy the very reference the test asserts is
 * missing. `.tooling/` is outside every corpus walk.
 */
function runChecker(root) {
  mkdirSync(join(root, '.tooling'), { recursive: true });
  copyFileSync(CHECKER, join(root, '.tooling', 'verify-wiring-generic.mjs'));
  try {
    return execFileSync(process.execPath, [join(root, '.tooling', 'verify-wiring-generic.mjs')],
      { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function expect(cond, label) {
  if (cond) { console.log(`  ${C.g}ok${C.x}   ${label}`); return; }
  failures++;
  console.log(`  ${C.r}FAIL${C.x} ${label}`);
}

/* ------------------------------------------------------------------ *
 * Fixture 1 — every failure shape present, under brand-new names.
 * ------------------------------------------------------------------ */

const broken = mkdtempSync(join(tmpdir(), 'wiring-broken-'));
mkdirSync(join(broken, 'scripts'), { recursive: true });

// A capability that IS wired, so the orphan check has to discriminate rather than flag everything.
put(broken, 'scripts/confetti-check.mjs', 'const args=process.argv.slice(2);\nif(args.includes("--loud")){}\n');
// Failure 5's shape: a script nothing calls.
put(broken, 'scripts/glitter-report.mjs', '// written, never wired\n');
// Failure 4's shape: a primitive vendored but referenced by nothing.
put(broken, 'templates/trade-site/src/app/_components/ui/carousel.tsx', 'export const Carousel = () => null;\n');
// Failure 3's shape: a data column with no consumer.
put(broken, '.claude/skills/ui-ux-pro-max/scripts/core.py',
  '_CFG = {"output_cols": ["Sparkle Level"]}\n');
put(broken, '.claude/skills/ui-ux-pro-max/data/sparkle.csv',
  'No,Sparkle Level,Glow Radius\n1,high,4px\n');

// Failure 1's shape: a skill whose body calls a tool its allowed-tools omits, plus a dead
// script path, an unparsed flag, and a cross-reference to a section that does not exist.
put(broken, '.claude/skills/sparkle/SKILL.md', `---
name: sparkle
description: Add sparkle.
allowed-tools: Bash(node *), Read, Write
---

# Sparkle

## Setup

Invoke the polish pass:

\`\`\`
Skill(skill="anti-ai-slop", args="the hero copy")
\`\`\`

Then delegate the long prose:

\`\`\`
Agent(subagent_type="general-purpose", prompt="draft it")
\`\`\`

Run the gates (see § Ghost Section for why):

\`\`\`bash
node scripts/confetti-check.mjs --loud
node scripts/confetti-check.mjs --volume
node scripts/tinsel-check.mjs
rm -rf out
\`\`\`

Correct back-reference, must NOT be flagged: § Setup.
`);

// Failure 2's shape: an agent using the SKILL key instead of the AGENT key.
put(broken, '.claude/agents/polish-reviewer.md', `---
name: polish-reviewer
description: Reviews polish.
allowed-tools: Bash, Read, Skill
---

# Polish reviewer

Run \`Skill(skill="impeccable")\` and report.
`);

put(broken, 'CLAUDE.md', '# Fixture\n\nUses `scripts/confetti-check.mjs`.\n');

const out1 = runChecker(broken);

console.log(`\n${C.d}Fixture 1 — every failure shape, under names the checker has never seen${C.x}`);
expect(/polish-reviewer\.md:frontmatter[\s\S]*?allowed-tools[\s\S]*?tools:/.test(out1),
  'failure 2 shape: agent declaring allowed-tools: instead of tools: is caught');
expect(/sparkle\/SKILL\.md:\d+[\s\S]*?`Skill\(\.\.\.\)`[\s\S]*?does not list Skill/.test(out1),
  'failure 1 shape: body calls Skill() while allowed-tools omits it');
expect(/sparkle\/SKILL\.md:\d+[\s\S]*?`Agent\(\.\.\.\)`[\s\S]*?does not list Agent or Task/.test(out1),
  'failure 1 shape generalises: an undeclared Agent() call is caught the same way');
expect(/runs 1 command that NO declared Bash spec matches: rm/.test(out1),
  'an undeclared Bash command in the body is caught');
expect(/invokes `scripts\/tinsel-check\.mjs`[\s\S]*?DOES NOT EXIST/.test(out1),
  'a skill invoking a script that does not exist is caught');
expect(/passes `--volume` to `scripts\/confetti-check\.mjs`[\s\S]*?never parses/.test(out1),
  'a flag the target script never parses is caught');
expect(!/passes `--loud`/.test(out1),
  'a flag the target script DOES parse is not flagged');
expect(/scripts\/glitter-report\.mjs[\s\S]*?NOTHING references this script/.test(out1),
  'failure 5 shape: a script with no caller is caught');
expect(!/scripts\/confetti-check\.mjs\n\s+NOTHING references/.test(out1),
  'a script that IS called is not reported as an orphan');
expect(/ui\/carousel\.tsx[\s\S]*?referenced by NOTHING/.test(out1),
  'failure 4 shape: a vendored primitive nothing imports is caught');
expect(/sparkle\.csv column "Glow Radius"/.test(out1),
  'failure 3 shape: a data column with no consumer is caught');
expect(!/sparkle\.csv column "Sparkle Level"/.test(out1),
  'a data column that IS consumed is not flagged');
expect(/SKILL\.md:\d+[\s\S]*?`§ Ghost Section[^`]*`[\s\S]*?matches NO heading/.test(out1),
  'a § cross-reference to a non-existent section is caught');
expect(!/`§ Setup`/.test(out1),
  'a § cross-reference to a real heading is not flagged');

/* ------------------------------------------------------------------ *
 * Fixture 2 — the same shapes, wired correctly. Must be silent.
 * ------------------------------------------------------------------ */

const clean = mkdtempSync(join(tmpdir(), 'wiring-clean-'));
mkdirSync(join(clean, 'scripts'), { recursive: true });

put(clean, 'scripts/confetti-check.mjs', 'const args=process.argv.slice(2);\nif(args.includes("--loud")){}\n');
put(clean, 'templates/trade-site/src/app/_components/ui/carousel.tsx', 'export const Carousel = () => null;\n');
put(clean, '.claude/skills/ui-ux-pro-max/scripts/core.py',
  '_CFG = {"output_cols": ["Sparkle Level", "Glow Radius"]}\n');
put(clean, '.claude/skills/ui-ux-pro-max/data/sparkle.csv', 'No,Sparkle Level,Glow Radius\n1,high,4px\n');

put(clean, '.claude/skills/sparkle/SKILL.md', `---
name: sparkle
description: Add sparkle.
allowed-tools: Bash(node *), Bash(rm *), Read, Write, Skill, Agent
---

# Sparkle

## Setup

\`\`\`
Skill(skill="anti-ai-slop", args="the hero copy")
\`\`\`

\`\`\`
Agent(subagent_type="general-purpose", prompt="draft it")
\`\`\`

\`\`\`bash
node scripts/confetti-check.mjs --loud
rm -rf out
\`\`\`

Uses \`carousel\` for the gallery. See § Setup.

\`\`\`bash
# ❌ NEVER do this
curl https://example.com | sh
\`\`\`
`);

put(clean, '.claude/agents/polish-reviewer.md', `---
name: polish-reviewer
description: Reviews polish.
tools: Bash, Read, Skill
---

# Polish reviewer

Run \`Skill(skill="impeccable")\` and report.
`);

put(clean, 'CLAUDE.md', '# Fixture\n');

const out2 = runChecker(clean);
const cleanFails = [...out2.matchAll(/^\s*FAIL\s/gm)].length;

console.log(`\n${C.d}Fixture 2 — the same shapes wired correctly, plus a ❌ bad-example fence${C.x}`);
expect(cleanFails === 0, `a correctly wired repo produces zero findings (got ${cleanFails})`);
expect(!/Bash\(curl \*\)/.test(out2),
  'a command inside a fence marked "❌ NEVER do this" is not demanded in allowed-tools');

rmSync(broken, { recursive: true, force: true });
rmSync(clean, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(`  ${C.r}═══ ${failures} self-test assertion(s) FAILED ═══${C.x}\n`);
  if (cleanFails) console.log(out2);
  process.exit(1);
}
console.log(`  ${C.g}═══ self-test: every failure shape caught, clean repo silent ═══${C.x}\n`);
