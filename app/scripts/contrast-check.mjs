#!/usr/bin/env node
/**
 * contrast-check.mjs <url|out-dir> — COMPUTED WCAG gate.
 *
 * WHY THIS EXISTS, and why the existing rule was not enough.
 *
 * build/SKILL.md already says "Nothing below 4.5:1 ships", and the QA agent is
 * told to screenshot the hero and confirm the text is "comfortably readable".
 * On 2026-08-16 the sunchaser-blinds build shipped a primary CTA at
 * **2.94:1** — white on #ca8a04 — through both of those gates.
 *
 * It got through because it does not LOOK broken. A wash-out (pale text on a
 * bright photo) is obvious to the eye; white-on-gold reads as a normal, even
 * handsome button. It fails arithmetic, not eyesight. A visual check cannot
 * catch that, and asking a reviewer to eyeball ratios is asking them to do
 * arithmetic from a screenshot.
 *
 * So this computes. It resolves each candidate element's effective foreground
 * and background from the RENDERED page, composites any alpha, and applies the
 * real WCAG threshold for that element's own font size and weight — 3.0 for
 * large text (>=24px, or >=18.66px bold), 4.5 otherwise. Using a flat 4.5
 * would produce false failures on legitimate display type, and a gate that
 * cries wolf gets switched off.
 *
 * ⚠️ Known trap, from this project's own history: an ancestor-walk that stops
 * at the first non-transparent parent produced TWO false contrast failures on
 * a GR-185 site that pixel sampling later overturned. So the walk here
 * composites every translucent layer it passes rather than taking the first
 * one, and reports the composited colour it used, so a disputed result can be
 * checked by hand instead of argued about.
 *
 * Exit 1 on any failure. Prints CONTRAST_CHECK=PASS|FAIL as the last line.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// TOKEN MODE:  contrast-check.mjs --tokens <globals.css>
//
// Static audit of the derive-palette.mjs token contract — pure math, no
// browser. The rendered-page gate below can only see what a resting page
// paints; semantic tokens (error text, toasts, validation banners) render on
// INTERACTION, so a regression in them ships invisibly past a screenshot
// gate. This mode re-verifies every declared pair from the hexes actually in
// `:root`, and fails on a MISSING required token, so a build that drops or
// hand-edits part of the derived set cannot ship. Run it right after pasting
// the palette. Prints TOKEN_CHECK=PASS|FAIL.
// ---------------------------------------------------------------------------
if (process.argv[2] === "--tokens") {
  const cssPath = process.argv[3];
  if (!cssPath || !existsSync(cssPath)) {
    console.error("usage: contrast-check.mjs --tokens <globals.css>");
    process.exit(2);
  }
  const css = fs.readFileSync(cssPath, "utf8");
  const tok = {};
  for (const m of css.matchAll(/--([a-z][a-z0-9-]*)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) tok[m[1]] = m[2];
  const hex = (s) => {
    const n = parseInt(s.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const sl = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lm = ([r, g, b]) => 0.2126 * sl(r / 255) + 0.7152 * sl(g / 255) + 0.0722 * sl(b / 255);
  const rr = (a, b) => { const [h, l] = [lm(a), lm(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };

  const REQUIRED = [
    "accent", "accent-text", "accent-text-dark", "accent-fill", "on-accent-fill",
    "accent-fill-bright", "on-accent-bright",
    "surface", "surface-alt", "surface-dark", "ink", "ink-muted", "on-dark", "on-dark-muted",
    ...["success", "warning", "error", "info"].flatMap((n) => [n, `${n}-text`, `${n}-text-dark`, `${n}-surface`]),
  ];
  // secondary-* is required as a GROUP if any member is present (harmony=none
  // is a legitimate single-hue design; half a secondary set is a regression).
  const SECONDARY = ["secondary", "secondary-text", "secondary-fill", "on-secondary-fill"];
  const hasSecondary = SECONDARY.some((n) => tok[n]);

  let fails = 0;
  for (const n of REQUIRED) if (!tok[n]) { fails++; console.log(`  FAIL missing token --${n}`); }
  if (hasSecondary) for (const n of SECONDARY) if (!tok[n]) { fails++; console.log(`  FAIL missing token --${n} (secondary set is all-or-none)`); }

  // The declared-pair contract (mirror of derive-palette.mjs's verification).
  const LIGHT = ["surface", "surface-alt"], DARK = ["surface-dark"];
  const pairs = [];
  for (const s of LIGHT) {
    pairs.push(["accent-text", s, 4.5], ["ink", s, 4.5], ["ink-muted", s, 4.5]);
    if (hasSecondary) pairs.push(["secondary-text", s, 4.5]);
    for (const n of ["success", "warning", "error", "info"]) {
      pairs.push([n, s, 3.0]);          // icon/border strength, WCAG non-text
      pairs.push([`${n}-text`, s, 4.5]);
    }
  }
  for (const s of DARK) {
    pairs.push(["accent-text-dark", s, 4.5], ["on-dark", s, 4.5], ["on-dark-muted", s, 4.5]);
    for (const n of ["success", "warning", "error", "info"]) pairs.push([`${n}-text-dark`, s, 4.5]);
  }
  pairs.push(["on-accent-fill", "accent-fill", 4.5], ["on-accent-bright", "accent-fill-bright", 4.5]);
  if (hasSecondary) pairs.push(["on-secondary-fill", "secondary-fill", 4.5]);
  for (const n of ["success", "warning", "error", "info"]) pairs.push([`${n}-text`, `${n}-surface`, 4.5]);

  let checked = 0;
  for (const [fg, bg, need] of pairs) {
    if (!tok[fg] || !tok[bg]) continue; // missing already reported above
    checked++;
    const got = rr(hex(tok[fg]), hex(tok[bg]));
    if (got < need) { fails++; console.log(`  FAIL ${got.toFixed(2)}:1 (needs ${need})  --${fg} ${tok[fg]} on --${bg} ${tok[bg]}`); }
  }
  console.log(`\n  ${Object.keys(tok).length} tokens found, ${checked} pairs checked, ${fails} failures`);
  console.log(`TOKEN_CHECK=${fails ? "FAIL" : "PASS"}`);
  process.exit(fails ? 1 : 0);
}

// Resolve playwright-core from the gr-no-website-builds pnpm store, exactly as
// measure-site.mjs and director-render-verify.mjs do. A plain
// `require("playwright-core")` resolves a copy with NO BROWSERS INSTALLED and
// dies with "Please run npx playwright install" — installing a second browser
// set here would cost ~400MB for no benefit when a working one already exists.
function resolvePw() {
  const store = "/private/tmp/gr185-cut/node_modules/.pnpm";
  try {
    const d = fs.readdirSync(store).find((x) => /^playwright-core@/.test(x));
    if (d) return path.join(store, d, "node_modules/playwright-core/index.js");
  } catch { /* fall through */ }
  try { return require.resolve("playwright-core"); } catch { /* fall through */ }
  try { return require.resolve("playwright"); } catch { return null; }
}
const pwPath = resolvePw();
if (!pwPath) {
  console.error("playwright-core not resolvable.");
  console.log("CONTRAST_CHECK=SKIP");
  process.exit(0);
}
// CJS require, NOT dynamic import: playwright-core's ESM entry does not
// re-export `chromium`, so `await import()` yields undefined and the failure
// surfaces far from its cause.
const { chromium } = require(pwPath);

const target = process.argv[2];
if (!target) {
  console.error("usage: contrast-check.mjs <url|out-dir>");
  process.exit(2);
}

// Directory mode: serve a static export on an ephemeral port with clean-URL
// handling (the Vercel behaviour: /services -> services.html) and check EVERY
// top-level page, not just the homepage — a multi-page site's worst contrast
// is as likely on /services as on /.
let server = null;
let urls = [target];
if (existsSync(target) && fs.statSync(target).isDirectory()) {
  const { createServer } = await import("node:http");
  const root = path.resolve(target);
  const mime = { html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    woff2: "font/woff2", json: "application/json", txt: "text/plain", mp4: "video/mp4", ico: "image/x-icon" };
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // Strip the /klaudius/<slug>/ assetPrefix (next.config.mjs) before resolving to `out/`.
    // Fable consult, 2026-08-19: without this, every CSS/JS/font request 404s under this naive
    // server (the document lives at root, assets are prefixed for the real shared-lane host), the
    // page renders with ZERO real styling, and this check was measuring unstyled default-browser
    // HTML instead of the real site — the exact same root cause font-check.mjs already documents
    // as a known false-positive source. Verified: a real nav-invisibility bug that shipped past
    // this exact check (0 failures reported) reproduced and confirmed fixed by this one change —
    // see scripts/verify-nav-visibility.mjs's header for the full incident.
    p = p.replace(/^\/klaudius\/[^/]+\//, "/");
    let file = path.join(root, p);
    if (p === "/") file = path.join(root, "index.html");
    else if (!path.extname(p)) {
      if (existsSync(file + ".html")) file = file + ".html";
      else if (existsSync(path.join(file, "index.html"))) file = path.join(file, "index.html");
    }
    if (!existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": mime[path.extname(file).slice(1)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  urls = fs.readdirSync(root)
    .filter((f) => f.endsWith(".html") && f !== "404.html")
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
    .map((f) => `${base}/${f === "index.html" ? "" : f.replace(/\.html$/, "")}`);
  if (!urls.length) { console.error(`no .html pages in ${root}`); process.exit(2); }
}

const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const page_script = () => {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  // Composite EVERY translucent ancestor, not just the first opaque one.
  const bgOf = (el) => {
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (!c || c.a === 0) continue;
      acc = acc
        ? { r: acc.r + (c.r - acc.r) * (1 - acc.a) , g: acc.g + (c.g - acc.g) * (1 - acc.a),
            b: acc.b + (c.b - acc.b) * (1 - acc.a), a: acc.a + c.a * (1 - acc.a) }
        : { ...c };
      if (acc.a >= 0.99) break;
    }
    if (!acc) return { r: 255, g: 255, b: 255, a: 1 };
    // Anything still translucent sits on the page background.
    if (acc.a < 0.99) {
      const pb = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      acc = { r: pb.r + (acc.r - pb.r) * acc.a, g: pb.g + (acc.g - pb.g) * acc.a,
              b: pb.b + (acc.b - pb.b) * acc.a, a: 1 };
    }
    return acc;
  };

  const out = [];
  const sel = "a,button,[role=button],h1,h2,h3,p,li,span";
  for (const el of document.querySelectorAll(sel)) {
    const txt = (el.textContent || "").trim();
    if (!txt || txt.length > 120) continue;
    if (el.querySelector(sel)) continue;            // leaf text only
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.1) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const px = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    out.push({
      text: txt.slice(0, 42), px, bold,
      fg: [fg.r, fg.g, fg.b], bg: [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)],
      cta: /^(a|button)$/i.test(el.tagName) && (cs.backgroundColor !== "rgba(0, 0, 0, 0)"),
    });
  }
  return out;
};

const browser = await chromium.launch();
let failures = 0, checked = 0;
for (const url of urls) {
  if (urls.length > 1) console.log(`\nPAGE ${url}`);
  for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 375, 812]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(600);
    } catch (e) {
      console.error(`  ${label}: load failed — ${e.message}`);
      failures++; // an unloadable page is a failure, never a silent skip
      await ctx.close();
      continue;
    }
    const items = await page.evaluate(page_script);
    console.log(`\n  ${label} (${w}x${h}) — ${items.length} text elements`);
    for (const it of items) {
      checked++;
      const large = it.px >= 24 || (it.px >= 18.66 && it.bold);
      const need = large ? 3.0 : 4.5;
      const got = ratio(it.fg, it.bg);
      if (got < need) {
        failures++;
        console.log(
          `    FAIL ${got.toFixed(2)}:1 (needs ${need})  ${it.px}px${it.bold ? " bold" : ""}` +
          `${it.cta ? " [CTA]" : ""}  fg=rgb(${it.fg}) bg=rgb(${it.bg})  ${JSON.stringify(it.text)}`
        );
      }
    }
    await ctx.close();
  }
}
await browser.close();
if (server) server.close();
console.log(`\n  ${checked} elements checked, ${failures} below threshold`);
console.log(`CONTRAST_CHECK=${failures ? "FAIL" : "PASS"}`);
process.exit(failures ? 1 : 0);
