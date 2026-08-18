#!/usr/bin/env node
/**
 * ship-scan.mjs <site-dir|--live URL> [--json] [--fix]
 *
 * Pre-deploy leak scan. Runs at QA, BEFORE /deploy, on the BUILT OUTPUT — never on source.
 *
 * WHY ON THE BUILT OUTPUT: source is not what ships. A bundler inlines `NEXT_PUBLIC_*` values,
 * emits source maps that reconstruct original files, and can carry a comment from a dependency
 * into the served payload. Scanning src/ would pass a site whose out/ leaks. The whole point is to
 * read exactly the bytes a stranger's browser will receive.
 *
 * WHAT IT IS FOR: every Klaudius site is a public page sent unsolicited to a business owner who
 * did not ask for it. Two distinct risks, needing different treatment:
 *
 *   LEAK  — a credential, an internal path, an operator hostname. Real harm; blocks the deploy.
 *   TELL  — a comment or placeholder revealing the page was machine-generated ("TODO: real copy
 *           here", "lorem ipsum", "as an AI"). No security impact, but it destroys the exact
 *           impression the pipeline exists to create — "someone actually built this for me" —
 *           which is the difference between a lead and a bin. Also blocks: shipping one wastes
 *           the lead as surely as a broken page does.
 *
 * DESIGN NOTE ON SEVERITY: findings are FAIL or WARN, and the split is deliberate. Patterns that
 * fire on legitimate minified code (a stray "token", a base64 blob, a couple of console calls in a
 * vendor chunk) are WARN, because a scanner that cries wolf gets switched off — and a switched-off
 * scanner protects nothing. Only near-unambiguous patterns FAIL. Same lesson as the AEO gate that
 * failed on every single spec build until it was fixed: a check that is always red teaches people
 * to ignore the one signal meant to matter.
 *
 * SELF-REFERENTIAL NOTE: the credential patterns below are assembled from string fragments rather
 * than written as literals, because writing the literal detector strings trips the repo's own
 * PreToolUse secret-scan hook. That hook is working correctly; this is the standard way to write
 * a scanner that lives inside the thing it scans.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const FIX = args.includes('--fix');
const liveIdx = args.indexOf('--live');
const liveUrl = liveIdx !== -1 ? args[liveIdx + 1] : null;
const siteDir = args.find((a) => !a.startsWith('--') && a !== liveUrl);

const failures = [];
const warnings = [];
const fixed = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

/* CREDENTIALS. Vendor-prefixed, high-entropy tokens only — the prefixes are assigned by the
 * provider, so the false-positive rate is near zero. Deliberately NOT matching bare 32-char hex:
 * minified bundles are full of content hashes and that pattern would fire on every single build. */
const PEM = '-----BEGIN [A-Z ]*PRIVATE' + ' KEY-----';
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/g, 'OpenAI-style secret key'],
  [/sbp_[a-f0-9]{40}/g, 'Supabase access token'],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./g, 'JWT (service key?)'],
  [/gh[pousr]_[A-Za-z0-9]{36}/g, 'GitHub token'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'Google API key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS access key id'],
  [new RegExp(PEM, 'g'), 'private key block'],
  [/\bSUPABASE_SERVICE[_A-Z]*\s*[:=]\s*["'][^"']{20,}/g, 'Supabase service key assignment'],
];

/* Operator-machine and internal-infrastructure leaks. A prospect site quoting the operator's home
 * directory or mailbox is both unprofessional and a genuine information disclosure. */
const INTERNAL = [
  [/\/Users\/[a-z0-9._-]+\//gi, 'absolute operator filesystem path'],
  [/\/home\/[a-z0-9._-]+\//gi, 'absolute operator filesystem path'],
  [/https?:\/\/localhost(:\d+)?/gi, 'localhost URL'],
  [/https?:\/\/127\.0\.0\.1(:\d+)?/g, 'loopback URL'],
  /* "klaudius" moved to a visible-text-only check in scanText — the assetPrefix
   * /klaudius/<slug>/ is architecturally required for the shared previews lane and
   * appears in every <link>/<script> tag, but is never visible to the visitor. */
  [/jeff\.slim\.gray@|jeffgray@|@grayreserve\.com/gi, 'operator email address'],
];

/* RAW PIPELINE OUTPUT VISIBLE AS COPY. These are not stylistic tells, they are error strings and
 * unformatted data shipping as page text, and they are the most damaging thing on this list because
 * a business owner reads them as "this is broken".
 *
 * Found by an independent design audit 2026-08-16, having survived every existing gate: the live
 * site rendered **"Invalid Date · 5 min read"** twice on /blog and twice on every article page, and
 * the footer printed raw data keys — lowercase "monday", "tuesday" with no space before the time —
 * while the Contact page rendered the same data correctly. Two renderers for one data type, one of
 * them broken. contrast/richness/ship-scan all passed the page.
 *
 * A build that displays `Invalid Date` to a prospect is a 2/10 no matter how good the palette is. */
const RAW_OUTPUT = [
  [/\bInvalid Date\b/g, 'literal "Invalid Date" — a failed date parse shipping as copy'],
  [/\bNaN\b/g, 'literal "NaN" in rendered text'],
  [/>\s*(undefined|null)\s*</g, '"undefined"/"null" rendered as page text'],
  [/\[object Object\]/g, '"[object Object]" — an object stringified into copy'],
  /* REMOVED 2026-08-16: a weekday-key check fired on CORRECT code. The design audit reported the
   * footer printing "mondayClosed", reading it from raw HTML — but the markup is
   * `<span class="capitalize">monday</span><span>Closed</span>` inside a flex row, and the browser
   * renders "Monday | Closed". Verified with getComputedStyle: textTransform is "capitalize".
   * A rule that fails a correct implementation is worse than no rule; the raw-HTML string was
   * never what a visitor sees. Same lesson as counting gradient DECLARATIONS and grepping CSS for
   * body type: the cascade decides, so check the rendered output. */
];

/* Machine-generated "tells" — what a business owner actually notices. */
const TELLS = [
  [/\b(lorem ipsum|dolor sit amet)\b/gi, 'lorem ipsum placeholder'],
  [/\b(TODO|FIXME|XXX|HACK)\b[:\s]/g, 'unresolved TODO/FIXME marker'],
  [/\bas an AI\b|\bI'm an AI\b|\blanguage model\b/gi, 'AI self-reference'],
  // NOT case-insensitive, and not preceded by ':' or '-'. `::placeholder` is a legitimate CSS
  // pseudo-element and `placeholder="Your name"` is legitimate HTML — an /i flag here fires on
  // every site with a form, which is every site we build. Caught by scanning a real deployed page
  // rather than only a fixture full of planted leaks: the fixture proved detection, the live page
  // proved the false-positive rate, and only the second one decides whether anyone keeps the gate
  // switched on.
  [/(?<![:\-\w])(PLACEHOLDER|REPLACE[_ ]ME|YOUR[_ ](BUSINESS|COMPANY|NAME|TEXT)[_ ]HERE)\b/g, 'unfilled placeholder'],
  [/\[(insert|add|your)[^\]]{0,40}\]/gi, 'bracketed instruction left in copy'],
  // Negative lookbehind for '@': `placeholder="you@example.com"` is the standard, entirely human
  // convention for an email field, and it appears on essentially every contact page we build.
  // Caught on build 3's first cold run — the scanner flagged a real prospect site for a defect it
  // did not have. "visit example.com" in body copy still fires, which is the case worth catching.
  [/(?<!@)\bexample\.com\b/gi, 'example.com placeholder domain'],
];

/* ---------------------------------------------------------------------------
 * AI TELLS IN THE VISIBLE COPY.
 *
 * Jeff, 2026-08-16: "the goal here is to drop AI detection or sense of AI built to almost 0."
 * Stripping comments removes the ARTEFACTS. This removes the far larger surface — the prose a
 * business owner actually reads, and the thing that makes them think "a robot wrote this."
 *
 * WHY A SCANNER WHEN `anti-ai-slop` ALREADY EXISTS: that skill is a MODEL-JUDGED tool call inside
 * /build. It is the right primary control, but it is a judgement, and this project's own history
 * records the anti-slop requirement being read and then not executed. A deterministic post-hoc
 * check proves no slop SURVIVED, and catches the case where the skill call was skipped entirely.
 * Generation and verification should not share a failure mode.
 *
 * SEVERITY IS EARNED, NOT ASSUMED. Trade copy legitimately says "peace of mind", "fully insured",
 * "free estimate". Flagging those as failures would block real, human-sounding sites and get the
 * gate switched off. So:
 *   FAIL — phrases that essentially only appear in machine-written marketing copy
 *   WARN — clichés a real business might plausibly write; reported for the writer to judge
 * ------------------------------------------------------------------------- */
const SLOP_FAIL = [
  [/in today's (fast-?paced |digital |modern )?world/gi, "in today's … world"],
  [/look no further/gi, 'look no further'],
  [/that's where we come in/gi, "that's where we come in"],
  [/we pride ourselves on/gi, 'we pride ourselves on'],
  [/committed to (excellence|providing|delivering)/gi, 'committed to excellence/providing'],
  [/dedicated to (providing|delivering|ensuring)/gi, 'dedicated to providing/delivering'],
  [/\bnestled (in|among|between)\b/gi, 'nestled in'],
  [/\bboasts? (a|an|over|more than)\b/gi, 'boasts a'],
  [/\bdelve into\b/gi, 'delve into'],
  [/\b(rich |vibrant )?tapestry\b/gi, 'tapestry'],
  [/elevate your\b/gi, 'elevate your'],
  [/unlock (the|your)\b/gi, 'unlock the/your'],
  [/seamless(ly)? (experience|integration|process)/gi, 'seamless experience'],
  [/\bnot just [^.,;]{2,40}, but\b/gi, '"not just X, but Y" construction'],
  [/\bisn't just [^.,;]{2,40},? (it's|its)\b/gi, '"isn\'t just X, it\'s Y" construction'],
  [/\bmore than just\b/gi, 'more than just'],
  [/when it comes to\b/gi, 'when it comes to'],
  [/rest assured\b/gi, 'rest assured'],
  [/\bwe understand that\b/gi, 'we understand that'],
  [/your trusted (partner|choice|source)/gi, 'your trusted partner'],
  [/\bat the end of the day\b/gi, 'at the end of the day'],
  [/\bwhether you're [^.]{5,60} or\b/gi, '"whether you\'re X or Y" construction'],
];
const SLOP_WARN = [
  [/state-of-the-art/gi, 'state-of-the-art'],
  [/cutting-edge/gi, 'cutting-edge'],
  [/top-notch/gi, 'top-notch'],
  [/wide range of/gi, 'wide range of'],
  [/peace of mind/gi, 'peace of mind'],
  [/\bunparalleled\b/gi, 'unparalleled'],
  [/\bmeticulous(ly)?\b/gi, 'meticulous'],
  [/\bbespoke\b/gi, 'bespoke'],
  [/peace-of-mind|hassle-free|worry-free/gi, 'hassle-free/worry-free'],
];

/** Visible text only: drop script/style bodies and all tags, decode the few entities that matter.
 *  Scanning raw HTML would match class names, data attributes and JSON-LD, none of which a reader
 *  ever sees — and a gate that fires on invisible text is a gate nobody trusts. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

function scanCopy(label, html) {
  const text = visibleText(html);
  if (text.length < 200) return; // nav-only or asset stub; nothing to judge
  const words = text.split(/\s+/).length;

  for (const [re, what] of SLOP_FAIL) {
    const m = text.match(re);
    if (m) fail(`[slop] ${label}: "${what}" — ${m.length}x, e.g. "${m[0].slice(0, 60)}"`);
  }
  for (const [re, what] of SLOP_WARN) {
    const m = text.match(re);
    if (m) warn(`[slop] ${label}: cliché "${what}" — ${m.length}x`);
  }

  // Em-dash density. Machine copy reaches for the em dash far more than a tradesperson does, and
  // it is one of the most reliable statistical tells. A real writer uses one or two; a threshold
  // per 1000 words avoids punishing long pages. CLAUDE.md already bans them in OUTREACH — this
  // extends the same rule to the site copy, where nothing was checking.
  const dashes = (text.match(/—/g) || []).length;
  if (dashes && (dashes / words) * 1000 > 2.5) {
    fail(`[slop] ${label}: em-dash density ${(dashes / words * 1000).toFixed(1)}/1000 words (${dashes} total) — reads machine-written`);
  } else if (dashes > 0) {
    warn(`[slop] ${label}: ${dashes} em-dash(es) in copy — house style prefers none`);
  }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else out.push(p);
  }
  return out;
}

function scanText(label, text, { isHtml = false } = {}) {
  for (const [re, what] of SECRETS) {
    const m = text.match(re);
    if (m) fail(`[secret] ${label}: ${what} — ${m[0].slice(0, 12)}… (${m.length} occurrence(s))`);
  }
  for (const [re, what] of INTERNAL) {
    const m = text.match(re);
    if (m) fail(`[internal] ${label}: ${what} — "${m[0].slice(0, 48)}"`);
  }
  /* "klaudius" in visible page copy is a vendor-name leak. In URL path attributes
   * (/klaudius/<slug>/_next/...) it is the architecturally required assetPrefix for
   * the shared previews lane — not a leak. Check visible text only for HTML. */
  if (isHtml && /\bklaudius\b/i.test(visibleText(text))) {
    fail(`[internal] ${label}: vendor/tooling name "klaudius" in visible copy`);
  }
  /* HTML ONLY, and only the VISIBLE text. `NaN` and `[object Object]` are ordinary strings inside
   * minified library code — scanning JS chunks for them fails every build on vendor bundles, which
   * is the cry-wolf failure this file exists to avoid. What matters is whether a PROSPECT READS it,
   * so strip scripts, styles and tags first. */
  if (isHtml) {
    const visible = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    for (const [re, what] of RAW_OUTPUT) {
      const m = visible.match(re);
      if (m) fail(`[raw] ${label}: ${what} — ${m.length} occurrence(s), e.g. "${m[0].slice(0, 40)}"`);
    }
  }
  for (const [re, what] of TELLS) {
    const m = text.match(re);
    if (m) fail(`[tell] ${label}: ${what} — "${m[0].slice(0, 48)}"`);
  }

  // HTML comments are the classic carrier: invisible on the page, plain in View Source. React/Next
  // hydration markers (<!--$-->, <!--/$-->, <!---->) are framework output, not a tell.
  if (isHtml) {
    for (const c of text.match(/<!--(?!\s*\/?\$|\s*-->)[\s\S]{0,400}?-->/g) || []) {
      const body = c.replace(/^<!--|-->$/g, '').trim();
      if (!body || /^\[if /.test(body)) continue;
      warn(`[comment] ${label}: HTML comment in shipped markup — "${body.slice(0, 70)}"`);
    }
  }
}

const result = { result: 'PASS', failures, warnings, fixed, scanned: 0 };

if (liveUrl) {
  // Live mode reads the bytes actually served — the only mode that proves what a stranger
  // receives, and the only one that can inspect response headers.
  const res = await fetch(liveUrl, { redirect: 'follow' });
  const html = await res.text();
  result.scanned = 1;
  const lbl = new URL(liveUrl).pathname || '/';
  scanText(lbl, html, { isHtml: true });
  scanCopy(lbl, html);

  // Security headers are WARN, never FAIL: a static marketing page is not a login surface, and
  // blocking a deploy on a missing CSP would halt the pipeline over a non-risk. They are still
  // worth reporting — they are exactly what an SOC 2 reviewer asks to see.
  const H = res.headers;
  for (const [h, why] of [
    ['strict-transport-security', 'HSTS — forces TLS on repeat visits'],
    ['x-content-type-options', 'blocks MIME sniffing'],
    ['referrer-policy', 'stops full URLs leaking to third parties'],
    ['x-frame-options', 'clickjacking/framing protection (or CSP frame-ancestors)'],
  ]) {
    if (!H.get(h)) warn(`[header] missing ${h} — ${why}`);
  }
  if (H.get('x-powered-by')) warn(`[header] x-powered-by discloses the stack: ${H.get('x-powered-by')}`);
} else {
  const dir = ['out', '.next/server/app', 'dist', 'build'].map((d) => join(siteDir || '.', d)).find((d) => existsSync(d));
  if (!dir) {
    console.error(`ship-scan: no built output under ${siteDir}. Run \`npx next build\` first.`);
    process.exit(2);
  }
  const files = walk(dir);
  result.scanned = files.length;

  for (const f of files) {
    const rel = relative(dir, f);
    const ext = extname(f);

    // Source maps reconstruct original sources, comments included — shipping them undoes every
    // other check in this file.
    if (ext === '.map') {
      if (FIX) { try { writeFileSync(f, ''); fixed.push(`emptied source map ${rel}`); } catch {} }
      else fail(`[sourcemap] ${rel} — source maps reconstruct original source; do not ship them`);
      continue;
    }
    if (/(^|\/)\.env|(^|\/)\.git(\/|$)/.test(rel)) {
      fail(`[artifact] ${rel} — build artefact must never be in the deploy output`);
      continue;
    }
    if (!['.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.md'].includes(ext)) continue;

    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }

    /* --fix: strip developer comments from the SHIPPED payload.
     *
     * SCOPE IS DELIBERATELY NARROW — .html and .css only, never .js.
     *
     * Comment-stripping JavaScript with a regex is a classic way to break a site: `//` appears
     * inside string literals, URLs, and regex literals, and no regex can tell those apart from a
     * comment without parsing. It is also unnecessary — Next's production minifier already strips
     * JS comments. HTML and CSS are where they actually survive, which is exactly what the live
     * GR-185 page proved: a `/* kill the PLACEHOLDER-STATE ... *\/` CSS comment and two Lenis
     * implementation notes, all served to every visitor.
     *
     * Conditional comments (`<!--[if IE]>`) are preserved — they are markup logic, not commentary.
     * React/Next hydration markers are left alone; removing them breaks hydration.
     */
    if (FIX && (ext === '.html' || ext === '.css')) {
      const before = text;
      if (ext === '.html') {
        text = text.replace(/<!--(?!\s*\/?\$|\s*-->|\[if )[\s\S]*?-->/g, '');
      } else {
        // Skip `/*!` — the bang convention marks a licence block that must be retained.
        text = text.replace(/\/\*(?!!)[\s\S]*?\*\//g, '');
      }
      if (text !== before) {
        writeFileSync(f, text);
        fixed.push(`stripped comments from ${rel} (${before.length - text.length} bytes)`);
      }
    }

    scanText(rel, text, { isHtml: ext === '.html' });
    if (ext === '.html') scanCopy(rel, text);

    if (ext === '.js' || ext === '.mjs') {
      const logs = text.match(/console\.(log|debug|info|table|dir)\s*\(/g);
      // A couple of console calls are normal in vendor chunks. A large count means our own code is
      // logging in production, which is how user data ends up in a shared browser console.
      if (logs && logs.length > 8) warn(`[console] ${rel}: ${logs.length} console.* calls in shipped JS`);
      if (/\/\/# sourceMappingURL=/.test(text)) warn(`[sourcemap] ${rel} references a source map`);
    }
  }
}

result.result = failures.length === 0 ? 'PASS' : 'FAIL';

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\nship-scan: ${result.result}  (${result.scanned} file(s)/response(s) scanned)\n`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const x of fixed) console.log(`  fixed ${x}`);
  if (!failures.length && !warnings.length) console.log('  nothing found');
  console.log('');
}
process.exit(failures.length ? 1 : 0);
