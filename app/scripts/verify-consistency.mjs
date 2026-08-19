#!/usr/bin/env node
/**
 * verify-consistency.mjs — contradiction and drift detector for the rule corpus.
 *
 * WHY THIS EXISTS
 * ---------------
 * `build/SKILL.md` (~2,000 lines), `qa-reviewer.md` (~540) and `CLAUDE.md` (~600) have grown by
 * accretion. When two rules in that corpus disagree, the model follows **whichever instruction sits
 * nearest the work**, and the unenforced one beats the enforced one. Every one of these is a real,
 * measured failure from this repo:
 *
 *   - a line calling `saturated` "usually the right answer for a trade site" sat 15 lines under a
 *     table naming NEUTRAL-CANVAS the default  ->  a mono-navy site the operator rejected on sight.
 *   - "skip the consult's font recommendation" beat the precedence table that assigned typography
 *     to the consult  ->  a Vogue fashion didone shipped on a Texas HVAC contractor.
 *   - `Bodoni_Moda` as the literal font-loading CODE EXAMPLE beat the prose banning display serifs.
 *     Examples beat rules.
 *   - `qa-reviewer.md` licensed deleting a route `build/SKILL.md` required creating.
 *
 * Spot-reading cannot find these: the two halves are usually hundreds of lines apart or in
 * different files, and each half reads as correct on its own. This does.
 *
 * WHAT IT CHECKS
 *   1. DEFAULT-CONFLICT      two rules naming different members of one vocabulary as "the default"
 *   2. THRESHOLD-DRIFT       one measured rule, two numbers — including prose vs the ENFORCING SCRIPT
 *   3. ENFORCEMENT-CLAIM     prose says a rule "fails the build"; the script only WARNs (or is silent)
 *   4. EXAMPLE-VS-RULE       a name banned in prose that still appears inside a fenced code block
 *   5. STALE-REF             dead `§ Section` refs, missing scripts, "X was deleted" where X exists
 *   6. CONTRACT-DRIFT        a contract two files claim to share verbatim, with different item counts
 *   7. DIRECTIVE-CLASH       one rule requires the exact thing another forbids (same object)
 *   8. ORPHANED-ENFORCEMENT  a script hard-FAILs on a token no rule file documents
 *
 * DESIGN NOTE — PRECISION OVER RECALL, DELIBERATELY.
 * A detector with 40 false positives gets switched off, and a switched-off gate protects nothing
 * (the same reasoning behind ship-scan.mjs's WARN/FAIL split). So numbers are bound to their metric
 * by a hand-written pattern rather than "any number on a line that mentions gradients", subjects
 * come from a domain vocabulary, and anything ambiguous is emitted as a CANDIDATE rather than a
 * finding. It WILL miss contradictions that are purely semantic ("restrained" vs "bold" about the
 * same section) — those need a reader.
 *
 * USAGE
 *   node scripts/verify-consistency.mjs           # findings
 *   node scripts/verify-consistency.mjs --all     # + lower-confidence candidates
 *   node scripts/verify-consistency.mjs --json
 *   node scripts/verify-consistency.mjs --only=stale-ref,threshold-drift
 *
 * EXIT: 0 = no findings, 1 = at least one finding. Candidates never fail the run.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SHOW_ALL = argv.includes('--all');
const AS_JSON = argv.includes('--json');
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);

/* ── CORPUS ────────────────────────────────────────────────────────────────────
 * `.klaudius/base/**` and `pristine/**` are excluded on purpose: they are the vendor baseline the
 * updater diffs against, they are fenced off by deny rules, and comparing them to ours is
 * verify-skill-resolution.sh's job, not this one.
 * ──────────────────────────────────────────────────────────────────────────── */
const EXCLUDE = /(^|\/)(node_modules|clients|\.klaudius|pristine|\.next|\.git|templates|logs|\.playwright-cli|\.node_modules_cache|__pycache__)(\/|$)/;

function walk(dir, test, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (EXCLUDE.test(relative(ROOT, p))) continue;
    if (e.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

const ruleFiles = [
  join(ROOT, 'CLAUDE.md'),
  ...walk(join(ROOT, '.claude/agents'), (p) => p.endsWith('.md')),
  ...walk(join(ROOT, '.claude/skills'), (p) => p.endsWith('.md')),
].filter(existsSync);

// Scripts are the ENFORCEMENT ground truth. A prose threshold that disagrees with the script that
// blocks on it is the highest-value class here: prose is what the builder aims at, the script is
// what actually fails the build.
const SELF = fileURLToPath(import.meta.url);
const scriptFiles = walk(join(ROOT, 'scripts'), (p) => /\.mjs$/.test(p) && !p.includes('/lib/') && p !== SELF);

const short = (p) => relative(ROOT, p);

/* ── PARSE ─────────────────────────────────────────────────────────────────── */
function parse(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const inFence = new Array(lines.length).fill(false);
  const headings = [];
  const fences = [];
  let fence = null;

  lines.forEach((raw, i) => {
    const m = raw.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (m) {
      if (fence === null) { fence = { start: i, lang: m[2].trim(), body: [] }; inFence[i] = true; return; }
      fence.end = i; fences.push(fence); fence = null; inFence[i] = true; return;
    }
    if (fence) { inFence[i] = true; fence.body.push(raw); return; }
    const h = raw.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) headings.push({ level: h[1].length, text: h[2], line: i + 1 });
  });
  if (fence) { fence.end = lines.length - 1; fences.push(fence); }
  return { path, text, lines, inFence, headings, fences };
}

const docs = ruleFiles.map(parse);
const findings = [];
const add = (f) => { if (!ONLY.length || ONLY.includes(f.kind)) findings.push(f); };

const norm = (s) => s.toLowerCase().replace(/[`*_"'“”‘’]/g, '').replace(/\s+/g, ' ').trim();
const normName = (s) => norm(s).replace(/[_\s]+/g, ' ').replace(/[^a-z0-9 +-]/g, '').trim();

/* ══ 1. DEFAULT-CONFLICT ═══════════════════════════════════════════════════════
 * Two rules naming different members of the SAME vocabulary as the default.
 * The vocabulary is discovered, not hardcoded: SCREAMING-KEBAB tokens (FULL-TINT, NEUTRAL-CANVAS)
 * and enumerated flag values (`--ground` takes light | cream | deep | dark) are the two shapes this
 * corpus uses for "pick exactly one of these". Tokens co-occurring on a line are unioned into one
 * family, so the detector learns FULL-TINT and NEUTRAL-CANVAS are alternatives without being told.
 * ═════════════════════════════════════════════════════════════════════════════ */
function checkDefaultConflicts() {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const KEBAB = /\b[A-Z][A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b/g;
  const ENUM_LINE = /takes?\s+\*{0,2}([a-z]+(?:\s*\|\s*[a-z]+){2,})\*{0,2}/;
  const DEFAULT_WORD = /\b(default|right answer|correct answer)\b/i;

  const kebabTokens = new Set();
  const enumTokens = new Set();   // lowercase flag values — only counted when backticked
  const claims = new Map();

  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      const toks = [...new Set(raw.match(KEBAB) || [])];
      for (const t of toks) { kebabTokens.add(t); if (!parent.has(t)) parent.set(t, t); }
      for (let a = 0; a < toks.length; a++) for (let b = a + 1; b < toks.length; b++) union(toks[a], toks[b]);

      const em = raw.match(ENUM_LINE);
      if (em) {
        const vals = em[1].split('|').map((v) => v.trim()).filter(Boolean);
        for (const v of vals) { enumTokens.add(v); if (!parent.has(v)) parent.set(v, v); }
        for (let a = 0; a < vals.length; a++) for (let b = a + 1; b < vals.length; b++) union(vals[a], vals[b]);
      }

      const dm = raw.match(DEFAULT_WORD);
      if (!dm) return;
      const at = dm.index;
      const consider = [
        ...[...kebabTokens].map((t) => [t, raw.indexOf(t)]),
        // a lowercase enum value only counts when it appears as code (`saturated`), never as the
        // ordinary English word — that distinction is what stops "a light default" in an unrelated
        // file colliding with `--ground light`.
        ...[...enumTokens].map((t) => [t, raw.indexOf(`\`${t}\``)]),
      ];
      for (const [t, idx] of consider) {
        if (idx < 0 || Math.abs(idx - at) > 70) continue;
        const lo = Math.max(0, Math.min(idx, at) - 30);
        const hi = Math.max(idx, at) + 45;
        const negated = /\b(not|never|n't|NOT)\b/.test(raw.slice(lo, hi));
        if (!claims.has(t)) claims.set(t, []);
        claims.get(t).push({ doc: d, line: i + 1, negated, text: raw.trim() });
      }
    });
  }

  const families = new Map();
  for (const [tok, list] of claims) {
    const pos = list.filter((c) => !c.negated);
    if (!pos.length) continue;
    const fam = parent.has(tok) ? find(tok) : tok;
    if (!families.has(fam)) families.set(fam, new Map());
    families.get(fam).set(tok, pos);
  }

  for (const [, members] of families) {
    if (members.size < 2) continue;
    const rows = [...members.entries()];
    add({
      kind: 'default-conflict',
      confidence: 'high',
      subject: `${rows.map(([t]) => t).join(' vs ')} — ${rows.length} members of one either/or vocabulary each claimed as the default`,
      sides: rows.flatMap(([t, cs]) => cs.map((c) => ({
        file: short(c.doc.path), line: c.line, claim: `"${t}" = default`, text: c.text.slice(0, 190),
      }))),
      why: 'Two members of the same either/or vocabulary are each stated to be the default. The builder follows whichever it read last — this is the mono-navy failure exactly.',
    });
  }
}

/* ══ 2+3. THRESHOLD-DRIFT and ENFORCEMENT-CLAIM ════════════════════════════════
 * Each metric carries HAND-WRITTEN patterns that capture the number IN ITS OWN CONTEXT. A generic
 * "any number on a line mentioning gradients" extractor was tried first and produced 90 findings of
 * which ~6 were real — the corpus is dense with incidental numbers (dates, measured timings, past
 * build stats). Binding the number to the metric is what makes this usable.
 *
 * Semantics are normalised to a FLOOR (minimum acceptable) or CEILING (maximum acceptable), so a
 * prose "at least 4 gradients" and a script "if (gradients < 4) FAIL" compare equal instead of
 * looking like a contradiction.
 * ═════════════════════════════════════════════════════════════════════════════ */
const METRICS = [
  {
    // DECLARED gradients (counted in CSS) and PAINTED gradients (counted in a browser) are
    // deliberately different measurements in this pipeline — 9 declarations painted 2 on a real
    // build — so they are separate metrics and a difference between them is not a contradiction.
    key: 'gradient-declarations',
    prose: [
      [/(?:≥|>=|at least|no fewer than|minimum of)\s*(\d+)[^.\n]{0,25}gradient/i, 'floor'],
      [/gradient[^.\n]{0,30}?(?:≥|>=|at least)\s*(\d+)/i, 'floor'],
      [/(?:fewer than|less than|under|below)\s*(\d+)\s*gradient/i, 'floor'],
    ],
    ctx: /^(?!.*(painting|rendered|in a browser)).*$/i,
    scriptCtx: /gradient/i,
  },
  {
    key: 'gradients-painted',
    prose: [[/(?:≥|>=)\s*(\d+)\s*painting gradients/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'grain-opacity',
    prose: [
      [/grain[^.\n]{0,40}?(0\.\d+)\s*(?:–|-|to)\s*(0\.\d+)/i, 'range'],
      [/grain[^.\n]{0,60}?(?:below|under|<)\s*~?(0?\.\d+)/i, 'floor'],
      [/grain[^.\n]{0,60}?~(0?\.\d+)\s*(?:light|dark)/i, 'floor'],
    ],
    // the comparison identifier is `Math.max(...opacities)`, so match on the opacity variable
    scriptCtx: /opacit/i,
  },
  {
    key: 'section-treatments',
    prose: [
      [/(?:≥|>=|at least)\s*(\d+)[^.\n]{0,30}(?:distinct\s+)?section treatment/i, 'floor'],
      [/(?:distinct\s+)?section treatments?[^.\n|]{0,25}?\|\s*\*{0,2}(?:≥|>=)\s*(\d+)/i, 'floor'],
      [/(?:fewer than|<)\s*(\d+)\s*(?:distinct\s+)?(?:section\s+)?treatment/i, 'floor'],
    ],
    scriptCtx: /treatment/i,
  },
  {
    key: 'secondary-uses',
    prose: [
      [/--secondary[^.\n|]{0,40}?\|\s*\*{0,2}(?:≥|>=)\s*(\d+)/i, 'floor'],
      [/(?:≥|>=|at least)\s*(\d+)\s*(?:references?|uses?)[^.\n]{0,20}secondary/i, 'floor'],
      [/--secondary[^.\n]{0,40}?(?:≥|>=|at least)\s*(\d+)\s*references?/i, 'floor'],
    ],
    scriptCtx: /secondary/i,
  },
  {
    key: 'photo-grounded-sections',
    prose: [
      [/(?:≥|>=|at least|fewer than)\s*(\d+)[^.\n]{0,30}photo-?grounded/i, 'floor'],
      [/photo-?grounded[^.\n|]{0,40}?\|\s*\*{0,2}(?:≥|>=)\s*(\d+)/i, 'floor'],
    ],
    scriptCtx: /photoGround/i,
  },
  {
    key: 'page-word-stub-floor',
    prose: [[/(?:under|below)\s*~?(\d+)\s*(?:rendered\s+)?words?/i, 'floor'], [/~(\d+)-word stub floor/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'font-lookback-window',
    prose: [[/last\s*(\d+)\s*(?:other\s*)?(?:builds?|records?)/i, 'value']],
    scriptCtx: /LOOKBACK/,
  },
  {
    key: 'article-word-range',
    prose: [[/(\d{3})\s*(?:to|–|-)\s*(\d{3})\s*words/i, 'range']],
    // without this the blog article length (700-950) groups with the privacy-page length
    // (250-450) — same unit, different subject, not a contradiction.
    ctx: /article|blog/i,
    scriptCtx: null,
  },
  {
    key: 'marquee-seconds',
    prose: [[/(\d{2})\s*(?:–|-|to)\s*(\d{2})\s*second/i, 'range'], [/marquee[^.\n]{0,60}?(\d{2})\s*(?:–|-|to)\s*(\d{2})/i, 'range']],
    scriptCtx: null,
  },
  {
    key: 'scale-drama-ratio',
    prose: [[/(?:≥|>=)\s*([\d.]+)\s*[x×]/i, 'floor']],
    // anchored, or it collects every "≥44x44pt" touch-target and "≥1.5x sibling area" rule as
    // though they were the same measurement
    ctx: /scale drama|largest heading/i,
    scriptCtx: null,
  },
  {
    key: 'dominant-element-ratio',
    prose: [[/dominant element[^|\n]*\|[^|\n]*?(?:≥|>=)\s*([\d.]+)\s*[x×]/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'nav-dropdown-page-threshold',
    prose: [[/(?:≥|>=|when)\s*(\d+)\s*dedicated/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'services-route-threshold',
    prose: [[/(?:≥|>=|at least)\s*(\d+)\s*distinct\s+(?:named\s+)?services/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'identical-sibling-run',
    prose: [[/(\d+)\+?\s*(?:same-class|identical)\s*(?:cards?|panels?|siblings?|blocks?|headings?)/i, 'floor'],
            [/(?:run of\s*)?(\d+)\+?\s*visually-?uniform blocks/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'gallery-void-pct',
    prose: [[/(?:value of\s*)?(\d+)\s*or more is a hard FAIL/i, 'floor'], [/GALLERY_VOID_PCT[^.\n]{0,60}?(\d+)/i, 'floor']],
    scriptCtx: /GALLERY_VOID|voidPct/i,
  },
  {
    key: 'input-font-size-px',
    prose: [[/inputs?\s*(?:>=|≥)\s*(\d+)\s*px/i, 'floor'], [/(\d+)px[^.\n]{0,40}(?:input|focused input)/i, 'floor']],
    scriptCtx: null,
  },
  {
    key: 'body-font-size-px',
    prose: [[/body copy[^.\n]{0,30}?(?:>=|≥)\s*(\d+)\s*px/i, 'floor'], [/(?:below|under)\s*(\d+)\s*px[^.\n]{0,30}body/i, 'floor']],
    scriptCtx: /fontSize|\bfs\b/,
  },
  {
    key: 'logo-nav-height-floor',
    prose: [[/nav height minimum\s*`?h-(\d+)`?/i, 'floor'], [/`h-(\d+)`\/`h-\d+` is the new floor/i, 'floor']],
    scriptCtx: null,
  },
];

/**
 * Extract (metric, kind, value) from prose. A metric may require a CONTEXT match against the line
 * plus its nearest heading — that is what keeps "700 to 950 words" (an article, under § Shape of an
 * article) from grouping with "250-450 words" (a privacy page) purely because both end in "words".
 */
function proseNumbers(source, d) {
  const out = [];
  d.lines.forEach((raw, i) => {
    if (d.inFence[i]) return;
    const h = [...d.headings].reverse().find((x) => x.line <= i + 1);
    const context = `${h ? h.text : ''} ${raw}`;
    for (const m of METRICS) {
      if (m.ctx && !m.ctx.test(context)) continue;
      for (const [re, kind] of m.prose) {
        const hit = raw.match(re);
        if (!hit) continue;
        const vals = hit.slice(1).filter(Boolean).map(parseFloat).filter((v) => !Number.isNaN(v));
        if (!vals.length) continue;
        out.push({
          source, line: i + 1, metric: m.key, kind,
          value: kind === 'range' ? vals.join('-') : vals[0],
          text: raw.trim().slice(0, 190),
        });
      }
    }
  });
  return out;
}

/**
 * Extract enforcement thresholds from a script. A comparison inside (or just above) a
 * `failures.push` / `warnings.push` branch is the real rule: `if (gradients < 4) failures.push(...)`
 * means FLOOR 4, enforced at FAIL severity.
 */
function scriptThresholds(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const out = [];
  lines.forEach((raw, i) => {
    const cmp = raw.match(/([A-Za-z_$][\w.$]*(?:\([^)]*\))?)\s*(<=|>=|<|>|===|!==)\s*([\d.]+)/);
    const constDecl = raw.match(/const\s+([A-Z_]{4,})\s*=\s*(\d+)/);
    if (!cmp && !constDecl) return;

    // what severity does this branch carry? look forward a few lines for the push
    const fwd = lines.slice(i, i + 8).join('\n');
    const severity = /failures\.push/.test(fwd) ? 'FAIL' : /warnings\.push/.test(fwd) ? 'WARN' : null;

    for (const m of METRICS) {
      if (!m.scriptCtx) continue;
      if (constDecl) {
        if (!m.scriptCtx.test(constDecl[1])) continue;
        out.push({ source: `${short(path)} [SCRIPT]`, line: i + 1, metric: m.key, kind: 'value', value: parseFloat(constDecl[2]), severity: 'const', text: raw.trim().slice(0, 190) });
        continue;
      }
      if (!severity) continue;
      // Match the COMPARED IDENTIFIER, never a surrounding window. A window match pulled in
      // `secChroma < 0.04` as a "--secondary" threshold and `secClasses.length >= 3` as a gradient
      // ceiling, purely from nearby prose — the identifier is the only reliable binding.
      if (!m.scriptCtx.test(cmp[1])) continue;
      // `x < N` failing means N is the FLOOR; `x > N` failing means N is the CEILING.
      const kind = ['<', '<='].includes(cmp[2]) ? 'floor' : ['>', '>='].includes(cmp[2]) ? 'ceiling' : 'value';
      out.push({
        source: `${short(path)} [SCRIPT]`, line: i + 1, metric: m.key, kind,
        value: parseFloat(cmp[3]), severity, text: raw.trim().slice(0, 190),
      });
    }
  });
  return out;
}

function checkThresholdDrift() {
  const rows = [];
  for (const d of docs) rows.push(...proseNumbers(short(d.path), d));
  for (const p of scriptFiles) rows.push(...scriptThresholds(p));

  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.metric}|${r.kind}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  for (const [k, g] of byKey) {
    const [metric, kind] = k.split('|');
    const values = [...new Set(g.map((r) => String(r.value)))];
    if (values.length < 2) continue;
    if (new Set(g.map((r) => `${r.source}:${r.line}`)).size < 2) continue;
    const hasScript = g.some((r) => r.source.includes('[SCRIPT]'));
    const crossFile = new Set(g.map((r) => r.source)).size > 1;
    if (!hasScript && !crossFile) continue;                        // same-file, same-line noise
    add({
      kind: 'threshold-drift',
      confidence: 'high',
      subject: `${metric} (${kind}) stated as ${values.sort().join(' / ')}`,
      sides: g.map((r) => ({
        file: r.source, line: r.line,
        claim: `${kind} ${r.value}${r.severity ? ` [${r.severity}]` : ''}`,
        text: r.text,
      })),
      why: hasScript
        ? 'A prose threshold disagrees with the script that actually blocks the build. The prose is what the builder aims at; the script is what fails it.'
        : 'The same measured rule is stated with two different numbers in two files. Whichever is read last wins.',
    });
  }
}

/**
 * ENFORCEMENT-CLAIM: prose asserts a rule is script-enforced and fails the build, but the script
 * only WARNs on it (or has no such threshold at all). The rule then reads as harder than it is,
 * and a build can ship under it — the exact reason the gradient rule was promoted WARN -> FAIL.
 */
function checkEnforcementClaims() {
  const scriptRows = [];
  for (const p of scriptFiles) scriptRows.push(...scriptThresholds(p));

  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      // a hard-rules table row: | N | Rule | threshold | ✅ |
      if (!/\|\s*(✅|⏳)\s*\|?\s*$/.test(raw)) return;
      const enforced = raw.includes('✅');
      if (!enforced) return;
      for (const m of METRICS) {
        if (!m.scriptCtx) continue;
        const proseHit = m.prose.map(([re]) => raw.match(re)).find(Boolean);
        if (!proseHit) continue;
        const claimed = parseFloat(proseHit[1]);
        const mine = scriptRows.filter((r) => r.metric === m.key);
        const fails = mine.filter((r) => r.severity === 'FAIL');
        if (!fails.length) {
          add({
            kind: 'enforcement-claim',
            confidence: 'high',
            subject: `${m.key} marked ✅ "enforced, fails the build" — no FAIL branch found in any script`,
            sides: [{ file: short(d.path), line: i + 1, claim: 'claims script-enforced', text: raw.trim().slice(0, 190) }],
            why: 'A rule marked as script-enforced that no script actually fails on. The builder treats it as a hard gate; nothing stops a build that violates it.',
          });
          continue;
        }
        const strictest = Math.max(...fails.map((r) => r.value));
        if (!Number.isNaN(claimed) && claimed > strictest) {
          add({
            kind: 'enforcement-claim',
            confidence: 'high',
            subject: `${m.key}: prose claims ✅ enforced at ${claimed}, script only FAILs at ${strictest}`,
            sides: [
              { file: short(d.path), line: i + 1, claim: `claims enforced ≥ ${claimed}`, text: raw.trim().slice(0, 190) },
              ...fails.map((r) => ({ file: r.source, line: r.line, claim: `real FAIL floor ${r.value}`, text: r.text })),
            ],
            why: 'The stated threshold is stricter than the gate. A build between the two numbers violates the written rule and still passes every check — so the rule is advisory while presenting itself as enforced.',
          });
        }
      }
    });
  }
}

/* ══ 4. EXAMPLE-VS-RULE ════════════════════════════════════════════════════════
 * A name banned in prose that still appears inside a fenced code block. The Bodoni_Moda class:
 * examples beat rules, so a banned value used as a mechanism demonstration reads as a
 * recommendation.
 * ═════════════════════════════════════════════════════════════════════════════ */
// Generic CSS keywords are on the banned-font list because you must not CHOOSE them — but every
// correct font stack ends in one. Reported as a candidate (the ban is literally unfollowable as
// written), never as a finding.
const GENERIC_CSS = new Set(['sans-serif', 'serif', 'system-ui', 'monospace', 'cursive']);
// A conditional ban ("never write a srcSet REFERENCING a file that does not exist") is not a ban on
// the thing itself. These words, following the object, mark the ban as conditional.
const QUALIFIER = /^\s*(referencing|that|which|when|unless|with|for|in|on|as|to|if|whose|purely|only|combine|without|before|after|from|and)\b/i;

function collectBans() {
  const bans = new Map();
  const HEAD_BAN = /\b(banned|avoid|never use|do not use|overused)\b/i;

  for (const d of docs) {
    d.headings.forEach((h, idx) => {
      if (!HEAD_BAN.test(h.text)) return;
      const next = d.headings[idx + 1];
      const stop = next ? next.line - 1 : Math.min(h.line + 8, d.lines.length);
      for (let i = h.line; i < stop; i++) {
        const raw = (d.lines[i] || '').trim();
        if (!raw || raw.startsWith('#') || d.inFence[i] || raw.length > 400) continue;
        for (const piece of raw.replace(/\(.*?\)/g, '').split(/,|;| and /)) {
          const name = piece.replace(/^[-*\s]+/, '').replace(/[.!—]$/, '').trim();
          if (!/^[A-Za-z][A-Za-z0-9 '+-]{2,30}$/.test(name)) continue;
          if (/^(every|they|use|the|and|a|an|only|acceptable|no longer|now|it|is|are)\b/i.test(name)) continue;
          const key = normName(name);
          if (!key || key.split(' ').length > 4) continue;
          if (!bans.has(key)) bans.set(key, { file: short(d.path), line: i + 1, name, text: raw.slice(0, 160), heading: h.text });
        }
      }
    });

    d.lines.forEach((raw, i) => {
      if (d.inFence[i]) return;
      const m = raw.match(/\bNEVER\s+(?:use|ship|write|put|add|reach for)\s+(?:a\s+|an\s+|the\s+)?[`"']?([A-Za-z][\w .:/-]{2,40}?)[`"']?(?=\s|,|\.|\*|$)/i);
      if (!m) return;
      // conditional ban -> the object is not banned outright
      if (QUALIFIER.test(raw.slice(m.index + m[0].length))) return;
      const key = normName(m[1]);
      if (!key || key.split(' ').length > 4) return;
      if (!bans.has(key)) bans.set(key, { file: short(d.path), line: i + 1, name: m[1], text: raw.trim().slice(0, 160), heading: 'inline NEVER' });
    });
  }
  return bans;
}

function checkExampleVsRule() {
  const bans = collectBans();
  const checkable = [...bans.entries()].filter(([key, v]) => key.length >= 5 && (/[A-Z]/.test(v.name) || /-/.test(v.name)));

  for (const d of docs) {
    for (const f of d.fences) {
      if (!f.body.join('').trim()) continue;
      const near = d.lines.slice(Math.max(0, f.start - 3), f.start).join(' ');
      // a fence that IS the ban check (a grep asserting absence) is not a recommendation
      if (/\bnever\b|\bbanned\b|\bavoid\b|must be empty|must be 0|MUST be 0/i.test(near)) continue;
      for (const [key, ban] of checkable) {
        const pat = new RegExp(`(^|[^A-Za-z0-9_])${key.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ _-]')}($|[^A-Za-z0-9_])`, 'i');
        const at = f.body.findIndex((l) => pat.test(l) && !/grep|must be|MUST be/i.test(l));
        if (at < 0) continue;
        const generic = GENERIC_CSS.has(key);
        add({
          kind: 'example-vs-rule',
          confidence: generic ? 'medium' : 'high',
          subject: generic
            ? `banned list contains the generic CSS keyword "${ban.name}", which every correct font stack must end in`
            : `code example uses "${ban.name}", banned in prose`,
          sides: [
            { file: short(d.path), line: f.start + 2 + at, claim: 'CODE EXAMPLE', text: (f.body[at] || '').trim().slice(0, 190) },
            { file: ban.file, line: ban.line, claim: `BAN — ${ban.heading}`, text: ban.text },
          ],
          why: generic
            ? 'The ban as written cannot be obeyed: a fallback stack without a generic family is invalid CSS. The ban means "never CHOOSE this as the typeface" and should say so.'
            : 'Examples beat rules. A banned value used as a mechanism demonstration is read as a recommendation — exactly how a Vogue didone shipped on an HVAC contractor.',
        });
      }
    }
  }
}

/* ══ 5. STALE-REF ══════════════════════════════════════════════════════════════ */
const STOPWORDS = /^(above|below|already|and|or|the|which|says?|is|are|was|for|with|to|in|of|its|it|this|that|exists?|extends?|requires?|gives?|puts?|makes?|so|then|but|a|an|here|now|too|also|still|only|said|there|verbatim)$/i;

// Strip list numbering, emoji and decoration so "### 3. Copy quality system" and
// "## ⛔ HARD-BLOCKER CONTRACT" are matchable by their real names.
const headingKey = (s) => norm(s)
  .replace(/^[^a-z0-9]*/i, '')
  .replace(/^\d+[a-z]?\.?\s*/, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokens = (s) => headingKey(s.replace(/['’]s\b/g, '')).split(' ').filter(Boolean);

/**
 * Turn a `§ ...` reference into the tokens that actually name a section.
 *
 * Two shapes, handled differently, because getting this wrong in either direction is expensive:
 *  - QUOTED (`§ "Photo art direction"`) — the quotes delimit the name exactly, so use all of it.
 *    This is what lets a dead ref like "Photo art direction" be distinguished from the live
 *    heading "Photo selection", which shares its first word.
 *  - UNQUOTED (`§ Blog's bucket-2 trade-craft prose`) — the ref bleeds into the sentence, so stop
 *    at the first lowercase word. Headings here start capitalised; running prose does not.
 */
function refTokens(raw, quoted) {
  const cleaned = raw.replace(/^§\s*/, '').replace(/['’]s\b/g, '').replace(/["'`]/g, '');
  const words = cleaned.split(/\s+/);
  const kept = [];
  for (const w of words) {
    const closed = /[.,;:)]$/.test(w);          // punctuation ends the heading name
    const bare = w.replace(/[.,;:)]+$/, '');
    if (!bare) continue;
    const t = headingKey(bare);
    if (!t) { if (kept.length) break; continue; }
    if (!quoted && kept.length >= 1) {
      const startsLower = /^[a-z]/.test(bare.replace(/^[^A-Za-z]*/, ''));
      if (startsLower || STOPWORDS.test(t)) break;
    }
    kept.push(t);
    if (closed || kept.length >= 8) break;
  }
  // `§ build/SKILL.md's design-system step` names a FILE, not a section — not a dead heading ref
  if (/[./]|SKILL|CLAUDE/.test(words[0] || '')) return [];
  return kept.join(' ').split(' ').filter(Boolean);
}

function checkStaleRefs() {
  // Targets are collected PER FILE: every heading, every bold pseudo-heading, and `# § Name`
  // anchors inside code fences (the deploy skill uses those as markers inside one long bash block).
  //
  // File-locality matters. A corpus-wide target pool silently resolved cms/SKILL.md's "§ Abort
  // path" against a similarly-named section in a different skill — the reader following that ref
  // inside the CMS skill finds nothing, which is exactly the defect. A `§` ref resolves against its
  // OWN file, plus any file it names on the same line.
  const targetsByFile = new Map();
  const push = (file, t) => {
    if (!t.length) return;
    if (!targetsByFile.has(file)) targetsByFile.set(file, []);
    targetsByFile.get(file).push(t);
  };
  for (const d of docs) {
    const f = short(d.path);
    for (const h of d.headings) push(f, tokens(h.text));
    d.lines.forEach((raw, i) => {
      const b = raw.match(/^\s*\*\*(.{4,70}?)\*\*/);
      if (b) push(f, tokens(b[1]));
      const anchor = d.inFence[i] && raw.match(/^\s*#\s*§\s*(.+)$/);
      if (anchor) push(f, tokens(anchor[1]));
    });
  }

  const sources = [
    ...docs.map((d) => ({ name: short(d.path), lines: d.lines })),
    ...scriptFiles.map((p) => ({ name: short(p), lines: readFileSync(p, 'utf8').split('\n') })),
  ];

  // A `§ NAME` that sits at the START of a line's content is a section MARKER, not a reference —
  // scripts use them to name blocks inside a long header comment (`* § MASKING — ...`), and the
  // deploy skill uses them inside one long bash fence (`# § Shared instance`). Collect those as
  // resolvable targets, or every self-reference inside those files reads as a dead ref.
  for (const s of sources) {
    for (const raw of s.lines) {
      const body = raw.replace(/^\s*(?:[*#/]+|\/\/|--)?\s*/, '');
      if (!body.startsWith('§')) continue;
      push(s.name, tokens(body.replace(/^§\s*/, '').split(/\s+[—–-]\s+/)[0]));
    }
  }

  for (const s of sources) {
    s.lines.forEach((raw, i) => {
      if (!raw.includes('§')) return;
      const body = raw.replace(/^\s*(?:[*#/]+|\/\/|--)?\s*/, '');
      if (body.startsWith('§')) return;                 // this line DEFINES a marker, not a ref
      // A script's § refs are only in scope when they point INTO the rule corpus — a script naming
      // its own internal header sections (`§ MASKING`) is documenting itself, not the skills. The
      // ones that matter name a .md file or quote the section exactly, as richness-check.mjs does.
      const isScript = /\.mjs$/.test(s.name);
      if (isScript && !/\.md\b/.test(raw) && !/§\s*"/.test(raw)) return;
      for (const m of raw.matchAll(/§\s*(?:"([^"\n]{2,70})"|([A-Za-z][^\n]{2,70}))/g)) {
        // `§ Name` in backticks is a meta-mention of the syntax, not a reference to a section
        if (raw[m.index - 1] === '`') continue;
        const quoted = m[1] !== undefined;
        const rt = refTokens(quoted ? m[1] : m[2], quoted);
        if (!rt.length) continue;
        // Scope = the ref's own file, plus any file the line names — either as a path
        // (`build/SKILL.md`) or as a slash-command (`/build`, `/seo`), which is how CLAUDE.md and
        // the agent file cite skills.
        const scope = [...(targetsByFile.get(s.name) || [])];
        for (const nm of raw.matchAll(/([A-Za-z0-9_./-]+\.md)/g)) {
          for (const [f, ts] of targetsByFile) if (f.endsWith(nm[1]) || nm[1].endsWith(basename(f))) scope.push(...ts);
        }
        for (const nm of raw.matchAll(/[`/]([a-z][a-z-]{2,})\b/g)) {
          const ts = targetsByFile.get(`.claude/skills/${nm[1]}/SKILL.md`);
          if (ts) scope.push(...ts);
        }
        const targets = scope;
        // resolve on a WORD-PREFIX relation: the ref's tokens are a prefix of a heading's tokens,
        // or vice versa. "§ Blog" resolves to "## Blog (MANDATORY...)"; "§ Colour CHARACTER"
        // resolves to nothing, which is the real defect.
        const matches = (ht) => {
          if (!ht.length) return false;
          const n = Math.min(rt.length, ht.length);
          for (let k = 0; k < n; k++) if (rt[k] !== ht[k]) return false;
          return true;
        };
        if (targets.some(matches)) continue;
        // Not resolvable in scope. If it resolves SOMEWHERE in the corpus the ref is merely
        // under-qualified (a reader has to guess which file) — a candidate, not a finding. If it
        // resolves nowhere at all, the section is genuinely gone.
        const elsewhere = [...targetsByFile.entries()].find(([, ts]) => ts.some(matches));
        add({
          kind: 'stale-ref',
          confidence: elsewhere ? 'medium' : 'high',
          subject: elsewhere
            ? `under-qualified § ref: "${rt.join(' ')}" exists only in ${elsewhere[0]}, which this line does not name`
            : `dead § ref: "${rt.join(' ')}"`,
          sides: [{ file: s.name, line: i + 1, claim: elsewhere ? 'resolves only in another file' : 'points at no heading anywhere', text: raw.trim().slice(0, 190) }],
          why: elsewhere
            ? 'The section exists, but in a file this line never names — a reader following the ref inside this file finds nothing.'
            : 'A cross-reference to a section that was renamed or deleted. The rule it points at is unreachable, so whatever it was guarding is now unstated.',
        });
      }
    });
  }

  // Every real basename in the repo (templates included — a client site's `next.config.mjs` is a
  // real file that ships in templates/trade-site, so a reference to it is not dangling).
  const realNames = new Set();
  for (const p of walk(ROOT, () => true)) realNames.add(basename(p));
  for (const p of walk(join(ROOT, 'templates/trade-site'), (x) => !x.includes('node_modules'))) realNames.add(basename(p));

  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      if (/\$\{|\{slug\}|\$ARGUMENTS|<slug>/.test(raw)) return;
      // an illustrative filename, or a file belonging to a different repo, is not our dangling ref
      if (/\be\.g\.|for example|gr-no-website-builds|gray-reserve\b/i.test(raw)) return;
      for (const m of raw.matchAll(/`([A-Za-z0-9_./-]+\.(?:mjs|js|sh|py|csv))`/g)) {
        const p = m[1];
        if (/^(node_modules|https?:)/.test(p) || p.includes('*')) continue;
        if (/^(clients|out|src|public|site|app|data)\//.test(p)) continue;
        if (realNames.has(basename(p))) continue;
        if ([join(ROOT, p), join(dirname(d.path), p), join(ROOT, 'scripts', basename(p)),
             join(ROOT, '.claude/skills', p)].some(existsSync)) continue;
        add({
          kind: 'stale-ref',
          confidence: 'high',
          subject: `referenced script does not exist: ${p}`,
          sides: [{ file: short(d.path), line: i + 1, claim: 'missing file', text: raw.trim().slice(0, 190) }],
          why: 'An instruction naming a file that is not on disk cannot execute, and nothing errors — the step is simply skipped (precedence rule 5: silence is not permission).',
        });
      }
    });
  }

  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      if (!/\b(deleted|are gone|is gone|removed|no longer (exist|exists|run|runs|ship|ships)|retired)\b/i.test(raw)) return;
      for (const m of raw.matchAll(/`([A-Za-z0-9_./-]+\.(?:mjs|js|sh|md|json))`/g)) {
        const n = m[1];
        const p = existsSync(join(ROOT, n)) ? join(ROOT, n)
          : existsSync(join(ROOT, 'scripts', basename(n))) ? join(ROOT, 'scripts', basename(n)) : null;
        if (!p) continue;
        add({
          kind: 'stale-ref',
          confidence: 'high',
          subject: `claimed deleted but still on disk: ${n}`,
          sides: [
            { file: short(d.path), line: i + 1, claim: 'claims removal', text: raw.trim().slice(0, 190) },
            { file: short(p), line: 0, claim: 'still present', text: `${statSync(p).size} bytes` },
          ],
          why: 'A dated claim of removal contradicted by the filesystem. Either the removal never happened or the doc was never updated — both mislead the next reader.',
        });
      }
    });
  }
}

/* ══ 6. CONTRACT-DRIFT ═════════════════════════════════════════════════════════
 * A contract two files claim to share "verbatim, zero drift", holding different numbers of items.
 * This is the case where the builder is graded on a checklist it was never given — or an item is
 * added to one copy and silently dropped from the count in both.
 * ═════════════════════════════════════════════════════════════════════════════ */
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const toNum = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : WORDNUM[String(s).toLowerCase()]);

function checkContractDrift() {
  // find every section that IS a contract, in any file
  const copies = [];
  for (const d of docs) {
    d.headings.forEach((h, idx) => {
      if (!/contract|hard-?blocker/i.test(h.text)) return;
      const next = d.headings[idx + 1];
      const start = h.line;
      const stop = next ? next.line - 1 : d.lines.length;
      const body = d.lines.slice(start, stop);
      const items = body.filter((l, k) => /^\s*\d+\.\s+\*\*/.test(l) && !d.inFence[start + k]).length;
      const stated = [];
      for (const l of body) {
        for (const m of l.matchAll(/\b(?:all|these|the|identical)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*(?:of\s+(?:them|these)\s+)?(?:check|checks|booleans?|items?|FALSE)/gi)) {
          const n = toNum(m[1]);
          if (n) stated.push(n);
        }
      }
      copies.push({ file: short(d.path), line: h.line, heading: h.text, items, stated: [...new Set(stated)] });
    });
  }
  // A contract is also SIZED from outside its own section — CLAUDE.md's QA loop tells the
  // orchestrator how many booleans to expect without holding a copy of the list. Those references
  // drift independently, and a paragraph that says "all 6 are FALSE" three lines above "the 5
  // booleans" is contradicting itself where nobody is looking for a contract at all.
  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      if (!/hard-?blocker contract/i.test(raw)) return;
      const win = d.lines.slice(i, i + 8);
      const sizes = new Map();
      win.forEach((l, k) => {
        for (const m of l.matchAll(/\b(?:all|these|the)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:are\s+)?(?:of\s+(?:them|these)\s+)?(?:check|checks|booleans?|items?|FALSE)/gi)) {
          const n = toNum(m[1]);
          if (n && !sizes.has(n)) sizes.set(n, { line: i + k + 1, text: l.trim().slice(0, 190) });
        }
      });
      if (sizes.size < 2) return;
      add({
        kind: 'contract-drift',
        confidence: 'high',
        subject: `the hard-blocker contract is sized as ${[...sizes.keys()].sort().join(' and ')} in the same paragraph`,
        sides: [...sizes.entries()].map(([n, v]) => ({ file: short(d.path), line: v.line, claim: `${n} items`, text: v.text })),
        why: 'One passage gives two sizes for the same contract. Whichever the orchestrator acts on, one item is either graded against nothing or demanded from a report that never carries it.',
      });
    });
  }

  if (!copies.length) return;

  // 6a. a copy whose enumerated item count disagrees with its own stated count
  for (const c of copies) {
    for (const s of c.stated) {
      if (!c.items || s === c.items) continue;
      add({
        kind: 'contract-drift',
        confidence: 'high',
        subject: `§ ${c.heading} — text says "${s}" but the section enumerates ${c.items} items`,
        sides: [{ file: c.file, line: c.line, claim: `stated ${s}, enumerated ${c.items}`, text: c.heading }],
        why: 'The count and the list disagree inside one contract. The item added last is the one nothing counts, so nothing enforces it.',
      });
    }
  }

  // 6b. two copies of the same contract with different item counts
  for (let a = 0; a < copies.length; a++) {
    for (let b = a + 1; b < copies.length; b++) {
      const x = copies[a]; const y = copies[b];
      if (x.file === y.file) continue;
      if (!x.items || !y.items) continue;
      if (x.items === y.items) continue;
      add({
        kind: 'contract-drift',
        confidence: 'high',
        subject: `"${x.heading}" (${x.items} items) vs "${y.heading}" (${y.items} items) — two copies of one contract`,
        sides: [
          { file: x.file, line: x.line, claim: `${x.items} items${x.stated.length ? `, says ${x.stated.join('/')}` : ''}`, text: x.heading },
          { file: y.file, line: y.line, claim: `${y.items} items${y.stated.length ? `, says ${y.stated.join('/')}` : ''}`, text: y.heading },
        ],
        why: 'Two files hold copies of one contract that is declared to be shared verbatim, with different numbers of items. The grader is checking a different list from the one the builder was given.',
      });
    }
  }
}

/* ══ 7. DIRECTIVE-CLASH ════════════════════════════════════════════════════════
 * One rule requires the exact thing another forbids. Naive polarity matching on a shared subject
 * produced mostly noise (two rules that AGREE, one phrased positively and one negatively), so the
 * clash must be on the same OBJECT: a shared code token, path, or quoted identifier, with opposed
 * verbs from the same family.
 * ═════════════════════════════════════════════════════════════════════════════ */
const VERB = '(?:use|used|using|write|writing|ship|shipping|add|adding|create|creating|build|building|put|render|rendering|include|including|be)';
const POS_RE = new RegExp(`\\b(?:MUST|must|ALWAYS|always|required to|has to|have to|need to|needs to)\\s+(?:\\w+\\s+){0,2}?${VERB}\\b`);
const NEG_RE = new RegExp(`\\b(?:NEVER|never|do NOT|do not|don't|must not|cannot|no)\\s+(?:\\w+\\s+){0,2}?${VERB}\\b`);

/**
 * The object of a directive, bound by PROXIMITY to the verb. Two rules that merely both mention
 * `gathered-content.md` are not in conflict — that file is named by half the corpus. The object
 * has to be what the verb acts on, so it must sit within 60 characters of the directive phrase.
 * Data-source filenames are excluded outright for the same reason.
 */
const DATA_FILE = /\.(md|json|csv|txt)$/;

function objectsIn(line, verbAt) {
  const objs = new Set();
  const near = (idx) => idx >= 0 && Math.abs(idx - verbAt) <= 60;
  for (const m of line.matchAll(/`([^`\n]{3,40})`/g)) {
    if (!near(m.index)) continue;
    const raw = m[1].trim();
    if (DATA_FILE.test(raw)) continue;
    objs.add(normName(raw));
  }
  for (const m of line.matchAll(/\b(grid grid-cols-?\w*|CSS columns|columns-\d|flexbox|mailto:|srcset|data-[a-z-]+)\b/gi)) {
    if (near(m.index)) objs.add(normName(m[1]));
  }
  return objs;
}

function checkDirectiveClash() {
  const pos = []; const neg = [];
  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      if (d.inFence[i] || raw.length < 30) return;
      // "do not add or remove it here", "do not change/touch/modify X" are STABILITY instructions
      // — leave the existing value alone — not prohibitions on the thing itself. Treating them as
      // bans pairs them with the rule that established the value, which always reads as a clash.
      if (/\b(?:do not|don't|never)\s+(?:add or remove|change|touch|modify|edit|weaken|delete)\b/i.test(raw)) return;
      const p = raw.match(POS_RE); const n = raw.match(NEG_RE);
      if (!!p === !!n) return;
      const at = (p || n).index;
      const objs = objectsIn(raw, at);
      if (!objs.size) return;
      (p ? pos : neg).push({ file: short(d.path), line: i + 1, text: raw.trim(), objs });
    });
  }
  const emitted = new Set();
  for (const p of pos) {
    for (const n of neg) {
      const shared = [...p.objs].filter((o) => n.objs.has(o) && o.length > 3);
      if (!shared.length) continue;
      const key = `${p.file}:${p.line}|${n.file}:${n.line}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      const cross = p.file !== n.file;
      add({
        kind: 'directive-clash',
        confidence: cross ? 'high' : 'medium',
        subject: `"${shared[0]}" — one rule requires it, another forbids it`,
        sides: [
          { file: p.file, line: p.line, claim: 'REQUIRES', text: p.text.slice(0, 190) },
          { file: n.file, line: n.line, claim: 'FORBIDS', text: n.text.slice(0, 190) },
        ],
        why: cross
          ? 'Cross-file contradiction on the same object — the most dangerous kind, because each file reads as correct on its own and neither author sees the other.'
          : 'Two rules in one file pull opposite ways on the same object; the nearer one wins.',
      });
    }
  }
}

/* ══ 8. ORPHANED ENFORCEMENT ═══════════════════════════════════════════════════
 * A script hard-FAILs on a condition no rule file states. Not a contradiction between two rules —
 * a contradiction between a rule and NOTHING, which is worse: the build fails a gate whose
 * requirement is unstated anywhere, so it cannot be satisfied deliberately.
 * ═════════════════════════════════════════════════════════════════════════════ */
function checkOrphanedEnforcement() {
  const corpus = docs.map((d) => d.text).join('\n');
  for (const p of scriptFiles) {
    const lines = readFileSync(p, 'utf8').split('\n');
    const flagged = new Set();
    lines.forEach((raw, i) => {
      if (!/failures\.push\(/.test(lines.slice(Math.max(0, i - 6), i + 1).join('\n'))) return;
      for (const m of raw.matchAll(/data-[a-z][a-z-]{4,}/g)) {
        const tok = m[0];
        if (corpus.includes(tok) || flagged.has(tok)) continue;
        flagged.add(tok);
        add({
          kind: 'orphaned-enforcement',
          confidence: 'high',
          subject: `${basename(p)} hard-FAILs on "${tok}" — no rule file documents it`,
          sides: [{ file: short(p), line: i + 1, claim: 'blocking gate', text: raw.trim().slice(0, 190) }],
          why: 'A gate that fails the build on a requirement stated nowhere in the skills. The builder cannot satisfy a rule it was never given, so this gate fails every build or passes by luck.',
        });
      }
    });
  }
}

/* ══ 9. DUPLICATE-GATE ═════════════════════════════════════════════════════════
 * Two different scripts hard-FAILing on the SAME defect, with different guards. This is the most
 * dangerous shape in the whole corpus and the one prose review never finds, because neither script
 * is wrong on its own: one gate gets deliberately narrowed after a bad outcome, the second gate
 * keeps the old rule, and a build that correctly satisfies the narrowed gate is still hard-FAILed
 * by the forgotten one. Detected by finding rare subject bigrams shared between two scripts' FAIL
 * messages, then showing both guards so a human can compare their scope.
 * ═════════════════════════════════════════════════════════════════════════════ */
const BIGRAM_STOP = new Set([
  // ordinary English
  'the', 'a', 'an', 'is', 'are', 'was', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'that',
  'this', 'it', 'its', 'as', 'by', 'from', 'at', 'be', 'has', 'have', 'not', 'no', 'so', 'but',
  'than', 'then', 'you', 'your', 'one', 'every', 'any', 'all', 'more', 'less', 'was', 'were',
  // code mechanics — these say nothing about WHAT is being gated
  'failures', 'warnings', 'push', 'const', 'let', 'console', 'log', 'length', 'usage', 'fail',
  'failed', 'check', 'checks', 'script', 'exit', 'node', 'path', 'file', 'files', 'line', 'lines',
  'build', 'builds', 'page', 'pages', 'site', 'slug', 'client', 'clients', 'run', 'runs', 'print',
  'printed', 'prints', 'found', 'name', 'names', 'value', 'values', 'record', 'records', 'skip',
]);

function checkDuplicateGates() {
  const byBigram = new Map();
  for (const p of scriptFiles) {
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      // A real gate EMITS a verdict. A block comment describing another script's verdict is
      // documentation, and pairing those produced only noise.
      if (/^\s*\*/.test(raw)) return;
      if (!/[A-Z][A-Z_]{3,}\s*=\s*(FAIL|REUSE|BLOCK)/.test(raw) && !/failures\.push\(/.test(raw)) return;
      // bigram the human-readable message only, never the surrounding code
      const strings = [...raw.matchAll(/`([^`]{12,})`|'([^']{12,})'|"([^"]{12,})"/g)]
        .map((m) => m[1] || m[2] || m[3]).join(' ');
      if (!strings || /usage:/i.test(strings)) return;   // argument-error text is not a gate
      const msg = strings.replace(/\$\{[^}]*\}/g, ' ').replace(/[^A-Za-z -]/g, ' ').toLowerCase();
      const words = msg.match(/[a-z][a-z-]{2,}/g) || [];
      for (let k = 0; k < words.length - 1; k++) {
        if (BIGRAM_STOP.has(words[k]) || BIGRAM_STOP.has(words[k + 1])) continue;
        const bg = `${words[k]} ${words[k + 1]}`;
        if (!byBigram.has(bg)) byBigram.set(bg, []);
        byBigram.get(bg).push({ file: short(p), line: i + 1, text: raw.trim().slice(0, 190) });
      }
    });
  }
  const emitted = new Set();
  for (const [bg, hits] of byBigram) {
    const files = [...new Set(hits.map((h) => h.file))];
    if (files.length < 2) continue;
    const key = files.sort().join('|');
    if (emitted.has(key)) continue;
    emitted.add(key);
    const one = hits.find((h) => h.file === files[0]);
    const two = hits.find((h) => h.file === files[1]);
    // The dangerous asymmetry: one gate carries an explicit SCOPE qualifier and the other does not.
    // That is the shape of "this rule was narrowed after a bad outcome and the second copy never
    // heard about it" — a build satisfying the narrowed rule is still hard-FAILed by the other.
    const SCOPED = /\bsame[- ]town\b|\bin the same\b|\bsame\s+[a-z]+\s+only\b/i;
    const asymmetric = SCOPED.test(one.text) !== SCOPED.test(two.text);
    add({
      kind: 'duplicate-gate',
      confidence: asymmetric ? 'high' : 'medium',
      subject: asymmetric
        ? `"${bg}" is gated by TWO scripts with DIFFERENT SCOPE — one is qualified, the other is absolute`
        : `"${bg}" hard-FAILs in two different scripts — compare their scope`,
      sides: [
        { file: one.file, line: one.line, claim: 'gate A', text: one.text },
        { file: two.file, line: two.line, claim: 'gate B', text: two.text },
      ],
      why: 'Two gates on one defect. If one was later narrowed (same-town only, last-N only) and the other was not, a build that correctly satisfies the narrowed rule is still hard-FAILed by the forgotten one.',
    });
  }
}

/* ══ 10. ALLOWLIST-CONFLICT ════════════════════════════════════════════════════
 * A name offered as ACCEPTABLE in one file that another file records as a known failure, bans
 * outright, or has abolished the whole list for.
 *
 * This is the case the example-vs-rule check structurally cannot see, because the offending name
 * sits in PROSE rather than in a code fence — and it is the one that survived every fix aimed at
 * it. `build/SKILL.md` deleted its flat "good heading fonts" list after that list shipped a Vogue
 * didone onto an HVAC contractor, and replaced it with a per-trade pool. The identically-shaped
 * list in the QA agent, still naming the same font, was never touched, so the reviewer still
 * passes the exact font the build skill was rewritten to prevent.
 * ═════════════════════════════════════════════════════════════════════════════ */
function checkAllowlistConflicts() {
  const bans = collectBans();

  // names a file records as having actually gone wrong
  const failureNarrative = [];
  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      for (const m of raw.matchAll(/\b(?:shipped|shipping|produced|reached (?:for|into)|ended up with|pushed .{0,20}onto)\s+(?:a\s+|an\s+|the\s+)?([A-Z][A-Za-z]+(?:[ _][A-Z][A-Za-z]+){0,2})/g)) {
        failureNarrative.push({ name: normName(m[1]), file: short(d.path), line: i + 1, text: raw.trim().slice(0, 190) });
      }
    });
  }

  // lines that abolish a category of list outright
  const abolitions = [];
  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      if (!/\b(?:no|not)\b[^.]{0,40}\b(?:general|flat|good)\b[^.]{0,30}\blist\b/i.test(raw)
        && !/use the [A-Z ]+POOL, not a flat list/i.test(raw)) return;
      abolitions.push({ file: short(d.path), line: i + 1, text: raw.trim().slice(0, 190) });
    });
  }

  for (const d of docs) {
    d.lines.forEach((raw, i) => {
      if (d.inFence[i]) return;
      const m = raw.match(/\b(?:acceptable|good|favoured|favored|recommended|approved)\b[^.]{0,40}?\b(fonts?|colou?rs?|palettes?|pairings?)\b[^.]{0,25}?(?:include|are|:)\s*([^.]{10,400})/i);
      if (!m) return;
      const subject = m[1].toLowerCase();
      const names = m[2].split(/,| or /).map((s) => s.replace(/^[-*\s]+/, '').trim())
        .filter((s) => /^[A-Z][A-Za-z0-9 '+-]{2,30}$/.test(s));
      for (const n of names) {
        const key = normName(n);
        const banned = bans.get(key);
        const failed = failureNarrative.find((f) => f.name === key && f.file !== short(d.path));
        if (!banned && !failed) continue;
        add({
          kind: 'allowlist-conflict',
          confidence: 'high',
          subject: `"${n}" is offered as an acceptable ${subject.replace(/s$/, '')}, but another file records it as a failure`,
          sides: [
            { file: short(d.path), line: i + 1, claim: 'ALLOW-LISTED', text: raw.trim().slice(0, 190) },
            banned
              ? { file: banned.file, line: banned.line, claim: `BANNED — ${banned.heading}`, text: banned.text }
              : { file: failed.file, line: failed.line, claim: 'RECORDED FAILURE', text: failed.text },
            ...abolitions.filter((a) => a.file !== short(d.path)).slice(0, 1)
              .map((a) => ({ file: a.file, line: a.line, claim: 'LIST ABOLISHED THERE', text: a.text })),
          ],
          why: 'One file hands the model a name that another file was rewritten to prevent. The allow-list wins, because it is the one that reads as permission — this is how a deleted list keeps shipping the same defect from its surviving copy.',
        });
      }
    });
  }
}

/* ── RUN ───────────────────────────────────────────────────────────────────── */
checkDefaultConflicts();
checkDuplicateGates();
checkAllowlistConflicts();
checkThresholdDrift();
checkEnforcementClaims();
checkExampleVsRule();
checkStaleRefs();
checkContractDrift();
checkDirectiveClash();
checkOrphanedEnforcement();

const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.kind}|${f.subject}|${(f.sides[0] || {}).file}:${(f.sides[0] || {}).line}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const RANK = { high: 0, medium: 1 };
unique.sort((a, b) => (RANK[a.confidence] - RANK[b.confidence]) || a.kind.localeCompare(b.kind));
const shown = SHOW_ALL ? unique : unique.filter((f) => f.confidence === 'high');

if (AS_JSON) {
  console.log(JSON.stringify({
    findings: shown,
    counts: { high: unique.filter((f) => f.confidence === 'high').length, medium: unique.filter((f) => f.confidence === 'medium').length },
  }, null, 2));
} else {
  const C = { r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
  console.log('');
  console.log(`${C.b}CONSISTENCY SCAN${C.x}  ${docs.length} rule files, ${scriptFiles.length} enforcement scripts`);
  console.log('');
  if (!shown.length) console.log('  no findings');
  for (const f of shown) {
    console.log(`${f.confidence === 'high' ? `${C.r}FINDING${C.x}` : `${C.y}CANDIDATE${C.x}`} [${f.kind}] ${C.b}${f.subject}${C.x}`);
    for (const s of f.sides) {
      console.log(`    ${s.file}:${s.line}  ${C.d}${s.claim}${C.x}`);
      if (s.text) console.log(`      ${C.d}${String(s.text).replace(/\s+/g, ' ')}${C.x}`);
    }
    console.log(`    ${C.d}why: ${f.why}${C.x}`);
    console.log('');
  }
  const hi = unique.filter((f) => f.confidence === 'high').length;
  const med = unique.filter((f) => f.confidence === 'medium').length;
  console.log(`${C.b}${hi} finding(s), ${med} candidate(s)${C.x}${SHOW_ALL ? '' : `  ${C.d}(--all to see candidates)${C.x}`}`);
  console.log('');
}

process.exit(unique.some((f) => f.confidence === 'high') ? 1 : 0);
