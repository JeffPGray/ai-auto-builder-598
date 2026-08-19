#!/usr/bin/env node
/**
 * verify-nav-visibility.mjs <out-dir>
 *
 * PIXEL-SAMPLED nav-link contrast check, at fresh page load (scroll=0), across every route.
 * Prints NAV_VISIBILITY_CHECK=PASS|FAIL|SKIP.
 *
 * WHY THIS EXISTS AND WHY contrast-check.mjs CANNOT catch this (Fable consult, 2026-08-19,
 * confirmed empirically before writing this — see below).
 *
 * A real client build shipped a `position: fixed` nav header with `bg-transparent` on initial
 * load, its links styled for a dark background — invisible on any route whose content underneath
 * the fixed bar is light, until the visitor scrolls 80px and a `scrolled` class swaps in a solid
 * background. `contrast-check.mjs` ran on every route at every viewport and reported PASS, 0
 * failures.
 *
 * ROOT CAUSE, verified by reproducing the exact bug and re-running contrast-check.mjs against it:
 * still 0 failures. contrast-check.mjs's `bgOf()` resolves an element's effective background by
 * walking its DOM ANCESTOR chain and compositing each ancestor's own `background-color`. That is
 * correct for normal in-flow content, where "what paints behind an element" and "what is its DOM
 * ancestor" are the same thing. It is WRONG for a `position: fixed`/`sticky` element with no
 * background of its own: that element's true visual backdrop is whatever page content happens to
 * be SCROLLED underneath it — which has no DOM ancestor relationship to the fixed element at all.
 * The ancestor walk instead finds the fixed element's actual DOM parent (typically the page's root
 * wrapper), which is not what a viewer's eye sees.
 *
 * FIX: don't infer the background from the DOM. Screenshot the real rendered page and sample the
 * actual pixel colour behind each nav link directly — this project's own established methodology
 * for exactly this class of ambiguity (see contrast-check.mjs's own header note on an ancestor-walk
 * producing two false failures that pixel sampling overturned).
 *
 * SCOPE: only nav links at scroll=0 on first load, since that's the state that was invisible.
 * Scrolled/menu-open states are a much smaller failure surface (usually explicitly solid) and are
 * not attempted here — if a future build regresses THAT state instead, this check will not catch
 * it, and that is a known, accepted gap, not an oversight.
 */
import { createRequire } from "node:module";
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function resolvePw() {
  // Try the local node_modules first (klaudius app/ has playwright-core installed).
  try { return require.resolve("playwright-core"); } catch { /* fall through */ }
  try { return require.resolve("playwright"); } catch { /* fall through */ }
  const store = "/private/tmp/gr185-cut/node_modules/.pnpm";
  try {
    const d = readdirSync(store).find((x) => /^playwright-core@/.test(x));
    if (d) return path.join(store, d, "node_modules/playwright-core/index.js");
  } catch { /* fall through */ }
  return null;
}

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.log("NAV_VISIBILITY_CHECK=SKIP sharp unavailable — cannot pixel-sample");
  process.exit(0);
}

const pwPath = resolvePw();
if (!pwPath) {
  console.log("NAV_VISIBILITY_CHECK=SKIP playwright-core not resolvable");
  process.exit(0);
}
const { chromium } = require(pwPath);

const target = process.argv[2];
if (!target || !existsSync(target) || !statSync(target).isDirectory()) {
  console.log("NAV_VISIBILITY_CHECK=SKIP usage: verify-nav-visibility.mjs <out-dir>");
  process.exit(0);
}

const { createServer } = await import("node:http");
const root = path.resolve(target);
const mime = { html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  woff2: "font/woff2", json: "application/json", txt: "text/plain", mp4: "video/mp4", ico: "image/x-icon" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // Strip the /klaudius/<slug>/ assetPrefix (next.config.mjs) before resolving to `out/`. Without
  // this, every CSS/JS/font request 404s under a naive local server (the document lives at root,
  // assets are prefixed for the real shared-lane host), the page renders with ZERO real styling,
  // and any visual/computed-style check against it is checking unstyled HTML, not the real site —
  // this is the exact root cause font-check.mjs already documents as a known false-positive
  // source, and it silently produced meaningless PASS results here before this fix (verified: a
  // reproduced nav bug still reported 0 failures until this rewrite was added).
  p = p.replace(/^\/klaudius\/[^/]+\//, "/");
  let file = path.join(root, p);
  if (p === "/") file = path.join(root, "index.html");
  else if (!path.extname(p)) {
    if (existsSync(file + ".html")) file = file + ".html";
    else if (existsSync(path.join(file, "index.html"))) file = path.join(file, "index.html");
  }
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": mime[path.extname(file).slice(1)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const urls = readdirSync(root)
  .filter((f) => f.endsWith(".html") && f !== "404.html")
  .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
  .map((f) => `${base}/${f === "index.html" ? "" : f.replace(/\.html$/, "")}`);

if (!urls.length) {
  console.log(`NAV_VISIBILITY_CHECK=SKIP no .html pages in ${root}`);
  server.close();
  process.exit(0);
}

const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const parseColor = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2]];
};

const browser = await chromium.launch();
let failures = 0, checked = 0, navFound = false;

for (const url of urls) {
  for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 375, 812]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    try {
      // Fresh load, NO scroll — this is deliberately the state that shipped broken.
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(300);
    } catch (e) {
      console.log(`  ${url} ${label}: load failed — ${e.message}`);
      failures++;
      await ctx.close();
      continue;
    }

    const nav = await page.$("[data-nav]");
    if (!nav) { await ctx.close(); continue; }
    const links = await nav.$$("a");
    if (!links.length) { await ctx.close(); continue; }
    navFound = true;

    const shot = await page.screenshot({ type: "png" });
    const raw = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = raw;
    const pixelAt = (x, y) => {
      x = Math.max(0, Math.min(info.width - 1, Math.round(x)));
      y = Math.max(0, Math.min(info.height - 1, Math.round(y)));
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };

    for (const link of links) {
      const box = await link.boundingBox();
      if (!box || box.width < 4 || box.height < 4) continue;
      const txt = (await link.textContent() || "").trim();
      if (!txt) continue; // icon-only links have no text-contrast question here
      const cs = await link.evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.color, fontSize: parseFloat(s.fontSize), bold: Number(s.fontWeight) >= 700 };
      });
      const fg = parseColor(cs.color);
      if (!fg) continue;

      // Sample near the TOP edge of the link's own box, inset from the left edge — clear of the
      // glyph body (which sits vertically centred with padding) while still inside the fixed
      // header's real painted bar, not the header's DOM-ancestor background.
      const sx = box.x + Math.min(4, box.width / 4);
      const sy = box.y + 2;
      const bg = pixelAt(sx, sy);

      checked++;
      const large = cs.fontSize >= 24 || (cs.fontSize >= 18.66 && cs.bold);
      const need = large ? 3.0 : 4.5;
      const got = ratio(fg, bg);
      if (got < need) {
        failures++;
        console.log(
          `  FAIL ${got.toFixed(2)}:1 (needs ${need})  ${label} ${url.replace(base, "")}  "${txt.slice(0, 30)}"` +
          `  fg=rgb(${fg})  sampled-bg=rgb(${bg})  at scroll=0`
        );
      }
    }
    await ctx.close();
  }
}
await browser.close();
server.close();

if (!navFound) {
  console.log("NAV_VISIBILITY_CHECK=SKIP no [data-nav] element with <a> links found on any route");
  process.exit(0);
}

console.log(`\n  ${checked} nav link(s) checked across ${urls.length} route(s) x 2 viewports, ${failures} below threshold at scroll=0`);
console.log(`NAV_VISIBILITY_CHECK=${failures ? "FAIL" : "PASS"}`);
process.exit(failures ? 1 : 0);
