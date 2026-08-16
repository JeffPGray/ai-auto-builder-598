#!/usr/bin/env node
/**
 * font-check.mjs — proves a BUILT site actually renders in its intended webfonts.
 *
 * Why this exists (2026-08-15, Gray Reserve):
 *   `@import url('https://fonts.googleapis.com/css2?...')` in `src/app/globals.css` is SILENTLY
 *   DROPPED by the Next 16 / Turbopack CSS pipeline whenever the URL contains a literal comma —
 *   which every real Google Fonts pairing has (`opsz,wght@6..96,400` , `wght@300,400,500`, an axis
 *   tuple, or a comma-separated weight list). The whole at-rule vanishes: the emitted stylesheet
 *   carries zero `@font-face`, `grep -r fonts.googleapis out/` returns nothing, and NO build
 *   warning fires. Every source-level grep passes, `globals.css` looks perfect, and the site
 *   renders in Georgia + Helvetica — discarding the entire typography step.
 *
 *   NOTE: `getComputedStyle(el).fontFamily` ALONE DOES NOT CATCH THIS. Computed style returns the
 *   *declared* stack ("Bodoni Moda", Georgia, serif) whether or not the face ever loaded. This
 *   script therefore measures whether the first declared family is actually AVAILABLE to the
 *   renderer (width-probe against three generic baselines) and cross-checks `document.fonts`.
 *
 * Usage:
 *   node scripts/font-check.mjs clients/<slug>/site
 *   node scripts/font-check.mjs clients/<slug>/site --url http://localhost:4177/   (skip own server)
 *   node scripts/font-check.mjs clients/<slug>/site --json
 *
 * Exit 0 = fonts prove out. Exit 1 = a real font failure. Exit 2 = the check could not run.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const FALLBACKS = new Set([
  'georgia', 'times', 'times new roman', 'helvetica', 'helvetica neue', 'arial', 'verdana',
  'tahoma', 'courier', 'courier new', 'system-ui', '-apple-system', 'blinkmacsystemfont',
  'segoe ui', 'roboto', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'serif', 'sans-serif',
  'monospace', 'cursive', 'fantasy', 'emoji', 'math', 'fangsong',
]);

const SELECTORS = ['body', 'h1', 'h2', 'h3', 'p', 'nav a', 'a', 'button'];

const args = process.argv.slice(2);
const siteDir = resolve(args.find((a) => !a.startsWith('--')) || '.');
const jsonOut = args.includes('--json');
const urlFlag = args.indexOf('--url');
const externalUrl = urlFlag !== -1 ? args[urlFlag + 1] : null;

const fail = [];
const warn = [];
const info = [];

function die(code, msg) {
  console.error(`\nFONT_CHECK=ERROR  ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------- 1. artefact-level check
const outDir = join(siteDir, 'out');
const nextDir = join(siteDir, '.next');
const artefactRoot = existsSync(outDir) ? outDir : existsSync(nextDir) ? nextDir : null;
if (!artefactRoot) {
  die(2, `no build artefact at ${outDir} or ${nextDir}. Run \`npx next build\` first.`);
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'cache') continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

const files = walk(artefactRoot);
const cssFiles = files.filter((f) => extname(f) === '.css');
const htmlFiles = files.filter((f) => extname(f) === '.html');
const fontFiles = files.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));

let fontFaceCount = 0;
for (const f of cssFiles) fontFaceCount += (readFileSync(f, 'utf8').match(/@font-face/g) || []).length;

let remoteFontLink = 0;
for (const f of htmlFiles) {
  const h = readFileSync(f, 'utf8');
  remoteFontLink += (h.match(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi) || []).length;
}

info.push(`artefact: ${fontFaceCount} @font-face rules, ${fontFiles.length} self-hosted font files, ${remoteFontLink} remote font <link> tags`);

// The exact signature of the Turbopack comma bug: source says @import, artefact has nothing.
const srcCss = join(siteDir, 'src', 'app', 'globals.css');
if (existsSync(srcCss)) {
  const src = readFileSync(srcCss, 'utf8');
  const imports = src.match(/@import\s+(url\()?["']?https?:\/\/[^"')]+/gi) || [];
  for (const imp of imports) {
    if (imp.includes(',')) {
      fail.push(
        `globals.css has a remote @import whose URL contains a COMMA — Turbopack drops the entire ` +
        `at-rule with no warning. Use next/font/google in layout.tsx instead.\n      ${imp.slice(0, 120)}`
      );
    } else {
      warn.push(
        `globals.css uses a remote @import. It survives today only because the URL has no comma; ` +
        `adding one weight tuple or a second axis silently kills it. Move to next/font/google.`
      );
    }
  }
}

if (fontFaceCount === 0 && remoteFontLink === 0) {
  fail.push(
    'BUILT ARTEFACT CARRIES NO WEBFONT AT ALL — 0 @font-face rules and 0 remote font <link> tags. ' +
    'The site will render in system fallbacks (Georgia/Helvetica).'
  );
}

// ---------------------------------------------------------------- 2. rendered check
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.txt': 'text/plain',
};

async function serveOut() {
  if (!existsSync(outDir)) return null;
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = join(outDir, p);
    try {
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
      if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch { res.writeHead(500); res.end('err'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

const PROBE = `(() => {
  const SELECTORS = ${JSON.stringify(SELECTORS)};
  const probe = document.createElement('span');
  probe.textContent = 'mmmmmmmmmmlliWWWWWWWWWW0123456789';
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;white-space:nowrap;font-size:72px;';
  document.body.appendChild(probe);
  const widthFor = (stack, weight, style) => {
    probe.style.fontFamily = stack;
    probe.style.fontWeight = weight || '400';
    probe.style.fontStyle = style || 'normal';
    return probe.getBoundingClientRect().width;
  };
  // A family is AVAILABLE iff prepending it changes the rendered width against at least one
  // generic baseline. If it matches serif AND sans-serif AND monospace exactly, it never loaded.
  const available = (family, weight, style) => {
    const q = '"' + family.replace(/"/g, '') + '"';
    for (const base of ['serif', 'sans-serif', 'monospace']) {
      if (Math.abs(widthFor(q + ',' + base, weight, style) - widthFor(base, weight, style)) > 0.5) return true;
    }
    return false;
  };
  const seen = new Set();
  const results = [];
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const declared = cs.fontFamily;
    const first = (declared.split(',')[0] || '').trim().replace(/^["']|["']$/g, '');
    const key = sel + '|' + first;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      selector: sel,
      declared,
      first,
      weight: cs.fontWeight,
      available: first ? available(first, cs.fontWeight, cs.fontStyle) : false,
    });
  }
  probe.remove();
  // Families the PAGE supplies (@font-face from its own stylesheets or a linked one). Note:
  // document.fonts.check() is NOT usable here — per spec it returns true for any family that
  // needs no loading, i.e. true for every unknown family that silently falls back.
  const pageFamilies = new Set();
  const loaded = [];
  document.fonts.forEach((f) => {
    pageFamilies.add(f.family.replace(/^["']|["']$/g, '').toLowerCase());
    loaded.push(f.family + ' ' + f.weight + ' ' + f.status);
  });
  for (const r of results) r.pageProvided = pageFamilies.has(r.first.toLowerCase());
  return { results, fontsSize: document.fonts.size, loaded: [...new Set(loaded)].slice(0, 40) };
})()`;

let rendered = null;
let served = null;
try {
  const { chromium } = await import('playwright');
  served = externalUrl ? null : await serveOut();
  const target = externalUrl || (served && served.url);
  if (!target) throw new Error(`no out/ to serve and no --url given`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('requestfailed', (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) consoleErrors.push(`${r.url()} :: ${r.failure()?.errorText}`);
  });
  await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate('document.fonts.ready').catch(() => {});
  await page.waitForTimeout(400);
  rendered = await page.evaluate(PROBE);
  rendered.blockedFontRequests = consoleErrors;
  await browser.close();
} catch (e) {
  warn.push(`rendered check could not run (${e.message}). Artefact check still applied.`);
} finally {
  if (served) served.server.close();
}

if (rendered) {
  info.push(`rendered: document.fonts.size=${rendered.fontsSize}`);
  if (rendered.blockedFontRequests?.length) {
    warn.push(
      `remote font requests FAILED in this environment:\n      ` +
      rendered.blockedFontRequests.slice(0, 3).join('\n      ') +
      `\n      (a sandbox may block third-party fonts — self-hosting via next/font/google removes this dependency entirely)`
    );
  }
  for (const r of rendered.results) {
    const isFallbackName = FALLBACKS.has(r.first.toLowerCase());
    if (isFallbackName) {
      fail.push(`\`${r.selector}\` declares a FALLBACK face first: ${r.declared}`);
    } else if (!r.available) {
      fail.push(
        `\`${r.selector}\` renders in a FALLBACK. Declared "${r.first}" but that family is not ` +
        `available to the renderer — width-identical to serif, sans-serif AND monospace.\n` +
        `      computed font-family: ${r.declared}`
      );
    } else if (!r.pageProvided) {
      fail.push(
        `\`${r.selector}\` only renders in "${r.first}" because that font is INSTALLED ON THIS ` +
        `MACHINE — the page ships no @font-face for it, so visitors get the fallback.\n` +
        `      computed font-family: ${r.declared}`
      );
    } else {
      info.push(`ok  ${r.selector.padEnd(8)} -> ${r.first} (served by the page, rendering)`);
    }
  }
  if (rendered.results.length === 0) warn.push('rendered check found none of the probe selectors on the page.');
}

// ---------------------------------------------------------------- 3. report
if (jsonOut) {
  console.log(JSON.stringify({ site: siteDir, ok: fail.length === 0, fail, warn, info, rendered }, null, 2));
} else {
  console.log(`\nfont-check  ${siteDir}`);
  for (const i of info) console.log(`  · ${i}`);
  for (const w of warn) console.log(`  ! WARN  ${w}`);
  for (const f of fail) console.log(`  ✗ FAIL  ${f}`);
  console.log(`\nFONT_CHECK=${fail.length === 0 ? 'PASS' : 'FAIL'}  (${fail.length} failure${fail.length === 1 ? '' : 's'}, ${warn.length} warning${warn.length === 1 ? '' : 's'})`);
}
process.exit(fail.length === 0 ? 0 : 1);
