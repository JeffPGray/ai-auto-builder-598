#!/usr/bin/env node
/**
 * verify-design-intent.mjs <client-slug> [--brief-only]
 *
 * THE ANTI-CLIFF-NOTES GATE. Two jobs, and the first one matters as much as the second.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * Measured on the real cold-front-ac transcript, 2026-08-19: the build **compacted 9 times, first
 * at minute 12, then every ~14 minutes**. DESIGN_IDEA, the trade-identity brief, the signature
 * moves and the composition rules were all established in the first ~12 minutes and then compacted
 * away. Every page written after that was authored from a *summary* of the design intent rather
 * than the intent. The site passed every gate and read generic. The build was cliff-notes reading
 * its own design brief.
 *
 * Two structural fixes, both here, neither depending on the model remembering anything:
 *
 *   JOB 1 — RE-INJECT. Print the recorded brief back into context, verbatim and compact. Run this
 *           after any compaction (and the build skill says to). A skill instruction survives
 *           compaction; the model's memory of a brief does not. Cheap: ~20 lines of output.
 *
 *   JOB 2 — ENFORCE. Verify the BUILT SITE against that brief mechanically. A rule the model can
 *           satisfy by writing a sentence ("signature move 1: isotherm motif") is not a rule — the
 *           failed build recorded all three signature moves and shipped none of them visibly.
 *           These checks read the shipped HTML/CSS, so intent and artifact must actually agree.
 *
 * Deliberately NOT a taste judge. It asks questions with numeric answers.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { uniformSiblingGroups, visualSignature, MARKETING_ROUTE } from './lib/design-dom.mjs';

const args = process.argv.slice(2);
const BRIEF_ONLY = args.includes('--brief-only');
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) { console.error('usage: verify-design-intent.mjs <client-slug> [--brief-only]'); process.exit(1); }

const statusPath = join('clients', slug, 'data', 'status.md');
if (!existsSync(statusPath)) { console.error(`no status.md at ${statusPath}`); process.exit(2); }
const status = readFileSync(statusPath, 'utf8');

/* ── JOB 1: re-inject the brief ─────────────────────────────────────────────────────────────── */
const ideaMatch = status.match(/DESIGN_IDEA\s*=\s*(.+)/);
const idea = ideaMatch ? ideaMatch[1].trim() : null;
const moves = [...status.matchAll(/Signature move \d+:\s*(.+)/gi)].map((m) => m[1].trim());
const hero = (status.match(/Hero archetype:\s*(.+)/i) || [])[1]?.trim();
const ground = (status.match(/GROUND=(\S+)|Ground:\s*(.+)/i) || []).slice(1).find(Boolean)?.trim();

console.log('\n════ RECORDED DESIGN BRIEF (re-read this; do not work from memory) ════');
console.log(`DESIGN_IDEA : ${idea || '*** MISSING ***'}`);
if (hero)   console.log(`Hero        : ${hero}`);
if (ground) console.log(`Ground      : ${ground}`);
moves.forEach((m, i) => console.log(`Move ${i + 1}      : ${m}`));
console.log('═══════════════════════════════════════════════════════════════════════\n');

if (BRIEF_ONLY) process.exit(0);

/* ── JOB 2: enforce it against the built artifact ───────────────────────────────────────────── */
const siteDir = join('clients', slug, 'site');
const outDir = ['out', 'dist', 'build'].map((d) => join(siteDir, d)).find((d) => existsSync(d));
if (!outDir) { console.error(`verify-design-intent: no built output under ${siteDir}. Run \`npx next build\` first.`); process.exit(2); }

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc); } else acc.push(p);
  }
  return acc;
}
const files = walk(outDir);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
const htmlFiles = files.filter((f) => f.endsWith('.html') && !/404|_not-found/.test(f));
const html = htmlFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const all = css + '\n' + html;

const failures = [];
const facts = {};

/* CHECK A — the brief exists at all. */
if (!idea) failures.push('[intent] no DESIGN_IDEA recorded in status.md. The design-system step is mandatory and its output is the artifact — an unrecorded design decision is an unaccountable one.');
if (moves.length < 3) failures.push(`[intent] ${moves.length}/3 signature moves recorded. Three are required before any TSX is written.`);

/* CHECK B — SCALE DRAMA. The single most visible boldness metric, and the one the failed build
 * missed completely: every heading sat in a narrow, safe size band.
 *
 * Measured from what SHIPS: Tailwind text-* utilities in the HTML plus any clamp() max in the CSS.
 * Tailwind's named scale is fixed, so this is deterministic — no browser needed. */
const TW = { 'text-xs':0.75,'text-sm':0.875,'text-base':1,'text-lg':1.125,'text-xl':1.25,'text-2xl':1.5,
  'text-3xl':1.875,'text-4xl':2.25,'text-5xl':3,'text-6xl':3.75,'text-7xl':4.5,'text-8xl':6,'text-9xl':8 };
let maxRem = 0;
for (const [cls, rem] of Object.entries(TW)) {
  // responsive prefixes count: md:text-7xl is still a shipped size
  if (new RegExp(`(?:^|["\\s:])${cls}(?:["\\s]|$)`).test(html)) maxRem = Math.max(maxRem, rem);
}
// clamp(min, pref, MAX) — the max is what a wide viewport actually paints
for (const m of all.matchAll(/clamp\([^)]*?([\d.]+)rem\s*\)/g)) maxRem = Math.max(maxRem, parseFloat(m[1]));
for (const m of all.matchAll(/font-size:\s*([\d.]+)rem/g)) maxRem = Math.max(maxRem, parseFloat(m[1]));
const ratio = maxRem > 0 ? maxRem / 1 : 0;  // body baseline = 1rem
facts.largestHeadingRem = maxRem;
facts.scaleRatio = Number(ratio.toFixed(2));
if (maxRem === 0) {
  failures.push('[scale] could not find ANY heading size in the shipped output — headings are rendering at browser defaults.');
} else if (ratio < 3.5) {
  failures.push(
    `[scale] largest heading is ${maxRem}rem = ${ratio.toFixed(1)}x body — the rule is >=3.5x. ` +
    'Everything sitting in a narrow, safe size band is the measured signature of a timid page ' +
    '(the exact defect on cold-front-ac). Commit ONE real scale moment: the hero headline, a stat ' +
    'figure, or a section numeral at text-7xl/8xl or a clamp() topping out >=3.5rem.');
}

/* CHECK C — SIGNATURE MOVES ACTUALLY SHIPPED.
 * A recorded move that left no trace in the artifact is bookkeeping, not design. Pull the
 * distinctive technical nouns out of each move and require evidence in the shipped HTML/CSS.
 * Deliberately generous on matching (any one keyword hits) — the goal is to catch a move that
 * shipped NOTHING, not to police wording. */
const STOP = new Set(['the','a','an','and','or','of','to','in','on','for','with','as','at','by','is',
  'used','use','uses','using','that','this','its','it','from','into','across','each','one','not',
  'never','always','page','site','section','sections','design','real','more','than','through','when',
  'where','which','while','plus','both','also','only','very','same','other','their','them','they']);
const moveResults = [];
for (const [i, mv] of moves.entries()) {
  const kws = [...new Set((mv.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []))]
    .filter((w) => !STOP.has(w)).slice(0, 14);
  const hit = kws.filter((k) => all.toLowerCase().includes(k));
  moveResults.push({ move: i + 1, keywords: kws.length, hits: hit.length, matched: hit.slice(0, 4) });
  if (kws.length >= 3 && hit.length === 0) {
    failures.push(
      `[intent] signature move ${i + 1} left NO trace in the shipped site — none of its terms ` +
      `(${kws.slice(0, 6).join(', ')}) appear anywhere in the built HTML/CSS. Recorded: "${mv.slice(0, 110)}". ` +
      'A move that exists only as a sentence in status.md is the exact failure this gate exists for.');
  }
}
facts.signatureMoves = moveResults;

/* CHECK D — UNIFORM-RHYTHM RUN. The monotony that the identical-CLASS card detector structurally
 * cannot see, because the worst real case carries no card styling at all: cold-front-ac's /services
 * shipped 16 services as plain rows — 13 <h3> with the byte-identical class, 15 <p> likewise, no
 * border, no shadow, no background. A card-shaped filter misses it completely; the reader does not.
 *
 * So measure the thing that actually creates rhythm: repeated HEADINGS at one size. N headings all
 * at the same size class = N items in identical visual rhythm with nothing featured. The escape
 * hatch is real variety — at least one heading of the same rank at a LARGER size (something is
 * featured), which is exactly the "make one dominant" rule stated as a number. */
const SIZE_ORDER = ['text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl',
  'text-4xl','text-5xl','text-6xl','text-7xl','text-8xl','text-9xl'];
const sizeRank = (cls) => {
  let r = -1;
  for (const [i, s] of SIZE_ORDER.entries()) if (new RegExp(`(?:^|[\\s:"])${s}(?:[\\s"]|$)`).test(cls)) r = Math.max(r, i);
  return r;
};
/* Scope: MARKETING pages only. Uniform headings are CORRECT on legal boilerplate (a privacy
 * policy should have evenly-ranked sections) and on blog articles (editorial subheads are meant to
 * be uniform). Firing there would make this gate cry wolf, and this codebase has already learned
 * that a gate which is always red protects nothing. */
const MARKETING_ONLY = /(^|\/)(index|services|about|contact)\.html$/;

/* ── CHECK D-1 — UNIFORM RUN, CAPPED AT SIX (2026-08-19) ───────────────────────────────────────
 *
 * THE DEFECT THIS EXISTS FOR, and why the check below it could not see it. The rejected build's
 * signature move 3 promised "top 3 featured ... rest as compact two-column index". It shipped 3
 * featured cards and then a TWELVE-row tail — and the heading check below PASSED it, because that
 * check excuses any uniform group as long as something ELSE on the page is larger. The three
 * featured cards were exactly that "something else". So the escape hatch designed to allow a
 * featured element licensed an unbounded tail: the operator's rule is "max 6 uniform rows, collapse
 * the tail", and "collapse" had never been given a number.
 *
 * Here it is a number. Six. Above six, a featured element elsewhere does not buy amnesty.
 *
 * TWO things had to change to make this real, and both are in scripts/lib/design-dom.mjs:
 *
 *  1. VISUAL uniformity, not string identity. The old checks keyed on byte-identical class strings,
 *     so `p-6 hover:bg-x/5 transition-colors` and `p-6 hover:bg-x/10 transition-all` counted as two
 *     different things and read as one thing. `visualSignature()` strips everything invisible in a
 *     still frame (interaction states, transitions, z-order, positioning), collapses responsive
 *     prefixes, and keeps only what decides shape, weight and ground.
 *  2. Real SIBLINGS. A regex counts a class anywhere on the page; 12 rows in one list and 12 rows
 *     spread over 6 sections are the same number and completely different pages. Only the first is
 *     monotony. `uniformSiblingGroups()` groups by actual parent from a parsed tree, and excludes
 *     nav/header/footer/drawer — repetition there is CORRECT and it is what false-positived the
 *     first calibration of richness-check § 15 by 36 hits.
 *
 * CALIBRATED against both real builds, and the cap lands exactly on the line between them:
 *   rejected build      -> runs of 12 on BOTH index.html and services.html. Fires twice, correctly.
 *   accepted floor build -> longest run anywhere is SIX (index 6, services 6, services/electrical 6,
 *                           blog cards 5, FAQ 5). Fires zero times.
 * The operator's "max 6" turns out to be precisely the boundary separating the build he rejected
 * from the build he calls the floor. That is not a threshold I tuned to fit; it is the one he
 * stated, and it survived measurement.
 */
const UNIFORM_RUN_CAP = 6;
const runFacts = {};
for (const f of htmlFiles) {
  const rel = f.replace(outDir + '/', '');
  if (!MARKETING_ROUTE.test(rel)) continue;
  const { groups } = uniformSiblingGroups(readFileSync(f, 'utf8'));
  const over = groups.filter((g) => g.members.length > UNIFORM_RUN_CAP);
  if (groups[0]) runFacts[rel] = groups[0].members.length;
  const reported = new Set();
  for (const g of over) {
    // One report per container: a 12-row list also repeats its <h3> and <p> 12 times, and three
    // failures for one defect is noise that trains people to skim the output.
    if (reported.has(g.parent)) continue;
    reported.add(g.parent);
    failures.push(
      `[rhythm] ${g.members.length} visually-identical <${g.tag}> siblings in one container on ` +
      `${rel} — the cap is ${UNIFORM_RUN_CAP}. "Collapse the tail" is this number: past six rows a ` +
      'reader stops reading and starts scrolling, and a featured element elsewhere on the page does ' +
      'NOT buy the tail amnesty (measured: a build shipped 3 featured cards + a 12-row index and ' +
      'every rhythm gate passed it). Cut to six and move the rest behind a link, group them under ' +
      'sub-headers, or change treatment every 3-4 items. ' +
      `Signature: "${g.sig.slice(0, 90)}${g.sig.length > 90 ? '…' : ''}"`);
  }
}
facts.longestUniformRun = runFacts;

for (const f of htmlFiles) {
  const rel = f.replace(outDir + '/', '');
  if (!MARKETING_ONLY.test(rel)) continue;
  const page = readFileSync(f, 'utf8');
  for (const tag of ['h2', 'h3', 'h4']) {
    /* Keyed on the VISUAL signature, not the raw class string (2026-08-19). Keyed on the raw
     * string, two headings differing only by `hover:` state or a transition utility counted as two
     * separate groups and read to a human as one uniform run — which is how a compact index of
     * near-identical rows slipped past a check written to catch exactly that. */
    const groups = new Map();
    for (const m of page.matchAll(new RegExp(`<${tag}\\s+class="([^"]+)"`, 'g'))) {
      const key = visualSignature(m[1]) || m[1];
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const [cls, n] of groups) {
      /* SIX EVERYWHERE (2026-08-19). This was `n < 6`, i.e. it fired at six. Once the grouping key
       * became the visual signature (above) rather than the raw class string, firing at six started
       * flagging a page's SIX SECTION HEADINGS as monotony — and section headings being the same
       * size is correct design, not a defect. Confirmed as a false positive on a real build before
       * changing it. The cap is now the same number the [rhythm] sibling-run check uses, so the
       * pipeline states one threshold instead of two: six is fine, seven is a tail.
       * This check still earns its place next to that one — it sees same-rank headings SPREAD
       * across a page with nothing featured, which the sibling-run check cannot, because those
       * headings have no common container. */
      if (n <= 6) continue;
      const rank = sizeRank(cls);
      // is any heading of the same rank shipped LARGER? then something is featured -> fine.
      const featured = [...groups.keys()].some((o) => o !== cls && sizeRank(o) > rank);
      if (!featured) {
        failures.push(
          `[rhythm] ${n}x <${tag}> on ${rel} share one identical class ("${cls.slice(0, 60)}") and ` +
          'NOTHING in that group is larger — every item sits in the same visual rhythm with none ' +
          'featured. This is the repeated-row monotony that reads as AI slop even with zero ' +
          'identical-card violations (measured: cold-front-ac /services, 13 rows). Fix by featuring ' +
          'one item at a larger size, grouping under sub-headers, or alternating treatment every ' +
          '3-4 items — per the recorded signature move that promised a dominant element.');
      }
    }
  }
}

/* CHECK E — GRID BREAK. impeccable and the composition rules both require at least one element per
 * marketing page that escapes the tidy grid (a span, an offset, a deliberate overlap). Without it a
 * page reads as stacked rows however good the palette is. Counted from shipped classes: any
 * col-span/row-span >1, negative margin, translate, or explicit order- override. */
const BREAK = /(col-span-[2-9]|row-span-[2-9]|-m[trblxy]?-\d|translate-[xy]-|order-[1-9]|lg:col-start|self-(start|end))/;
for (const f of htmlFiles) {
  const rel = f.replace(outDir + '/', '');
  if (!MARKETING_ONLY.test(rel)) continue;
  const page = readFileSync(f, 'utf8');
  const breaks = [...page.matchAll(/class="([^"]+)"/g)].filter((m) => BREAK.test(m[1])).length;
  facts[`gridBreaks_${rel.replace(/\.html$/, '')}`] = breaks;
  if (breaks === 0) {
    failures.push(
      `[composition] ${rel} has ZERO grid-breaking elements — every block sits in the same tidy ` +
      'grid. One element per page must escape it (a 2-col span, a negative-margin overlap, a ' +
      'vertical offset). A page where every row is the same shape reads as generated no matter how ' +
      'good the palette is.');
  }
}

/* CHECK G — A RECORDED SIZE IS A PROMISE, AND PROMISES ARE CHECKABLE (2026-08-19).
 *
 * § Design (HARD RULES) row 3 — "Dominant element, the one named in DESIGN_IDEA, >= 1.5x a
 * sibling's rendered area" — is the row the operator described as "the build RECORDED a dominant
 * element and shipped none". RENDERED area cannot be computed from markup (see the note at the
 * bottom of scripts/lib/design-dom.mjs; it needs layout, i.e. a browser). What CAN be computed, and
 * is where the failure actually shows up, is the half the brief states as a NUMBER: a move that
 * commits to "the review count at 200px" either ships type at that size or it does not.
 *
 * So this checks every explicit size in the recorded brief against the shipped output, with 20%
 * tolerance because a clamp() that tops out slightly under a stated round number is a judgement
 * call, not a broken promise. It fires only when a number was promised, so it can never cry wolf on
 * a brief that made no measurable commitment — and when it does fire, the evidence is exact.
 *
 * Calibration: the rejected build promised "200px" and shipped clamp(120px,18vw,200px) — PASSES,
 * correctly. Its dominance failure is real but lives on /services, where the [rhythm] cap catches
 * it as a 12-row run. Two gates, two different halves of the same rule, neither guessing.
 */
const sizeClaims = [];
for (const text of [idea || '', ...moves]) {
  for (const m of text.matchAll(/(\d{2,4})\s*px\b/g)) sizeClaims.push({ raw: m[0], rem: parseInt(m[1], 10) / 16 });
  for (const m of text.matchAll(/([\d.]+)\s*rem\b/g)) sizeClaims.push({ raw: m[0], rem: parseFloat(m[1]) });
}
if (sizeClaims.length) {
  const shippedSizes = [maxRem];
  for (const m of all.matchAll(/font-size:\s*([\d.]+)px/g)) shippedSizes.push(parseFloat(m[1]) / 16);
  for (const m of all.matchAll(/clamp\([^)]*?([\d.]+)px\s*\)/g)) shippedSizes.push(parseFloat(m[1]) / 16);
  const shippedMax = Math.max(...shippedSizes, 0);
  facts.sizeClaims = sizeClaims.map((c) => c.raw);
  facts.largestShippedRem = Number(shippedMax.toFixed(2));
  const broken = sizeClaims.filter((c) => shippedMax < c.rem * 0.8);
  if (broken.length) {
    failures.push(
      `[dominance] the brief commits to ${broken.map((b) => b.raw).join(', ')} and the largest type ` +
      `anywhere in the shipped output is ${(shippedMax * 16).toFixed(0)}px. A size written into a ` +
      'signature move and then not built is the exact shape of "recorded a dominant element and ' +
      'shipped none" — the record says the page has a focal point and the page does not. Build the ' +
      'size or rewrite the move; a brief that disagrees with the artifact is worse than no brief.');
  }
}

const result = { result: failures.length ? 'FAIL' : 'PASS', failures, facts };
console.log(`DESIGN_INTENT_CHECK=${result.result}\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (!failures.length) console.log('  all recorded design intent is present in the shipped artifact.');
console.log(`\n  facts: ${JSON.stringify(facts)}\n`);
process.exit(failures.length ? 1 : 0);
